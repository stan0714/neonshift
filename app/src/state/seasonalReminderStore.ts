/**
 * 節日提醒訂閱（PG-SEASON-06）。
 *
 * **裝置層、不分錢包、也不上傳**：訂閱的是公開活動，不是個人資料；未登入也看得到公開目錄，
 * 所以也該能訂閱。伺服器不保存這份清單——沒有推播通道的情況下，把「誰在等哪一屆」收到
 * 後端只是多存一份沒有用途的資料。
 */
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import { seasonalReminderKey, type SeasonalReminderPhase } from '@/domain/seasonalReminder';

const KEY = 'neonshift.seasonal-reminders.v1';
type Persisted = { subscribed: string[]; dismissed: string[] };
const EMPTY: Persisted = { subscribed: [], dismissed: [] };

type State = {
  loaded: boolean;
  subscribed: string[];
  dismissed: string[];
  load: () => Promise<void>;
  isOn: (campaignId: string) => boolean;
  toggle: (campaignId: string) => Promise<void>;
  /** 記下「這一屆的這個階段已經提醒過了」；下一個階段還是會再提醒一次 */
  dismiss: (campaignId: string, phase: SeasonalReminderPhase) => Promise<void>;
};

const persist = async (p: Persisted) => {
  try { await SecureStore.setItemAsync(KEY, JSON.stringify(p)); } catch { /* 寫不進去就只留在記憶體，不影響提醒本身 */ }
};
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export const useSeasonalReminderStore = create<State>((set, get) => ({
  loaded: false,
  ...EMPTY,

  async load() {
    if (get().loaded) return;
    let p = EMPTY;
    try {
      const raw = await SecureStore.getItemAsync(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Persisted>;
        p = { subscribed: strings(parsed.subscribed), dismissed: strings(parsed.dismissed) };
      }
    } catch { /* 讀不到就當沒訂閱過，不亂猜 */ }
    set({ ...p, loaded: true });
  },

  isOn(campaignId) {
    return get().subscribed.includes(campaignId);
  },

  async toggle(campaignId) {
    const s = get();
    const on = s.subscribed.includes(campaignId);
    const subscribed = on ? s.subscribed.filter((id) => id !== campaignId) : [...s.subscribed, campaignId];
    // 取消訂閱時連已讀記錄一起清掉：重新訂閱的人要能再收到這一屆的提醒
    const dismissed = on ? s.dismissed.filter((k) => !k.endsWith(`:${campaignId}`)) : s.dismissed;
    set({ subscribed, dismissed });
    await persist({ subscribed, dismissed });
  },

  async dismiss(campaignId, phase) {
    const key = seasonalReminderKey(campaignId, phase);
    const s = get();
    if (s.dismissed.includes(key)) return;
    const dismissed = [...s.dismissed, key];
    set({ dismissed });
    await persist({ subscribed: s.subscribed, dismissed });
  },
}));
