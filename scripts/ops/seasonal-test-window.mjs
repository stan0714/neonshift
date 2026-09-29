// 產生「測試用」的節日窗口設定（PG-SEASON-06 的 B-2 驗收）。
//
// 為什麼需要它：排程通知的三個時刻是 starts_at−7天／starts_at／ends_at，全都可能離現在好幾個月，
// 不可能為了驗收等到那天。這支工具算出一個「幾分鐘後就會發通知」的窗口，
// 並把 expect_local_days 一併算好——那是加新一屆最容易錯的欄位（UTC 窗口換算回活動時區
// 差一小時、或 DST 讓當地日期跑掉），backend 的 seasonal:check 會擋，但錯了要自己回頭算很煩。
//
//   node scripts/ops/seasonal-test-window.mjs grace [分鐘] [時區]   # 窗口現在就開著，N 分鐘後發 grace 通知
//   node scripts/ops/seasonal-test-window.mjs soon  [分鐘] [時區]   # 窗口 7 天後開，N 分鐘後發 soon 通知
//
// 輸出貼進 backend/seasonal/campaigns.json 的某一屆（建議用 prototype: true 那一屆），
// 把 enabled 改成 true，然後 `cd backend && npm run seasonal:check` 再部署。
// **測完要記得改回去**：留著一個假窗口在設定檔裡，下次沒人記得它為什麼在那裡。
const LEAD_MS = 7 * 24 * 60 * 60 * 1000; // 與 app/src/domain/seasonalReminder.ts 的 SEASONAL_REMINDER_LEAD_MS 一致

const mode = process.argv[2] ?? 'grace';
const minutes = Number(process.argv[3] ?? (mode === 'grace' ? 3 : 2));
const tz = process.argv[4] ?? 'Asia/Taipei';
if (!['grace', 'soon'].includes(mode)) { console.error('mode 只能是 grace 或 soon'); process.exit(2); }
if (!Number.isFinite(minutes) || minutes < 1) { console.error('分鐘要是 >= 1 的數字'); process.exit(2); }

const now = Math.floor(Date.now() / 1000) * 1000;
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, '.000Z');
const localDay = (ms) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

// 窗口涵蓋的當地日期：逐小時掃一遍再補最後一刻，跨時區與 DST 都不會漏
function localDays(startMs, endMs) {
  const out = [];
  for (let t = startMs; t < endMs; t += 3600_000) {
    const d = localDay(t);
    if (!out.includes(d)) out.push(d);
  }
  const last = localDay(endMs - 1000);
  if (!out.includes(last)) out.push(last);
  return out;
}

let startsAt;
let endsAt;
let fireAt;
if (mode === 'grace') {
  // grace 的排程時刻＝ends_at。窗口往前開一小時，讓它現在就是 open 狀態（畫面上才看得到卡片）
  startsAt = now - 3600_000;
  endsAt = now + minutes * 60_000;
  fireAt = endsAt;
} else {
  // soon 的排程時刻＝starts_at − 7 天
  startsAt = now + LEAD_MS + minutes * 60_000;
  endsAt = startsAt + 86_400_000;
  fireAt = startsAt - LEAD_MS;
}

console.log(`# ${mode} 通知會在 ${iso(fireAt)}（約 ${minutes} 分鐘後）發出`);
console.log(`# 時區 ${tz}；貼進 campaigns.json 後記得把 enabled 設為 true，並跑 npm run seasonal:check`);
console.log(JSON.stringify({
  starts_at: iso(startsAt),
  ends_at: iso(endsAt),
  display_timezone: tz,
  expect_local_days: localDays(startsAt, endsAt),
}, null, 2));
