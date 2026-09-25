/**
 * PG-SEASON-01／02（docs/design/seasonal-achievement-nfts.md §6 測試清單）：
 * 窗口起訖毫秒、跨午夜、DST、改手機時區、20 分門檻邊界、離線寬限、重複匯入、待審後核准、跨帳號。
 */
import { describe, expect, it } from "vitest";

import { loadCampaignsFile, localDayIn, parseCampaigns, SeasonalConfigError, type SeasonalCampaign } from "./campaigns.js";
import { candidateFor, resolveSeasonal, windowStateOf, type WorkoutForSeasonal } from "./compute.js";

const DAY = 86_400_000;
const campaign = (o: Partial<SeasonalCampaign> = {}): SeasonalCampaign => ({
  campaignId: "genesis-stride-2027",
  themeId: "genesis_stride",
  year: 2027,
  artVersion: 1,
  rulesVersion: 1,
  enabled: true,
  prototype: false,
  startsAt: new Date("2027-03-16T00:00:00.000Z"),
  endsAt: new Date("2027-03-17T00:00:00.000Z"),
  displayTimezone: "UTC",
  minMovingMs: 1_200_000,
  graceMs: 7 * DAY,
  source: { fact: "f", url: "https://example.com", checkedOn: "2026-09-25" },
  ...o,
});

const workout = (o: Partial<WorkoutForSeasonal> = {}): WorkoutForSeasonal => ({
  sessionId: "w1",
  sourceRevision: 1,
  sport: "walk",
  origin: "gps",
  status: "saved",
  quality: "complete",
  rulesVersion: 2,
  startedAt: new Date("2027-03-16T08:00:00.000Z"),
  endedAt: new Date("2027-03-16T08:25:00.000Z"),
  elapsedMs: 1_500_000n,
  pausedMs: 0n,
  importedAt: new Date("2027-03-16T08:30:00.000Z"),
  ...o,
});
const verdict = (w: Partial<WorkoutForSeasonal>, c: Partial<SeasonalCampaign> = {}, gps: number | null = 2) => candidateFor(campaign(c), workout(w), gps);

describe("窗口邊界", () => {
  it("開始端點包含、結束端點排除（差 1 毫秒就不同結果）", () => {
    expect(verdict({ startedAt: new Date("2027-03-16T00:00:00.000Z"), endedAt: new Date("2027-03-16T00:25:00.000Z") })!.eligible).toBe(true);
    expect(verdict({ startedAt: new Date("2027-03-15T23:59:59.999Z"), endedAt: new Date("2027-03-16T00:25:00.000Z") })!.reason).toBe("outside_window");
    // 結束正好等於 ends_at → 不算（半開區間）
    expect(verdict({ startedAt: new Date("2027-03-16T23:30:00.000Z"), endedAt: new Date("2027-03-17T00:00:00.000Z") })!.reason).toBe("outside_window");
    expect(verdict({ startedAt: new Date("2027-03-16T23:30:00.000Z"), endedAt: new Date("2027-03-16T23:59:59.999Z") })!.eligible).toBe(true);
  });

  it("跨午夜（跨出窗口）不算，且不能用多筆拼滿門檻", () => {
    const acrossMidnight = workout({ sessionId: "late", startedAt: new Date("2027-03-16T23:50:00.000Z"), endedAt: new Date("2027-03-17T00:20:00.000Z"), elapsedMs: 1_800_000n });
    const halfA = workout({ sessionId: "a", startedAt: new Date("2027-03-16T09:00:00.000Z"), endedAt: new Date("2027-03-16T09:11:00.000Z"), elapsedMs: 660_000n });
    const halfB = workout({ sessionId: "b", startedAt: new Date("2027-03-16T10:00:00.000Z"), endedAt: new Date("2027-03-16T10:11:00.000Z"), elapsedMs: 660_000n });
    const r = resolveSeasonal([campaign()], [acrossMidnight, halfA, halfB], new Date("2027-03-18T00:00:00Z"), 2)[0]!;
    expect(r.status).toBe("locked"); // 11+11 分鐘不等於 20 分鐘
    expect(r.first).toBeNull();
  });

  it("狀態隨時間推進：upcoming → open → grace → closed", () => {
    const c = campaign();
    expect(windowStateOf(c, new Date("2027-03-15T00:00:00Z"))).toBe("upcoming");
    expect(windowStateOf(c, new Date("2027-03-16T12:00:00Z"))).toBe("open");
    expect(windowStateOf(c, new Date("2027-03-17T00:00:00Z"))).toBe("grace");
    expect(windowStateOf(c, new Date("2027-03-23T23:59:59Z"))).toBe("grace");
    expect(windowStateOf(c, new Date("2027-03-24T00:00:01Z"))).toBe("closed");
  });
});

