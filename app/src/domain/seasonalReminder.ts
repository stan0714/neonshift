/**
 * 節日提醒（PG-SEASON-06；docs/design/seasonal-achievement-nfts.md §4）。
 *
 * 設計那一行寫得很清楚：「活動提醒由使用者訂閱；**未做系統推播前只標 App 內提醒**」。
 * 這支 App 目前沒有本機排程通知也沒有推播（`modules/neonshift-notify` 只負責運動中的
 * 前景服務頻道），所以提醒只能在「使用者自己打開 App」時出現——文案必須說出這件事，
 * 不能讓人以為訂閱了就會在節日當天被叫醒。
 *
 * 這一層是純函式：要提醒哪一屆、提醒什麼階段，可以用單元測試釘住，不必開畫面看。
 */

/** 開始前幾天開始提醒。太早提醒會被當雜訊，太晚提醒來不及安排一次 20 分鐘的健走 */
export const SEASONAL_REMINDER_LEAD_MS = 7 * 24 * 60 * 60 * 1000;

export type SeasonalReminderPhase = 'open' | 'grace' | 'soon';

export type SeasonalReminderInput = {
  campaign_id: string;
  theme_id: string;
  year: number;
  window: { starts_at: string; ends_at: string; display_timezone: string };
  rules: { min_moving_minutes: number; grace_days: number };
  /** 只有登入後才有；已達標或待驗證的一屆不需要提醒 */
  status?: 'locked' | 'pending_review' | 'eligible';
};

export type SeasonalReminder = {
  campaignId: string;
  themeId: string;
  year: number;
  phase: SeasonalReminderPhase;
  /** 這個階段的截止時刻：`soon` 是開始時間，`open` 是結束時間，`grace` 是補同步期限 */
  deadline: Date;
  minMovingMinutes: number;
  displayTimezone: string;
  /** 已讀記錄的鍵：同一屆每個階段各提醒一次，關掉 `soon` 之後窗口真的開了還是會再提醒 */
  key: string;
};

export const seasonalReminderKey = (campaignId: string, phase: SeasonalReminderPhase) => `${phase}:${campaignId}`;

/**
 * 依「最該現在做什麼」排序，而不是依時間先後：
 *   `open`（還能出門走一趟）＞ `grace`（只能把已經走過的那筆同步上來）＞ `soon`（還沒開始）。
 * 同階段取截止最近的那一屆。
 */
const PHASE_ORDER: Record<SeasonalReminderPhase, number> = { open: 0, grace: 1, soon: 2 };

export function seasonalReminders(
  items: readonly SeasonalReminderInput[],
  opts: { now: Date; subscribed: ReadonlySet<string>; dismissed?: ReadonlySet<string> },
): SeasonalReminder[] {
  const now = opts.now.getTime();
  const out: SeasonalReminder[] = [];
  for (const c of items) {
    if (!opts.subscribed.has(c.campaign_id)) continue;
    // 已達標或已上傳待驗證：沒有要提醒的動作，提醒只會讓人以為還沒完成
    if (c.status === 'eligible' || c.status === 'pending_review') continue;
    const starts = Date.parse(c.window.starts_at);
    const ends = Date.parse(c.window.ends_at);
    if (!Number.isFinite(starts) || !Number.isFinite(ends)) continue;
    const graceEnds = ends + c.rules.grace_days * 24 * 60 * 60 * 1000;
    let phase: SeasonalReminderPhase | null = null;
    let deadline = new Date(starts);
    if (now >= starts && now < ends) {
      phase = 'open';
      deadline = new Date(ends);
    } else if (now >= ends && now < graceEnds) {
      // 寬限只放寬「上傳時間」，不放寬運動時間——文案要說的是「把窗口內那一筆同步上來」
      phase = 'grace';
      deadline = new Date(graceEnds);
    } else if (now < starts && starts - now <= SEASONAL_REMINDER_LEAD_MS) {
      phase = 'soon';
      deadline = new Date(starts);
    }
    if (!phase) continue;
    const key = seasonalReminderKey(c.campaign_id, phase);
    if (opts.dismissed?.has(key)) continue;
    out.push({ campaignId: c.campaign_id, themeId: c.theme_id, year: c.year, phase, deadline, minMovingMinutes: c.rules.min_moving_minutes, displayTimezone: c.window.display_timezone, key });
  }
  return out.sort((a, b) => PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase] || a.deadline.getTime() - b.deadline.getTime());
}

/** 目前最該提醒的那一件；沒有就 null */
export function nextSeasonalReminder(
  items: readonly SeasonalReminderInput[],
  opts: { now: Date; subscribed: ReadonlySet<string>; dismissed?: ReadonlySet<string> },
): SeasonalReminder | null {
  return seasonalReminders(items, opts)[0] ?? null;
}
