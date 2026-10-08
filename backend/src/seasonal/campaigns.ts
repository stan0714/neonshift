/**
 * PG-SEASON-01：節日收藏的每屆設定（docs/design/seasonal-achievement-nfts.md §5）。
 *
 * 設定寫在檔案而不是資料庫：每屆要先人工核對日期來源才可發布，把來源 URL 與核對日期
 * 跟窗口放在同一份可 review、可 diff 的檔案裡，比藏在後台資料列更難出錯。
 *
 * 窗口一律是明確的 UTC 瞬間 `[starts_at, ends_at)`。地方節日不在伺服器做「當地日期 → UTC」
 * 換算（那會把 DST 與曆法錯誤帶進資格判定），改由發布者算好 UTC，再用 `display_timezone`
 * ＋ `expect_local_days` 讓 loader 反算驗證：算錯或打錯會在啟動時就被擋下。
 */
import { readFileSync } from "node:fs";
import { z } from "zod";

/**
 * 日期依據。
 *
 * `fact` 是**分語言**的：它會原樣顯示在 App 的節日卡上，而 App 支援繁中與英文。
 * 2026-09-29 實機發現英文介面底下印著整段中文——因為這個欄位原本是單一字串，
 * 後端不知道使用者的語言，前端也無從翻譯。改成物件之後由前端依當下語言挑，
 * 兩種語言都必填（缺一邊就會在 `seasonal:check` 擋下，而不是上線後才被看見）。
 *
 * `internal_note` 是**給我們自己看的**（例如「這個日期每年要重新核對」），
 * **永遠不會出現在 API 回應裡**——那種話寫給使用者看只會造成困惑。
 */
const sourceSchema = z
  .object({
    fact: z.object({ "zh-TW": z.string().min(1), en: z.string().min(1) }).strict(),
    url: z.string().url(),
    checked_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    internal_note: z.string().min(1).optional(),
  })
  .strict();

const campaignSchema = z
  .object({
    campaign_id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    theme_id: z.string().regex(/^[a-z][a-z0-9_]*$/),
    year: z.number().int().min(2020).max(2100),
    art_version: z.number().int().positive(),
    rules_version: z.number().int().positive(),
    enabled: z.boolean(),
    /** Demo 用的測試窗口必須標出來，UI 一律顯示 Prototype，不冒充真實節日紀錄 */
    prototype: z.boolean().default(false),
    starts_at: z.string().datetime(),
    ends_at: z.string().datetime(),
    display_timezone: z.string().min(1),
    expect_local_days: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1),
    min_moving_ms: z.number().int().positive(),
    grace_ms: z.number().int().nonnegative(),
    source: sourceSchema,
  })
  .strict();

const fileSchema = z.object({ version: z.literal(1), note: z.string().optional(), campaigns: z.array(campaignSchema) }).strict();

export type SeasonalCampaign = {
  campaignId: string;
  themeId: string;
  year: number;
  artVersion: number;
  rulesVersion: number;
  enabled: boolean;
  prototype: boolean;
  startsAt: Date;
  endsAt: Date;
  displayTimezone: string;
  minMovingMs: number;
  graceMs: number;
  source: { fact: Record<"zh-TW" | "en", string>; url: string; checkedOn: string };
};

/** 以宣告的時區把瞬間格式成當地日期；用來驗證 UTC 窗口真的落在打算紀念的那一天 */
export function localDayIn(instant: Date, timeZone: string): string {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  return f.format(instant); // en-CA → YYYY-MM-DD
}

export class SeasonalConfigError extends Error {}

export function parseCampaigns(raw: unknown): SeasonalCampaign[] {
  const parsed = fileSchema.safeParse(raw);
  if (!parsed.success) throw new SeasonalConfigError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const out: SeasonalCampaign[] = [];
  const ids = new Set<string>();
  const themeYears = new Set<string>();
  for (const c of parsed.data.campaigns) {
    const startsAt = new Date(c.starts_at);
    const endsAt = new Date(c.ends_at);
    if (ids.has(c.campaign_id)) throw new SeasonalConfigError(`duplicate campaign_id ${c.campaign_id}`);
    ids.add(c.campaign_id);
    // 同一主題同一年只能有一屆：否則「每玩家每屆一枚」會變成同年兩枚
    const ty = `${c.theme_id}:${c.year}`;
    if (themeYears.has(ty)) throw new SeasonalConfigError(`duplicate theme/year ${ty}`);
    themeYears.add(ty);
    if (endsAt.getTime() <= startsAt.getTime()) throw new SeasonalConfigError(`${c.campaign_id}: ends_at must be after starts_at`);
    try {
      localDayIn(startsAt, c.display_timezone);
    } catch {
      throw new SeasonalConfigError(`${c.campaign_id}: unknown display_timezone ${c.display_timezone}`);
    }
    // 反算驗證：窗口的第一與最後一刻換算到宣告時區後，必須就是要紀念的那些當地日期
    const first = localDayIn(startsAt, c.display_timezone);
    const last = localDayIn(new Date(endsAt.getTime() - 1), c.display_timezone);
    const expected = c.expect_local_days;
    if (first !== expected[0] || last !== expected[expected.length - 1]) {
      throw new SeasonalConfigError(`${c.campaign_id}: window covers ${first}…${last} in ${c.display_timezone}, expected ${expected[0]}…${expected[expected.length - 1]}`);
    }
    out.push({
      campaignId: c.campaign_id,
      themeId: c.theme_id,
      year: c.year,
      artVersion: c.art_version,
      rulesVersion: c.rules_version,
      enabled: c.enabled,
      prototype: c.prototype,
      startsAt,
      endsAt,
      displayTimezone: c.display_timezone,
      minMovingMs: c.min_moving_ms,
      graceMs: c.grace_ms,
      // internal_note 刻意不帶進來：它連進入這個型別的機會都沒有，就不可能不小心被回給前端
      source: { fact: c.source.fact, url: c.source.url, checkedOn: c.source.checked_on },
    });
  }
  return out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

export function loadCampaignsFile(path: string): SeasonalCampaign[] {
  return parseCampaigns(JSON.parse(readFileSync(path, "utf8")));
}
