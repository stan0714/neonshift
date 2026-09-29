/**
 * PG-SEASON-06 的本機排程通知：排程計畫（純函式）與差異同步（注入假的 expo-notifications）。
 *
 * 這裡刻意不測「通知真的在那一天響了」——那要實機等到那一天。能自動驗的是
 * 「該排哪些、不該排哪些、重複同步不會排出第二份、狀況改變時會取消」。
 */
import { seasonalSourceFact } from '@/domain/seasonalCopy';
import {
  SEASONAL_NOTIFICATION_PREFIX,
  parseSeasonalNotificationId,
  seasonalNotificationId,
  seasonalNotificationPlan,
} from '@/domain/seasonalNotificationPlan';
import { SEASONAL_REMINDER_LEAD_MS, type SeasonalReminderInput } from '@/domain/seasonalReminder';
import {
  cancelAllSeasonalNotifications,
  syncSeasonalNotifications,
  type NotificationsApi,
} from '@/services/notifications/seasonalNotifications';

const DAY = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();
const NOW = Date.parse('2026-03-01T00:00:00Z');

const campaign = (over: Partial<SeasonalReminderInput> = {}): SeasonalReminderInput => ({
  campaign_id: 'moon-2026',
  theme_id: 'moonlit_steps',
  year: 2026,
  window: { starts_at: iso(NOW + 30 * DAY), ends_at: iso(NOW + 32 * DAY), display_timezone: 'Asia/Taipei' },
  rules: { min_moving_minutes: 20, grace_days: 3 },
  ...over,
});

const subscribed = new Set(['moon-2026']);

