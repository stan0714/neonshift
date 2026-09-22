import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import type { QuestsResponse } from '@/services/api/ApiClient';

/**
 * XD-01：探索冊最後一次成功載入的快照（按錢包），離線／伺服器抖動時仍能看卡片狀態與截止，
 * 並標示「as of」；不是資格來源（可領／已領仍以伺服器回應為準，離線不顯示領取鈕）。
 */
const KEY = 'neonshift.quests.cache.v1';
type Snapshot = { wallet: string; asOf: string; data: QuestsResponse };
type State = {
  loaded: boolean;
  snapshot: Snapshot | null;
  load: () => Promise<void>;
  remember: (wallet: string, data: QuestsResponse, now?: Date) => Promise<void>;
  forWallet: (wallet: string | null) => Snapshot | null;
};

export const useQuestCache = create<State>((set, get) => ({
  loaded: false,
  snapshot: null,
  async load() {
    try {
      const raw = await SecureStore.getItemAsync(KEY);
      set({ snapshot: raw ? (JSON.parse(raw) as Snapshot) : null, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  async remember(wallet, data, now = new Date()) {
    const snapshot = { wallet, asOf: now.toISOString(), data };
    set({ snapshot, loaded: true });
    try { await SecureStore.setItemAsync(KEY, JSON.stringify(snapshot)); } catch { /* 下次載入再存 */ }
  },
  forWallet(wallet) {
    const s = get().snapshot;
    return s && wallet && s.wallet === wallet ? s : null;
  },
}));
