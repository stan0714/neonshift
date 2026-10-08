/**
 * PG-SEASON-06 年度營運工具：把節日活動設定檔驗一次並印成一張表。
 *
 * 每年要加下一屆的時候，真正容易出錯的不是程式而是**設定**：UTC 窗口算錯一小時、
 * `expect_local_days` 打錯、DST 讓當地日期跑掉、同一主題同一年開兩屆。這些在
 * `parseCampaigns` 裡本來就會讓 API 啟動失敗——但那時候人已經在部署了。這支 CLI 讓同一份
 * 驗證可以在改完設定的當下跑，而且把「換算回活動時區之後到底是哪幾天」印出來給人看。
 *
 * 用法（backend/）：
 *   npm run seasonal:check                      # 驗證＋印出目前的屆次
 *   npm run seasonal:check -- --now 2027-03-16T06:00:00Z   # 指定「現在」看窗口狀態
 *   npm run seasonal:check -- --json            # 給 scripts/ops/seasonal.sh 對帳用
 *
 * 只讀檔、不連資料庫也不碰網路；離線可跑，失敗以 exit 1 收場。
 */
import { resolve } from "node:path";

import { localDayIn, loadCampaignsFile, SeasonalConfigError, type SeasonalCampaign } from "./campaigns.js";
import { windowStateOf } from "./compute.js";

const DAY_MS = 86_400_000;

export type SeasonalCheckRow = {
  campaign_id: string;
  theme_id: string;
  year: number;
  enabled: boolean;
  prototype: boolean;
  window_state: ReturnType<typeof windowStateOf>;
  starts_at: string;
  ends_at: string;
  display_timezone: string;
  /** 換算回活動時區之後真正涵蓋的當地日期（頭與尾） */
  local_days: [string, string];
  min_moving_minutes: number;
  grace_days: number;
  /** 補同步期限（ends_at + grace） */
  grace_until: string;
  source_url: string;
  source_checked_on: string;
};

export function checkRows(campaigns: readonly SeasonalCampaign[], now: Date): SeasonalCheckRow[] {
  return campaigns.map((c) => ({
    campaign_id: c.campaignId,
    theme_id: c.themeId,
    year: c.year,
    enabled: c.enabled,
    prototype: c.prototype,
    window_state: windowStateOf(c, now),
    starts_at: c.startsAt.toISOString(),
    ends_at: c.endsAt.toISOString(),
    display_timezone: c.displayTimezone,
    local_days: [localDayIn(c.startsAt, c.displayTimezone), localDayIn(new Date(c.endsAt.getTime() - 1), c.displayTimezone)],
    min_moving_minutes: Math.round(c.minMovingMs / 60_000),
    grace_days: Math.round(c.graceMs / DAY_MS),
    grace_until: new Date(c.endsAt.getTime() + c.graceMs).toISOString(),
    source_url: c.source.url,
    source_checked_on: c.source.checkedOn,
  }));
}

/** 人看的表；**啟用與否放第一欄**，因為那是唯一會讓一屆真的對外出現的開關 */
export function formatRows(rows: readonly SeasonalCheckRow[], now: Date): string {
  if (rows.length === 0) return "（設定檔裡沒有任何屆次）";
  const lines = [`as of ${now.toISOString()}`, ""];
  for (const r of rows) {
    const flags = [r.enabled ? "enabled" : "disabled", ...(r.prototype ? ["prototype"] : [])].join(" · ");
    lines.push(`${r.campaign_id}  [${flags}]  ${r.window_state}`);
    lines.push(`  UTC        ${r.starts_at} → ${r.ends_at}`);
    lines.push(`  ${r.display_timezone.padEnd(10)} ${r.local_days[0]} → ${r.local_days[1]}（換算回活動時區的實際日期）`);
    lines.push(`  規則        單次移動 ${r.min_moving_minutes} 分鐘 · 補同步至 ${r.grace_until}（${r.grace_days} 天）`);
    lines.push(`  來源        ${r.source_url}（核對 ${r.source_checked_on}）`);
    lines.push("");
  }
  const enabled = rows.filter((r) => r.enabled);
  lines.push(`共 ${rows.length} 屆，其中 ${enabled.length} 屆已啟用${enabled.length === 0 ? "（目前沒有任何一屆對外出現）" : `：${enabled.map((r) => r.campaign_id).join("、")}`}`);
  return lines.join("\n");
}

function main(argv: readonly string[]): number {
  const nowArg = argv[argv.indexOf("--now") + 1];
  const now = argv.includes("--now") && nowArg ? new Date(nowArg) : new Date();
  if (Number.isNaN(now.getTime())) {
    console.error("--now 不是合法的日期時間");
    return 1;
  }
  const file = resolve(process.cwd(), process.env.SEASONAL_FILE ?? "seasonal/campaigns.json");
  let campaigns: SeasonalCampaign[];
  try {
    campaigns = loadCampaignsFile(file);
  } catch (e) {
    // 設定錯誤要指名道姓：這支工具的意義就是在部署前把它講清楚
    console.error(`${file}\n${e instanceof SeasonalConfigError ? e.message : e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
  const rows = checkRows(campaigns, now);
  console.log(argv.includes("--json") ? JSON.stringify({ as_of: now.toISOString(), file, campaigns: rows }, null, 2) : formatRows(rows, now));
  return 0;
}

// 被 import（測試）時不執行
if (process.argv[1] && /seasonal[/\\]check\.ts$/.test(process.argv[1])) process.exit(main(process.argv.slice(2)));