describe('排程計畫', () => {
  test('訂閱的一屆排三個時刻：開始前 7 天、窗口開啟、窗口結束', () => {
    const plan = seasonalNotificationPlan([campaign()], { now: new Date(NOW), subscribed });
    expect(plan.map((p) => p.phase)).toEqual(['soon', 'open', 'grace']);
    expect(plan[0].fireAt.toISOString()).toBe(iso(NOW + 30 * DAY - SEASONAL_REMINDER_LEAD_MS));
    expect(plan[1].fireAt.toISOString()).toBe(iso(NOW + 30 * DAY));
    expect(plan[2].fireAt.toISOString()).toBe(iso(NOW + 32 * DAY));
    // grace 這一則說的是補同步期限，不是窗口結束
    expect(plan[2].deadline.toISOString()).toBe(iso(NOW + 32 * DAY + 3 * DAY));
  });

  test('沒訂閱就不排', () => {
    expect(seasonalNotificationPlan([campaign()], { now: new Date(NOW), subscribed: new Set() })).toEqual([]);
  });

  test('已達標或待驗證的一屆不排——那兩種狀態沒有要做的動作', () => {
    for (const status of ['eligible', 'pending_review'] as const) {
      expect(seasonalNotificationPlan([campaign({ status })], { now: new Date(NOW), subscribed })).toEqual([]);
    }
    expect(seasonalNotificationPlan([campaign({ status: 'locked' })], { now: new Date(NOW), subscribed })).toHaveLength(3);
  });

  test('已經過去的時刻不排（排了也不會響，只會讓狀態永遠對不起來）', () => {
    // 窗口已經開了：soon 過去了，只剩 open 之後的 grace
    const now = new Date(NOW + 31 * DAY);
    const plan = seasonalNotificationPlan([campaign()], { now, subscribed });
    expect(plan.map((p) => p.phase)).toEqual(['grace']);
  });

  test('grace_days 為 0 時沒有補同步期限，不排那一則', () => {
    const plan = seasonalNotificationPlan([campaign({ rules: { min_moving_minutes: 20, grace_days: 0 } })], { now: new Date(NOW), subscribed });
    expect(plan.map((p) => p.phase)).toEqual(['soon', 'open']);
  });

  test('窗口日期壞掉時跳過該屆，不丟例外', () => {
    const bad = campaign({ window: { starts_at: 'not-a-date', ends_at: 'nope', display_timezone: 'UTC' } });
    expect(seasonalNotificationPlan([bad], { now: new Date(NOW), subscribed })).toEqual([]);
  });

  test('超過上限時留下最近的那些', () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      campaign({ campaign_id: `c${i}`, window: { starts_at: iso(NOW + (10 + i) * DAY), ends_at: iso(NOW + (12 + i) * DAY), display_timezone: 'UTC' } }),
    );
    const plan = seasonalNotificationPlan(many, { now: new Date(NOW), subscribed: new Set(many.map((c) => c.campaign_id)), max: 4 });
    expect(plan).toHaveLength(4);
    const times = plan.map((p) => p.fireAt.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  test('id 可往返，且不是我們排的 id 一律回 null', () => {
    const id = seasonalNotificationId('moon-2026', 'open');
    expect(id.startsWith(SEASONAL_NOTIFICATION_PREFIX)).toBe(true);
    expect(parseSeasonalNotificationId(id)).toEqual({ campaignId: 'moon-2026', phase: 'open' });
    // 活動代號本身含冒號時也要解得回來
    expect(parseSeasonalNotificationId(seasonalNotificationId('a:b', 'soon'))).toEqual({ campaignId: 'a:b', phase: 'soon' });
    for (const other of ['workout-reminder', 'seasonal:', 'seasonal:bogus:x', 'seasonal:open:']) {
      expect(parseSeasonalNotificationId(other)).toBeNull();
    }
  });
});

type Row = { identifier: string; content?: { data?: Record<string, unknown> | null } | null };

function fakeApi(over: Partial<NotificationsApi> & { existing?: Row[]; permission?: string } = {}) {
  const scheduled: Record<string, unknown>[] = [];
  const cancelled: string[] = [];
  const channels: string[] = [];
  let rows: Row[] = over.existing ?? [];
  const api: NotificationsApi = {
    getPermissionsAsync: async () => ({ status: over.permission ?? 'granted' }),
    requestPermissionsAsync: async () => ({ status: over.permission ?? 'granted' }),
    setNotificationChannelAsync: async (id) => { channels.push(id); return null; },
    getAllScheduledNotificationsAsync: async () => rows,
    scheduleNotificationAsync: async (req) => { scheduled.push(req); return String(req.identifier); },
    cancelScheduledNotificationAsync: async (id) => { cancelled.push(id); rows = rows.filter((r) => r.identifier !== id); },
    SchedulableTriggerInputTypes: { DATE: 'date' },
    AndroidImportance: { DEFAULT: 3 },
    ...over,
  };
  return { api, scheduled, cancelled, channels };
}

const t = ((k: string, p?: Record<string, string | number>) => (p ? `${k}|${JSON.stringify(p)}` : k)) as never;

describe('差異同步', () => {
  test('沒有權限就什麼都不做，也不偷偷要求權限', async () => {
    const f = fakeApi({ permission: 'denied' });
    const plan = seasonalNotificationPlan([campaign()], { now: new Date(NOW), subscribed });
    const r = await syncSeasonalNotifications(plan, { api: f.api, locale: 'en', t });
    expect(r.skipped).toBe('denied');
    expect(f.scheduled).toHaveLength(0);
    expect(f.cancelled).toHaveLength(0);
  });

  test('沒有這個原生模組時回 unavailable，不丟例外', async () => {
    const r = await syncSeasonalNotifications([], { api: null, locale: 'en', t });
    expect(r.skipped).toBe('unavailable');
  });

  test('第一次同步會建頻道並排完整份，內容不含任何個人資料', async () => {
    const f = fakeApi();
    const plan = seasonalNotificationPlan([campaign()], { now: new Date(NOW), subscribed });
    const r = await syncSeasonalNotifications(plan, { api: f.api, locale: 'en', t });
    expect(r.scheduled).toHaveLength(3);
    expect(f.channels).toEqual(['seasonal-reminders']);
    const data = (f.scheduled[0].content as { data: Record<string, unknown> }).data;
    expect(Object.keys(data).sort()).toEqual(['campaignId', 'fireAt', 'kind', 'locale', 'phase']);
    expect(JSON.stringify(f.scheduled)).not.toMatch(/wallet|address|[1-9A-HJ-NP-Za-km-z]{32,}/);
  });

  test('再同步一次不會排出第二份（id 與時刻都沒變就保留）', async () => {
    const plan = seasonalNotificationPlan([campaign()], { now: new Date(NOW), subscribed });
    const existing: Row[] = plan.map((p) => ({ identifier: p.id, content: { data: { fireAt: p.fireAt.toISOString(), locale: 'en' } } }));
    const f = fakeApi({ existing });
    const r = await syncSeasonalNotifications(plan, { api: f.api, locale: 'en', t });
    expect(r.kept).toHaveLength(3);
    expect(f.scheduled).toHaveLength(0);
    expect(f.cancelled).toHaveLength(0);
  });

  test('換語言會重排，讓還沒響的通知跟著換語言', async () => {
    const plan = seasonalNotificationPlan([campaign()], { now: new Date(NOW), subscribed });
    const existing: Row[] = plan.map((p) => ({ identifier: p.id, content: { data: { fireAt: p.fireAt.toISOString(), locale: 'en' } } }));
    const f = fakeApi({ existing });
    const r = await syncSeasonalNotifications(plan, { api: f.api, locale: 'zh-TW', t });
    expect(r.cancelled).toHaveLength(3);
    expect(r.scheduled).toHaveLength(3);
  });

  test('取消訂閱後那一屆的排程會被取消，別人的通知不動', async () => {
    const plan = seasonalNotificationPlan([campaign()], { now: new Date(NOW), subscribed });
    const existing: Row[] = [
      ...plan.map((p) => ({ identifier: p.id, content: { data: { fireAt: p.fireAt.toISOString(), locale: 'en' } } })),
      { identifier: 'workout-autopause', content: { data: {} } },
    ];
    const f = fakeApi({ existing });
    const r = await syncSeasonalNotifications([], { api: f.api, locale: 'en', t });
    expect(r.cancelled.sort()).toEqual(plan.map((p) => p.id).sort());
    expect(f.cancelled).not.toContain('workout-autopause');
  });

  test('cancelAll 只取消我們排的', async () => {
    const f = fakeApi({ existing: [{ identifier: seasonalNotificationId('a', 'open') }, { identifier: 'other' }] });
    const ids = await cancelAllSeasonalNotifications(f.api);
    expect(ids).toEqual([seasonalNotificationId('a', 'open')]);
    expect(f.cancelled).toEqual([seasonalNotificationId('a', 'open')]);
  });

  test('模組丟例外時回 error，不讓呼叫端炸掉', async () => {
    const f = fakeApi({ getAllScheduledNotificationsAsync: async () => { throw new Error('boom'); } });
    const r = await syncSeasonalNotifications([], { api: f.api, locale: 'en', t });
    expect(r.skipped).toBe('error');
  });
});

/**
 * 2026-09-29 實機：英文介面的節日卡底下印著整段中文——`source.fact` 是後端設定檔給的
 * 單一字串，後端不知道使用者的語言，前端也無從翻譯。改成分語言物件後由 App 挑。
 */
describe('日期依據依語言挑（source.fact）', () => {
  const fact = { 'zh-TW': '中文依據', en: 'english reference' };

  test('挑當下語言', () => {
    expect(seasonalSourceFact(fact, 'en')).toBe('english reference');
    expect(seasonalSourceFact(fact, 'zh-TW')).toBe('中文依據');
  });

  test('只有語系前綴也要能對上（zh-Hant → zh 找不到才退回）', () => {
    expect(seasonalSourceFact({ zh: '中文', en: 'english' }, 'zh-TW')).toBe('中文');
  });

  test('找不到當下語言就退回英文——寧可顯示另一種語言也不要空白', () => {
    expect(seasonalSourceFact(fact, 'ja')).toBe('english reference');
    expect(seasonalSourceFact({ 'zh-TW': '只有中文' }, 'en')).toBe('只有中文');
  });

  test('舊版後端仍給字串時照樣顯示（相容路徑）', () => {
    expect(seasonalSourceFact('legacy string', 'en')).toBe('legacy string');
  });

  test('沒有值時回空字串，不丟例外、不顯示 undefined', () => {
    expect(seasonalSourceFact(null, 'en')).toBe('');
    expect(seasonalSourceFact({}, 'en')).toBe('');
  });
});
