/**
 * 節日提醒的本機排程通知（PG-SEASON-06 的「系統推播」）。
 *
 * **只有本機排程，沒有遠端推播。** 這不是偷懶：訂閱清單依設計只存在這台裝置、不上傳
 * （`state/seasonalReminderStore.ts`），要走 push 就得把「誰在等哪一屆」送到後端並保存裝置
 * token，那會把一個公開活動的訂閱變成一筆個人資料，而且需要 FCM 專案與伺服器金鑰。
 * 每一屆的日期本來就是公開且事先已知的，手機自己算得出來——所以什麼都不用上傳。
 *
 * `expo-notifications` 仍會把 `firebase-messaging` 拉進 APK（模組的固定依賴），但本專案
 * **沒有套用 google-services 外掛、也沒有 `google-services.json`**，沒有設定檔它不會初始化，
 * 不會有推播連線。這裡用到的 API 全部是本機的：channel、權限、`scheduleNotificationAsync`。
 *
 * 設計上的兩個堅持：
 * - **不靜默要求權限**。權限只在使用者自己打開某一屆的提醒開關時要求（見 `SeasonalFootprints`）。
 * - **不叫人做已經做完的事**。已達標／待驗證的一屆不排（判定在 `domain/seasonalNotificationPlan.ts`）。
 *
 * 模組以 `require` 延後載入並包 try／catch：測試環境與任何沒有這個原生模組的執行環境
 * （例如舊的 development build）不會因此整個畫面掛掉，只會回 `unavailable`。
 */
import { t as translate, useLocaleStore, type TKey } from '@/i18n';
import { seasonalEditionName, seasonalReminderBody } from '@/domain/seasonalCopy';
import { parseSeasonalNotificationId, type PlannedSeasonalNotification } from '@/domain/seasonalNotificationPlan';

/** Android 頻道 id。Android 13+ 必須先有頻道，系統才可能彈出通知權限詢問 */
export const SEASONAL_CHANNEL_ID = 'seasonal-reminders';

export type SeasonalPermission = 'granted' | 'denied' | 'undetermined' | 'unavailable';

type ScheduledRow = { identifier: string; content?: { data?: Record<string, unknown> | null } | null };

/** 我們用到的 expo-notifications 子集。注入後可在測試中完整驗證取消／排程的差異運算 */
export type NotificationsApi = {
  getPermissionsAsync: () => Promise<{ status: string; granted?: boolean; canAskAgain?: boolean }>;
  requestPermissionsAsync: () => Promise<{ status: string; granted?: boolean }>;
  setNotificationChannelAsync: (id: string, options: Record<string, unknown>) => Promise<unknown>;
  getAllScheduledNotificationsAsync: () => Promise<ScheduledRow[]>;
  scheduleNotificationAsync: (request: Record<string, unknown>) => Promise<string>;
  cancelScheduledNotificationAsync: (identifier: string) => Promise<void>;
  SchedulableTriggerInputTypes: { DATE: string };
  AndroidImportance: { DEFAULT: number };
};

export function loadNotificationsApi(): NotificationsApi | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-notifications') as NotificationsApi;
  } catch {
    return null;
  }
}

const statusOf = (r: { status: string; granted?: boolean }): SeasonalPermission =>
  r.granted || r.status === 'granted' ? 'granted' : r.status === 'undetermined' ? 'undetermined' : 'denied';

async function ensureChannel(api: NotificationsApi, t: (k: TKey) => string) {
  // 頻道名稱走 i18n：它會出現在系統設定的通知頁面上，那也是使用者看得到的文案
  await api.setNotificationChannelAsync(SEASONAL_CHANNEL_ID, {
    name: t('season.notify.channel'),
    description: t('season.notify.channelDesc'),
    importance: api.AndroidImportance.DEFAULT,
  });
}

/** 目前的通知權限；不會觸發任何系統詢問 */
export async function seasonalNotificationPermission(api: NotificationsApi | null = loadNotificationsApi()): Promise<SeasonalPermission> {
  if (!api) return 'unavailable';
  try {
    return statusOf(await api.getPermissionsAsync());
  } catch {
    return 'unavailable';
  }
}

/**
 * 要求通知權限。**只能由使用者的明確動作觸發**（打開提醒開關）。
 * 先建頻道再要求：Android 13 的系統詢問在沒有任何頻道時不會出現。
 */
