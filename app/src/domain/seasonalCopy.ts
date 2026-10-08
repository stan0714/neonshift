/**
 * 節日章的共用文案組裝（PG-SEASON-06）。
 *
 * 抽出來的原因：同一句提醒現在有兩個出口——App 內的浮層（`SeasonalNotice`）與
 * **本機排程通知**（`services/notifications/seasonalNotifications.ts`）。兩邊各寫一份
 * 遲早會漂移，而提醒說的是期限這種「說錯就害人白跑一趟」的事，必須同一份。
 *
 * 不在這裡 import `t` 本體、只 import 型別：`t` 由呼叫端傳入，domain 層保持沒有 i18n 執行期依賴
 * （與 `domain/shareImage.ts` 同一個做法）。
 */
import type { TKey } from '@/i18n';
import type { SeasonalReminderPhase } from './seasonalReminder';

type Translate = (key: TKey, params?: Record<string, string | number>) => string;

/** 屆名：查不到譯名就用 `theme_id`，**不顯示 i18n key、也不顯示空字串** */
export function seasonalThemeName(t: Translate, themeId: string): string {
  const key = `season.name.${themeId}` as TKey;
  const s = t(key);
  return s === key ? themeId : s;
}

/** 屆名＋年份（`Moonlit Steps 2026`）：一屆一年，年份是它的身分的一部分 */
export const seasonalEditionName = (t: Translate, themeId: string, year: number) =>
  `${seasonalThemeName(t, themeId)} ${year}`;

/** 提醒句子需要的最小形狀；`SeasonalReminder` 與 `PlannedSeasonalNotification` 都符合 */
export type SeasonalReminderCopyInput = {
  phase: SeasonalReminderPhase;
  deadline: Date;
  displayTimezone: string;
  minMovingMinutes: number;
};

/** 截止時刻一律以**活動時區**顯示：提醒說的是活動的期限，不是裝置目前設定的時區 */
export function seasonalReminderBody(t: Translate, r: SeasonalReminderCopyInput, name: string): string {
  const when = r.deadline.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: r.displayTimezone });
  if (r.phase === 'open') return t('season.reminder.open', { name, when, min: r.minMovingMinutes });
  if (r.phase === 'grace') return t('season.reminder.grace', { name, when });
  return t('season.reminder.soon', { name, when, tz: r.displayTimezone });
}

/**
 * 日期依據（`source.fact`）依語言挑一句。
 *
 * 這是後端設定檔給的資料、不是 i18n 字典——後端不知道使用者的語言，所以兩種語言都給。
 * 2026-09-29 實機發現英文介面底下印著整段中文，就是因為這個欄位原本是單一字串。
 * 找不到當下語言時退回英文，再退回任何一個有值的——**寧可顯示另一種語言，也不要空白**，
 * 因為這一行的用途是「讓人可以自己去查日期依據」。
 */
export function seasonalSourceFact(fact: Record<string, string> | string | null | undefined, locale: string): string {
  if (typeof fact === 'string') return fact; // 舊版後端還沒換成分語言物件時的相容路徑
  if (!fact) return '';
  return fact[locale] ?? fact[locale.split('-')[0] ?? ''] ?? fact.en ?? Object.values(fact)[0] ?? '';
}
