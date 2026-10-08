/**
 * 升級 reveal（PG-A-17，Style 12／15）：跑鞋等級由 XP 在鏈上自動提升，App 只在觀察到等級與上次不同時
 * 播放一次 reveal（motion.celebration、success haptic），並記住已看到的等級，重啟或重新同步不重播。
 */
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import { FEATURES } from '@/config/features';
import type { ShoeLevel } from '@/config/shoeProgression';

const KEY = 'neonshift.shoe.lastSeenLevel.v1';

/** 展示版覆寫（FEATURES.demoLevel）顯示的等級不是鏈上真值：reveal 照播，但不寫入已看等級，換回正式版不會出現假降階 */
async function persist(level: ShoeLevel) {
  if (FEATURES.demoLevel > 0) return;
  await SecureStore.setItemAsync(KEY, String(level)).catch(() => {});
}

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
      await persist(level);
      return;
    }
    if (level !== lastSeen && !pending) set({ pending: { from: lastSeen, to: level } });
  },

  setLastTx: (signature) => set({ lastTxSignature: signature }),

  async acknowledge() {
    const p = get().pending;
    if (!p) return;
    set({ pending: null, lastSeen: p.to });
    await persist(p.to);
  },
}));
