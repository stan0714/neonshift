/**
 * PG-SEASON-06 提醒的判定（設計 §4「活動提醒由使用者訂閱；未做系統推播前只標 App 內提醒」）。
 * 重點是「什麼時候該提醒什麼」可以被釘住：沒訂閱不提醒、已達標不提醒、
 * 寬限期提醒的是補同步（不是再去走一趟），而且同一屆每個階段只提醒一次。
 */
import { nextSeasonalReminder, seasonalReminderKey, seasonalReminders, SEASONAL_REMINDER_LEAD_MS, type SeasonalReminderInput } from '@/domain/seasonalReminder';

const campaign = (o: Partial<SeasonalReminderInput> = {}): SeasonalReminderInput => ({
  campaign_id: 'genesis-stride-2027',
  theme_id: 'genesis_stride',
  year: 2027,
  window: { starts_at: '2027-03-16T00:00:00.000Z', ends_at: '2027-03-17T00:00:00.000Z', display_timezone: 'UTC' },
  rules: { min_moving_minutes: 20, grace_days: 7 },
  ...o,
});
const at = (iso: string) => new Date(iso);
const subs = (...ids: string[]) => new Set(ids);

test('沒訂閱就完全不提醒', () => {
  expect(seasonalReminders([campaign()], { now: at('2027-03-16T06:00:00Z'), subscribed: new Set() })).toEqual([]);
});

test('進行中 → open；截止時刻是窗口結束', () => {
  const r = nextSeasonalReminder([campaign()], { now: at('2027-03-16T06:00:00Z'), subscribed: subs('genesis-stride-2027') })!;
  expect(r.phase).toBe('open');
  expect(r.deadline.toISOString()).toBe('2027-03-17T00:00:00.000Z');
  expect(r.minMovingMinutes).toBe(20);
  expect(r.key).toBe(seasonalReminderKey('genesis-stride-2027', 'open'));
});

test('開始前 7 天內才提醒 soon；更早不提醒', () => {
  const starts = Date.parse('2027-03-16T00:00:00Z');
  const justInside = new Date(starts - SEASONAL_REMINDER_LEAD_MS + 1000);
  const tooEarly = new Date(starts - SEASONAL_REMINDER_LEAD_MS - 1000);
  expect(nextSeasonalReminder([campaign()], { now: justInside, subscribed: subs('genesis-stride-2027') })?.phase).toBe('soon');
  expect(nextSeasonalReminder([campaign()], { now: tooEarly, subscribed: subs('genesis-stride-2027') })).toBeNull();
});

test('結束後在寬限內 → grace，截止是補同步期限；寬限過了就不再提醒', () => {
  const r = nextSeasonalReminder([campaign()], { now: at('2027-03-18T00:00:00Z'), subscribed: subs('genesis-stride-2027') })!;
  expect(r.phase).toBe('grace');
  expect(r.deadline.toISOString()).toBe('2027-03-24T00:00:00.000Z'); // ends_at + 7 天
  expect(nextSeasonalReminder([campaign()], { now: at('2027-03-24T00:00:01Z'), subscribed: subs('genesis-stride-2027') })).toBeNull();
});

test('已達標或已上傳待驗證就不提醒（提醒只會讓人以為還沒完成）', () => {
  for (const status of ['eligible', 'pending_review'] as const) {
    expect(nextSeasonalReminder([campaign({ status })], { now: at('2027-03-16T06:00:00Z'), subscribed: subs('genesis-stride-2027') })).toBeNull();
  }
  expect(nextSeasonalReminder([campaign({ status: 'locked' })], { now: at('2027-03-16T06:00:00Z'), subscribed: subs('genesis-stride-2027') })?.phase).toBe('open');
});

test('關掉一個階段之後，同一屆進到下一個階段還是會再提醒', () => {
  const now = at('2027-03-15T12:00:00Z'); // soon
  const dismissed = new Set([seasonalReminderKey('genesis-stride-2027', 'soon')]);
  expect(nextSeasonalReminder([campaign()], { now, subscribed: subs('genesis-stride-2027'), dismissed })).toBeNull();
  // 窗口真的開了 → open 是另一個鍵，照樣提醒
  expect(nextSeasonalReminder([campaign()], { now: at('2027-03-16T06:00:00Z'), subscribed: subs('genesis-stride-2027'), dismissed })?.phase).toBe('open');
});

test('多屆時依「最該現在做什麼」排序：進行中 → 可補同步 → 還沒開始', () => {
  const open = campaign({ campaign_id: 'open-2027', window: { starts_at: '2027-03-16T00:00:00.000Z', ends_at: '2027-03-17T00:00:00.000Z', display_timezone: 'UTC' } });
  const grace = campaign({ campaign_id: 'grace-2027', window: { starts_at: '2027-03-10T00:00:00.000Z', ends_at: '2027-03-11T00:00:00.000Z', display_timezone: 'UTC' } });
  const soon = campaign({ campaign_id: 'soon-2027', window: { starts_at: '2027-03-18T00:00:00.000Z', ends_at: '2027-03-19T00:00:00.000Z', display_timezone: 'UTC' } });
  const order = seasonalReminders([soon, grace, open], { now: at('2027-03-16T06:00:00Z'), subscribed: subs('open-2027', 'grace-2027', 'soon-2027') }).map((r) => r.campaignId);
  expect(order).toEqual(['open-2027', 'grace-2027', 'soon-2027']);
});

test('壞掉的日期不會變成一個假的提醒', () => {
  const bad = campaign({ window: { starts_at: 'not-a-date', ends_at: '2027-03-17T00:00:00.000Z', display_timezone: 'UTC' } });
  expect(seasonalReminders([bad], { now: at('2027-03-16T06:00:00Z'), subscribed: subs('genesis-stride-2027') })).toEqual([]);
});
