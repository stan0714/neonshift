/**
 * 升級 reveal（PG-A-17，Style 12／15）：跑鞋等級由 XP 在鏈上自動提升，App 只在觀察到等級比上次看到的高時
 * 播放一次 reveal（motion.celebration、success haptic），並記住已看到的等級，重啟或重新同步不重播。
 */
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import type { ShoeLevel } from '@/config/shoeProgression';

const KEY = 'neonshift.shoe.lastSeenLevel.v1';

type State = {
  lastSeen: ShoeLevel | null;
  loaded: boolean;
  pending: { from: ShoeLevel; to: ShoeLevel } | null;
  /** 最近一次打卡交易（reveal 提供 transaction link） */
  lastTxSignature: string | null;
  load: () => Promise<void>;
  observe: (level: ShoeLevel) => Promise<void>;
  setLastTx: (signature: string | null) => void;
  acknowledge: () => Promise<void>;
};

export const useLevelRevealStore = create<State>((set, get) => ({
  lastSeen: null,
  loaded: false,
  pending: null,
  lastTxSignature: null,

  async load() {
    if (get().loaded) return;
    try {
      const raw = await SecureStore.getItemAsync(KEY);
      const n = raw ? Number(raw) : NaN;
      set({ lastSeen: n >= 1 && n <= 5 ? (n as ShoeLevel) : null, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  async observe(level) {
    await get().load();
    const { lastSeen, pending } = get();
    if (lastSeen === null) {
      // 第一次看到（新裝置／剛建立 profile）：不播，只記錄
      set({ lastSeen: level });
      await SecureStore.setItemAsync(KEY, String(level)).catch(() => {});
      return;
    }
    if (level > lastSeen && !pending) set({ pending: { from: lastSeen, to: level } });
  },

  setLastTx: (signature) => set({ lastTxSignature: signature }),

  async acknowledge() {
    const p = get().pending;
    if (!p) return;
    set({ pending: null, lastSeen: p.to });
    await SecureStore.setItemAsync(KEY, String(p.to)).catch(() => {});
  },
}));