describe("門檻與資料品質", () => {
  it("moving time 恰好 20 分合格，少 1 毫秒不合格；暫停時間不計入", () => {
    expect(verdict({ elapsedMs: 1_200_000n })!.eligible).toBe(true);
    expect(verdict({ elapsedMs: 1_199_999n })!.reason).toBe("too_short");
    // 走 25 分鐘但暫停 6 分鐘 → moving 19 分鐘，不合格
    expect(verdict({ elapsedMs: 1_500_000n, pausedMs: 360_000n })!.reason).toBe("too_short");
  });

  it("手動、估算、待審、GPS 規則未開放各有自己的原因碼", () => {
    expect(verdict({ origin: "manual" })!.reason).toBe("manual");
    expect(verdict({ quality: "estimated" })!.reason).toBe("estimated");
    expect(verdict({ status: "needs_review" })!.reason).toBe("needs_review");
    expect(verdict({ origin: "gps", rulesVersion: 1 }, {}, 2)!.reason).toBe("gps_rules_pending");
    expect(verdict({ origin: "gps" }, {}, null)!.reason).toBe("gps_rules_pending");
    expect(verdict({ status: "deleted" })!.reason).toBe("deleted");
  });

  it("跑步與健走都算，新手不需要跑得更快；其他運動不產生候選", () => {
    expect(verdict({ sport: "walk" })!.eligible).toBe(true);
    expect(verdict({ sport: "run" })!.eligible).toBe(true);
    expect(candidateFor(campaign(), { ...workout(), sport: "swim" as never }, 2)).toBeNull();
  });
});

describe("上傳寬限", () => {
  it("按時運動、晚 7 天內同步仍算；超過寬限才失格", () => {
    expect(verdict({ importedAt: new Date("2027-03-23T23:00:00.000Z") })!.eligible).toBe(true);
    expect(verdict({ importedAt: new Date("2027-03-24T00:00:01.000Z") })!.reason).toBe("late_upload");
  });

  it("寬限只放寬同步時間，不放寬運動時間", () => {
    // 活動結束後才運動 → 不論多快上傳都不算
    expect(verdict({ startedAt: new Date("2027-03-17T08:00:00.000Z"), endedAt: new Date("2027-03-17T08:30:00.000Z"), importedAt: new Date("2027-03-17T08:31:00.000Z") })!.reason).toBe("outside_window");
  });
});