export async function requestSeasonalNotificationPermission(
  deps: { api?: NotificationsApi | null; t?: (k: TKey) => string } = {},
): Promise<SeasonalPermission> {
  const api = deps.api === undefined ? loadNotificationsApi() : deps.api;
  const t = deps.t ?? ((k: TKey) => translate(k));
  if (!api) return 'unavailable';
  try {
    await ensureChannel(api, t);
    const current = statusOf(await api.getPermissionsAsync());
    if (current === 'granted') return 'granted';
    return statusOf(await api.requestPermissionsAsync());
  } catch {
    return 'unavailable';
  }
}

export type SyncResult = {
  scheduled: string[];
  cancelled: string[];
  kept: string[];
  skipped?: 'unavailable' | 'denied' | 'error';
};

/**
 * 把系統裡「我們排的通知」調整成與 `plan` 一致。
 *
 * 差異運算而不是「全部取消再全部重排」：後者每次同步（前景切換、每 5 分鐘）都會重建鬧鐘，
 * 無謂地讓系統多做事，也會在不該變動的時候動到已排定的項目。
 *
 * 判定要不要重排時比對三件事，全部存在通知自己的 `data` 裡（不必猜 trigger 的形狀）：
 * 時刻（`fireAt`）、語言（`locale`，切語言後未來的通知要跟著換）與文字內容。
 */
export async function syncSeasonalNotifications(
  plan: readonly PlannedSeasonalNotification[],
  deps: { api?: NotificationsApi | null; locale?: string; t?: (k: TKey, p?: Record<string, string | number>) => string } = {},
): Promise<SyncResult> {
  const api = deps.api === undefined ? loadNotificationsApi() : deps.api;
  const empty: SyncResult = { scheduled: [], cancelled: [], kept: [] };
  if (!api) return { ...empty, skipped: 'unavailable' };
  const t = deps.t ?? ((k: TKey, p?: Record<string, string | number>) => translate(k, p));
  const locale = deps.locale ?? useLocaleStore.getState().locale;
  try {
    const permission = statusOf(await api.getPermissionsAsync());
    // 沒有權限就什麼都不做：系統本來就不會顯示，硬排只是讓狀態對不起來。
    // 也不在這裡要求權限——那要由使用者的動作觸發。
    if (permission !== 'granted') return { ...empty, skipped: 'denied' };
    await ensureChannel(api, t as (k: TKey) => string);

    const existing = await api.getAllScheduledNotificationsAsync();
    const ours = existing.filter((row) => parseSeasonalNotificationId(row.identifier) !== null);
    const want = new Map(plan.map((p) => [p.id, p] as const));

    const result: SyncResult = { scheduled: [], cancelled: [], kept: [] };
    const keep = new Set<string>();
    for (const row of ours) {
      const wanted = want.get(row.identifier);
      const data = (row.content?.data ?? {}) as Record<string, unknown>;
      const same =
        wanted !== undefined &&
        data.fireAt === wanted.fireAt.toISOString() &&
        data.locale === locale;
      if (same) { keep.add(row.identifier); result.kept.push(row.identifier); continue; }
      await api.cancelScheduledNotificationAsync(row.identifier);
      result.cancelled.push(row.identifier);
    }
    for (const p of plan) {
      if (keep.has(p.id)) continue;
      await api.scheduleNotificationAsync({
        identifier: p.id,
        content: {
          title: t('season.reminder.title'),
          body: seasonalReminderBody(t, p, seasonalEditionName(t, p.themeId, p.year)),
          // data 只放重建與比對所需的公開欄位：活動代號、階段、時刻、語言。
          // 沒有錢包位址、沒有路線、沒有任何個人資料——通知內容會留在系統的通知紀錄裡。
          data: { kind: 'seasonal', campaignId: p.campaignId, phase: p.phase, fireAt: p.fireAt.toISOString(), locale },
        },
        trigger: { type: api.SchedulableTriggerInputTypes.DATE, date: p.fireAt, channelId: SEASONAL_CHANNEL_ID },
      });
      result.scheduled.push(p.id);
    }
    return result;
  } catch {
    return { ...empty, skipped: 'error' };
  }
}

/** 取消所有我們排的節日通知（使用者關掉全部訂閱、或登出時用） */
export async function cancelAllSeasonalNotifications(api: NotificationsApi | null = loadNotificationsApi()): Promise<string[]> {
  if (!api) return [];
  try {
    const rows = await api.getAllScheduledNotificationsAsync();
    const ids = rows.filter((r) => parseSeasonalNotificationId(r.identifier) !== null).map((r) => r.identifier);
    for (const id of ids) await api.cancelScheduledNotificationAsync(id);
    return ids;
  } catch {
    return [];
  }
}
