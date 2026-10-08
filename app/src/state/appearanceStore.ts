/**
 * 外觀偏好（PG-LINK-01）：`selectedShoeId`（null＝跟隨有效等級）與 `shoeBackgroundEnabled`（預設開）。
 * 以玩家（錢包）分區保存在本機 SecureStore；未連錢包＝訪客 → 預設值且不保存；換錢包重新載入，不沿用另一人的偏好。
 * 新鞋取得、升階、換鞋都不會偷偷把背景開回；重新安裝回到預設。
 */
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import type { ShoeLevel } from '@/config/shoeProgression';
import { shoeId } from '@/domain/appearance';
import { DEFAULT_SHOE_SERIES } from '@/config/shoeCollection';
import { useWalletStore } from './walletStore';

export type AppearancePrefs = { selectedShoeId: string | null; shoeBackgroundEnabled: boolean; /** 首次在此裝置看到各階的時間（ISO；只作「取得日期」顯示，不推算歷史） */ acquiredAt: Partial<Record<ShoeLevel, string>> };
const DEFAULTS: AppearancePrefs = { selectedShoeId: null, shoeBackgroundEnabled: true, acquiredAt: {} };
const keyOf = (owner: string) => `neonshift.appearance.v1.${owner}`;

type State = AppearancePrefs & {
  owner: string | null;
  loaded: boolean;
  /** 新鞋取得後的「立即使用／稍後」提示（只在有明確選擇時出現） */
  offer: ShoeLevel | null;
  load: (owner: string | null) => Promise<void>;
  selectShoe: (level: ShoeLevel | null) => Promise<void>;
  setBackground: (enabled: boolean) => Promise<void>;
  /** 觀察到玩家已取得到 `highest` 階：補記取得日期、決定是否提示 */
  observeOwned: (highest: ShoeLevel) => Promise<void>;
  dismissOffer: () => void;
};

const persist = async (owner: string | null, prefs: AppearancePrefs) => {
  if (!owner) return;
  try { await SecureStore.setItemAsync(keyOf(owner), JSON.stringify(prefs)); } catch { /* 本機偏好寫不進去：保留記憶體值 */ }
};
const pick = (s: State): AppearancePrefs => ({ selectedShoeId: s.selectedShoeId, shoeBackgroundEnabled: s.shoeBackgroundEnabled, acquiredAt: s.acquiredAt });

export const useAppearanceStore = create<State>((set, get) => ({
  ...DEFAULTS,
  owner: null,
  loaded: false,
  offer: null,

  async load(owner) {
    if (!owner) { set({ ...DEFAULTS, owner: null, loaded: true, offer: null }); return; }
    let prefs = DEFAULTS;
    try {
      const raw = await SecureStore.getItemAsync(keyOf(owner));
      if (raw) prefs = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<AppearancePrefs>) };
    } catch { /* 讀不到就用預設 */ }
    if (get().owner === owner && get().loaded) return; // 同一玩家已載入：不覆蓋使用中的值
    set({ ...prefs, owner, loaded: true, offer: null });
  },

  async selectShoe(level) {
    const next = { ...pick(get()), selectedShoeId: level === null ? null : shoeId(DEFAULT_SHOE_SERIES, level) };
    set({ ...next, offer: null });
    await persist(get().owner, next);
  },

  async setBackground(enabled) {
    const next = { ...pick(get()), shoeBackgroundEnabled: enabled };
    set(next);
    await persist(get().owner, next);
  },

  async observeOwned(highest) {
    const s = get();
    if (!s.owner || !s.loaded) return;
    const acquiredAt = { ...s.acquiredAt };
    let changed = false;
    for (let l = 1; l <= highest; l++) {
      if (!acquiredAt[l as ShoeLevel]) { acquiredAt[l as ShoeLevel] = new Date().toISOString(); changed = true; }
    }
    if (!changed) return;
    // 有明確選擇且新到手的不是它 → 提示「立即使用／稍後」，不強制覆蓋原選擇
    const offer = s.selectedShoeId !== null && s.selectedShoeId !== shoeId(DEFAULT_SHOE_SERIES, highest) && Object.keys(s.acquiredAt).length > 0 ? highest : null;
    const next = { ...pick(s), acquiredAt };
    set({ ...next, offer });
    await persist(s.owner, next);
  },

  dismissOffer: () => set({ offer: null }),
}));

// 換錢包／登出：重新載入該玩家的偏好（訪客回到預設基本背景）
useWalletStore.subscribe((s, prev) => {
  const owner = s.session?.address ?? null;
  if (owner !== (prev.session?.address ?? null)) void useAppearanceStore.getState().load(owner);
});
