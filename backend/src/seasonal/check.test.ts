/**
 * PG-SEASON-06 年度營運工具：設定檔的驗證與表格輸出。
 * 這支工具存在的理由是「部署前就發現設定寫錯」，所以測試要釘住的是：
 * 表上印的是**換算回活動時區之後的實際日期**，而且設定寫錯時工具要失敗、不是安靜通過。
 */
import { describe, expect, it } from "vitest";

import { parseCampaigns, SeasonalConfigError } from "./campaigns.js";
import { checkRows, formatRows } from "./check.js";

const file = (over: Record<string, unknown> = {}) => ({
  version: 1 as const,
  campaigns: [
    {
      campaign_id: "moonlit-steps-2026-demo",
      theme_id: "moonlit_steps",
      year: 2026,
      art_version: 1,
      rules_version: 1,
      enabled: false,
      prototype: true,
      // 台北的 9/25 一整天 = UTC 9/24 16:00 → 9/25 16:00
      starts_at: "2026-09-24T16:00:00.000Z",
      ends_at: "2026-09-25T16:00:00.000Z",
      display_timezone: "Asia/Taipei",
      expect_local_days: ["2026-09-25"],
      min_moving_ms: 1_200_000,
      grace_ms: 604_800_000,
      source: { fact: "x", url: "https://example.com/a", checked_on: "2026-09-25" },
      ...over,
    },
  ],
});

describe("年度營運工具", () => {
  it("印出的是換算回活動時區的當地日期，不是 UTC 日期", () => {
    const rows = checkRows(parseCampaigns(file()), new Date("2026-09-25T00:00:00Z"));
    expect(rows[0]!.local_days).toEqual(["2026-09-25", "2026-09-25"]);
    // UTC 起始其實是前一天：只看 UTC 會以為紀念錯了一天
    expect(rows[0]!.starts_at).toBe("2026-09-24T16:00:00.000Z");
    expect(rows[0]!.window_state).toBe("open");
    expect(rows[0]!.min_moving_minutes).toBe(20);
    expect(rows[0]!.grace_days).toBe(7);
    expect(rows[0]!.grace_until).toBe("2026-10-02T16:00:00.000Z");
  });

  it("表格第一眼就看得到啟用與否，以及「目前沒有任何一屆對外出現」", () => {
    const now = new Date("2026-09-25T00:00:00Z");
    const text = formatRows(checkRows(parseCampaigns(file()), now), now);
    expect(text).toMatch(/\[disabled · prototype\]/);
    expect(text).toMatch(/目前沒有任何一屆對外出現/);
    expect(text).toMatch(/Asia\/Taipei/);
    // 表上不該出現任何錢包或個人資料——這支工具只讀設定檔
    expect(text).not.toMatch(/wallet|[1-9A-HJ-NP-Za-km-z]{32,}/);
  });

  it("啟用的屆次會列名，方便確認「今年開的是哪一屆」", () => {
    const now = new Date("2026-09-25T00:00:00Z");
    const text = formatRows(checkRows(parseCampaigns(file({ enabled: true })), now), now);
    expect(text).toMatch(/1 屆已啟用：moonlit-steps-2026-demo/);
  });

  it("窗口與宣告的當地日期對不上 → 直接失敗（DST／時區打錯在這裡被擋下）", () => {
    // 同樣的 UTC 窗口，宣告成 UTC 時區就會涵蓋到 9/24～9/25 兩天
    expect(() => parseCampaigns(file({ display_timezone: "UTC" }))).toThrow(SeasonalConfigError);
  });

  it("結束早於開始、同主題同年兩屆都不可能通過", () => {
    expect(() => parseCampaigns(file({ ends_at: "2026-09-24T16:00:00.000Z" }))).toThrow(SeasonalConfigError);
    const two = file();
    two.campaigns.push({ ...two.campaigns[0]!, campaign_id: "moonlit-steps-2026-again" });
    expect(() => parseCampaigns(two)).toThrow(/duplicate theme\/year/);
  });
});
