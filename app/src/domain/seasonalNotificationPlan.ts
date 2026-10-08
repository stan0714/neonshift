/**
 * 節日提醒的**本機排程計畫**（PG-SEASON-06；docs/design/seasonal-achievement-nfts.md §4）。
 *
 * 為什麼是本機排程、不是伺服器推播：訂閱清單依設計只存在這台裝置、不上傳
 * （見 `state/seasonalReminderStore.ts`）。要走 push 就得把「誰在等哪一屆」收到後端並保存
 * 裝置 token，那會把一個公開活動的訂閱變成一筆個人資料。每一屆的日期在設定檔裡本來就是
 * 公開且事先已知的，所以排程完全可以在手機上算完——不需要 FCM、不需要伺服器、不需要 token。
 *
 * 這一層只算「要在哪些時刻發什麼」，不碰 expo-notifications：
 * 排程時刻的算法可以用單元測試釘住，不必開畫面也不必真的等到那一天。
 *
 * 三個時刻對應 `seasonalReminder.ts` 的三個階段，語意一致：
 *   `soon`  開始前 7 天  → 還有時間安排一次 20 分鐘的健走
 *   `open`  窗口開啟時刻 → 現在可以出門了
 *   `grace` 窗口結束時刻 → 運動時間已經過了，只剩「把那一筆同步上來」
 */
import { SEASONAL_REMINDER_LEAD_MS, type SeasonalReminderInput, type SeasonalReminderPhase } from './seasonalReminder';

/** 排程通知的 id 前綴。用它把「我們排的」跟系統裡其他通知分開，取消時不會誤殺別人的 */
export const SEASONAL_NOTIFICATION_PREFIX = 'seasonal:';

/**
 * 一次最多排幾個。不是系統限制，是判斷：為很遠的未來排一堆鬧鐘沒有意義
 * （設定會改、使用者會取消訂閱），而且排程越多、重開機後要重建的越多。
 */
export const SEASONAL_NOTIFICATION_MAX = 12;

export type PlannedSeasonalNotification = {
  /** 穩定且可重算：同一屆同一階段永遠是同一個 id，所以重複同步不會排出第二個 */
  id: string;
  campaignId: string;
  themeId: string;
  year: number;
  phase: SeasonalReminderPhase;
  fireAt: Date;
  minMovingMinutes: number;
  displayTimezone: string;
  /** 這個階段的截止時刻（`soon`／`open` 是窗口結束，`grace` 是補同步期限），用於文案中的「到什麼時候」 */
  deadline: Date;
};

export const seasonalNotificationId = (campaignId: string, phase: SeasonalReminderPhase) =>
  `${SEASONAL_NOTIFICATION_PREFIX}${phase}:${campaignId}`;

/** 反解 id；不是我們排的就回 null（取消時用來避免誤殺其他通知） */
export function parseSeasonalNotificationId(id: string): { campaignId: string; phase: SeasonalReminderPhase } | null {
  if (!id.startsWith(SEASONAL_NOTIFICATION_PREFIX)) return null;
  const rest = id.slice(SEASONAL_NOTIFICATION_PREFIX.length);
  const at = rest.indexOf(':');
  if (at <= 0) return null;
  const phase = rest.slice(0, at);
  const campaignId = rest.slice(at + 1);
  if (!campaignId) return null;
  if (phase !== 'soon' && phase !== 'open' && phase !== 'grace') return null;
  return { campaignId, phase };
}

/**
 * 算出應該存在的排程。**只會回未來的時刻**——過去的時刻排了也不會響，只會讓
 * 「系統裡有什麼」跟「應該有什麼」對不起來，之後每次同步都想重排一次。
 *
 * 已達標（`eligible`）或已上傳待驗證（`pending_review`）的一屆完全不排：
 * 那兩種狀態沒有要做的動作，在節日當天被通知「快去走」只會讓人以為自己漏了什麼。
 * 未登入時沒有 `status`，照排——公開目錄看得到的活動就該能被提醒。
 */
export function seasonalNotificationPlan(
  items: readonly SeasonalReminderInput[],
  opts: { now: Date; subscribed: ReadonlySet<string>; max?: number },
): PlannedSeasonalNotification[] {
  const now = opts.now.getTime();
  const out: PlannedSeasonalNotification[] = [];
  for (const c of items) {
    if (!opts.subscribed.has(c.campaign_id)) continue;
    if (c.status === 'eligible' || c.status === 'pending_review') continue;
    const starts = Date.parse(c.window.starts_at);
    const ends = Date.parse(c.window.ends_at);
    if (!Number.isFinite(starts) || !Number.isFinite(ends)) continue;
    const graceEnds = ends + c.rules.grace_days * 24 * 60 * 60 * 1000;
    const base = { campaignId: c.campaign_id, themeId: c.theme_id, year: c.year, minMovingMinutes: c.rules.min_moving_minutes, displayTimezone: c.window.display_timezone };
    const at: { phase: SeasonalReminderPhase; fireAt: number; deadline: number }[] = [
      { phase: 'soon', fireAt: starts - SEASONAL_REMINDER_LEAD_MS, deadline: starts },
      { phase: 'open', fireAt: starts, deadline: ends },
      // 寬限期只放寬上傳時間，不放寬運動時間：這一則講的是「補同步」，期限是 graceEnds
      { phase: 'grace', fireAt: ends, deadline: graceEnds },
    ];
    for (const a of at) {
      if (a.fireAt <= now) continue;
      // grace_days 為 0 時窗口一結束就沒有補同步期限，那一則沒有意義
      if (a.phase === 'grace' && graceEnds <= ends) continue;
      out.push({ id: seasonalNotificationId(c.campaign_id, a.phase), ...base, phase: a.phase, fireAt: new Date(a.fireAt), deadline: new Date(a.deadline) });
    }
  }
  // 近的先排：超過上限時砍掉的是最遠的那些，它們之後同步時還會再被排進來
  out.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime() || a.campaignId.localeCompare(b.campaignId));
  return out.slice(0, opts.max ?? SEASONAL_NOTIFICATION_MAX);
}