describe("每屆一枚與去重", () => {
  it("多筆合格取最早開始那筆；重複匯入（同一 session 較新 revision）不換來源也不多發", () => {
    const early = workout({ sessionId: "early", startedAt: new Date("2027-03-16T06:00:00.000Z"), endedAt: new Date("2027-03-16T06:30:00.000Z"), elapsedMs: 1_800_000n });
    const later = workout({ sessionId: "later", startedAt: new Date("2027-03-16T18:00:00.000Z"), endedAt: new Date("2027-03-16T18:40:00.000Z"), elapsedMs: 2_400_000n });
    const reimported = { ...early, sourceRevision: 3 };
    const r = resolveSeasonal([campaign()], [later, reimported], new Date("2027-03-18T00:00:00Z"), 2)[0]!;
    expect(r.status).toBe("eligible");
    expect(r.first!.sessionId).toBe("early");
    expect(r.first!.sourceRevision).toBe(3); // 來源 revision 跟著更新，但仍是同一筆、同一枚
  });

  it("同時間開始時以 sessionId 穩定排序（不同排序不換來源）", () => {
    const a = workout({ sessionId: "aaa" });
    const b = workout({ sessionId: "bbb" });
    expect(resolveSeasonal([campaign()], [b, a], new Date("2027-03-18T00:00:00Z"), 2)[0]!.first!.sessionId).toBe("aaa");
    expect(resolveSeasonal([campaign()], [a, b], new Date("2027-03-18T00:00:00Z"), 2)[0]!.first!.sessionId).toBe("aaa");
  });

  it("同一筆運動可同時解鎖不同主題的章（兩屆窗口重疊時）", () => {
    const other = campaign({ campaignId: "moonlit-steps-2027", themeId: "moonlit_steps" });
    const rs = resolveSeasonal([campaign(), other], [workout()], new Date("2027-03-18T00:00:00Z"), 2);
    expect(rs.map((r) => r.status)).toEqual(["eligible", "eligible"]);
    expect(new Set(rs.map((r) => r.first!.sessionId)).size).toBe(1);
  });

  it("待審時顯示 pending 而非已取得；核准（status 轉 saved）後才變 eligible", () => {
    const pendingW = workout({ status: "needs_review" });
    const before = resolveSeasonal([campaign()], [pendingW], new Date("2027-03-16T12:00:00Z"), 2)[0]!;
    expect([before.status, before.first, before.pending?.sessionId]).toEqual(["pending_review", null, "w1"]);
    const after = resolveSeasonal([campaign()], [{ ...pendingW, status: "saved" }], new Date("2027-03-16T12:00:00Z"), 2)[0]!;
    expect([after.status, after.first!.sessionId, after.pending]).toEqual(["eligible", "w1", null]);
  });

  it("未啟用的屆次完全不出現（來源還沒核對完成就不該給人看到）", () => {
    expect(resolveSeasonal([campaign({ enabled: false })], [workout()], new Date("2027-03-18T00:00:00Z"), 2)).toEqual([]);
  });

  it("進度回窗口內最長的 moving time，讓詳情頁能顯示還差多少", () => {
    const short = workout({ sessionId: "s", elapsedMs: 900_000n, endedAt: new Date("2027-03-16T08:15:00.000Z") });
    const r = resolveSeasonal([campaign()], [short], new Date("2027-03-16T12:00:00Z"), 2)[0]!;
    expect([r.status, r.bestMovingMs]).toEqual(["locked", 900_000]);
  });
});

