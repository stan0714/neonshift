/**
 * 資料與同步偏好（PG-LINK-02，docs/shoe-sync-activity.md §3）：「連上網自動同步運動紀錄」預設**關閉**，升級舊版同樣不默認同意。
 * 依玩家（錢包）分區保存；訪客不保存。開啟後只在可連線且已登入時上傳已保存的運動摘要（原始 GPS 留在本機，不自動申領／簽署）。
 * Health Connect 讀取權限與這個上傳同意分開。
 */
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import { useWalletStore } from './walletStore';

export type SyncPrefs = { autoSyncWorkouts: boolean; lastSuccessAt: number | null };
const DEFAULTS: SyncPrefs = { autoSyncWorkouts: false, lastSuccessAt: null };
const keyOf = (owner: string) => `neonshift.sync.v1.${owner}`;

type State = SyncPrefs & {
  owner: string | null;
  loaded: boolean;
  load: (owner: string | null) => Promise<void>;
  setAutoSync: (enabled: boolean) => Promise<void>;
  markSuccess: (owner: string, at: number) => Promise<void>;
  /** 給非 React 程式（recorder／outbox）查：該玩家是否已開啟自動同步；未載入或訪客 → false */
  isAutoEnabled: (owner: string | null) => boolean;
};

const persist = async (owner: string | null, prefs: SyncPrefs) => {
  if (!owner) return;
  try { await SecureStore.setItemAsync(keyOf(owner), JSON.stringify(prefs)); } catch { /* 保留記憶體值 */ }
};

export const useSyncPrefs = create<State>((set, get) => ({
  ...DEFAULTS,
  owner: null,
  loaded: false,
  async load(owner) {
    if (!owner) { set({ ...DEFAULTS, owner: null, loaded: true }); return; }
    let prefs = DEFAULTS;
    try {
      const raw = await SecureStore.getItemAsync(keyOf(owner));
      if (raw) prefs = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<SyncPrefs>) };
    } catch { /* 預設 */ }
    set({ ...prefs, owner, loaded: true });
  },
  async setAutoSync(enabled) {
    const next = { autoSyncWorkouts: enabled, lastSuccessAt: get().lastSuccessAt };
    set(next);
    await persist(get().owner, next);
  },
  async markSuccess(owner, at) {
    if (get().owner !== owner) return;
    const next = { autoSyncWorkouts: get().autoSyncWorkouts, lastSuccessAt: at };
    set(next);
    await persist(owner, next);
  },
  isAutoEnabled(owner) {
    const s = get();
    return !!owner && s.loaded && s.owner === owner && s.autoSyncWorkouts;
  },
}));

useWalletStore.subscribe((s, prev) => {
  const owner = s.session?.address ?? null;
  if (owner !== (prev.session?.address ?? null)) void useSyncPrefs.getState().load(owner);
});