describe("設定檔驗證", () => {
  const base = {
    campaign_id: "moonlit-steps-2026",
    theme_id: "moonlit_steps",
    year: 2026,
    art_version: 1,
    rules_version: 1,
    enabled: true,
    starts_at: "2026-09-24T16:00:00.000Z",
    ends_at: "2026-09-25T16:00:00.000Z",
    display_timezone: "Asia/Taipei",
    expect_local_days: ["2026-09-25"],
    min_moving_ms: 1_200_000,
    grace_ms: 604_800_000,
    source: { fact: "中秋", url: "https://example.com/moon", checked_on: "2026-09-25" },
  };
  const file = (c: Record<string, unknown>) => ({ version: 1 as const, campaigns: [{ ...base, ...c }] });

  it("地方節日：UTC 窗口換算回宣告時區必須就是要紀念的當地日期", () => {
    expect(parseCampaigns(file({}))[0]!.displayTimezone).toBe("Asia/Taipei");
    // 少加 8 小時時差（直接寫當地午夜當成 UTC）→ 擋下
    expect(() => parseCampaigns(file({ starts_at: "2026-09-25T00:00:00.000Z", ends_at: "2026-09-26T00:00:00.000Z" }))).toThrow(SeasonalConfigError);
  });

  it("DST：同一組 UTC 窗口在有日光節約的時區會偏掉，驗證抓得到", () => {
    // 美東 2027-03-14 進入 DST；想紀念 3/16 當地日，正確窗口是 04:00Z → 04:00Z
    const ok = file({ campaign_id: "genesis-stride-2027", theme_id: "genesis_stride", year: 2027, display_timezone: "America/New_York", starts_at: "2027-03-16T04:00:00.000Z", ends_at: "2027-03-17T04:00:00.000Z", expect_local_days: ["2027-03-16"] });
    expect(parseCampaigns(ok)).toHaveLength(1);
    // 用冬令時間的 05:00Z 偏移 → 窗口變成 3/15 23:00 起，當地日期不符
    const dstOff = file({ campaign_id: "genesis-stride-2027", theme_id: "genesis_stride", year: 2027, display_timezone: "America/New_York", starts_at: "2027-03-16T05:00:00.000Z", ends_at: "2027-03-17T05:00:00.000Z", expect_local_days: ["2027-03-16"] });
    expect(() => parseCampaigns(dstOff)).toThrow(/expected/);
  });

  it("窗口顛倒、同主題同年兩屆、重複 id、壞時區都拒絕", () => {
    expect(() => parseCampaigns(file({ starts_at: "2026-09-25T16:00:00.000Z", ends_at: "2026-09-24T16:00:00.000Z" }))).toThrow(SeasonalConfigError);
    expect(() => parseCampaigns({ version: 1, campaigns: [base, { ...base, campaign_id: "moonlit-steps-2026-b" }] })).toThrow(/duplicate theme\/year/);
    expect(() => parseCampaigns({ version: 1, campaigns: [base, base] })).toThrow(/duplicate campaign_id/);
    expect(() => parseCampaigns(file({ display_timezone: "Mars/Olympus" }))).toThrow(SeasonalConfigError);
    // 缺來源 URL／核對日期不得發布
    expect(() => parseCampaigns(file({ source: { fact: "x", checked_on: "2026-09-25" } }))).toThrow(SeasonalConfigError);
  });

  it("倉庫裡的設定檔本身合法（含 UTC 與 Asia/Taipei 兩種窗口）", () => {
    const list = loadCampaignsFile("seasonal/campaigns.json");
    expect(list.length).toBeGreaterThan(0);
    for (const c of list) {
      expect(c.endsAt.getTime()).toBeGreaterThan(c.startsAt.getTime());
      expect(c.minMovingMs).toBe(1_200_000);
      expect(c.source.url).toMatch(/^https:\/\//);
    }
    // 中秋那屆是 Asia/Taipei 的 2026-09-25，且標為 prototype、預設未啟用
    const moon = list.find((c) => c.themeId === "moonlit_steps")!;
    expect(localDayIn(moon.startsAt, moon.displayTimezone)).toBe("2026-09-25");
    expect([moon.prototype, moon.enabled]).toEqual([true, false]);
  });

  it("預設全部 enabled=false：設定檔進倉庫不等於活動上線", () => {
    expect(loadCampaignsFile("seasonal/campaigns.json").some((c) => c.enabled)).toBe(false);
  });
});

describe("跨帳號", () => {
  it("資格只看傳進來的那個錢包的運動（服務層以 wallet 取資料，compute 不看 wallet）", () => {
    const mine = resolveSeasonal([campaign()], [workout()], new Date("2027-03-18T00:00:00Z"), 2)[0]!;
    const empty = resolveSeasonal([campaign()], [], new Date("2027-03-18T00:00:00Z"), 2)[0]!;
    expect(mine.status).toBe("eligible");
    expect([empty.status, empty.first, empty.bestMovingMs]).toEqual(["locked", null, 0]);
  });
});
