import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

/**
 * PG-R-11：熱量估算用的體重。只存在這支手機（SecureStore），不上傳、不進 profile／NFT／同步資料；清除即停止估算。
 */
const KEY = 'neonshift.body.v1';
export const WEIGHT_RANGE = { min: 20, max: 300 } as const;
type State = { loaded: boolean; weightKg: number | null; updatedAt: number | null; load: () => Promise<void>; setWeight: (kg: number | null, now?: number) => Promise<void> };

export const useBody = create<State>((set, get) => ({
  loaded: false,
  weightKg: null,
  updatedAt: null,
  async load() {
    if (get().loaded) return;
    try {
      const raw = await SecureStore.getItemAsync(KEY);
      if (get().loaded) return; // 讀取期間使用者已設定：不用舊值蓋掉
      const p = raw ? (JSON.parse(raw) as { weightKg?: number; updatedAt?: number }) : null;
      set({ loaded: true, weightKg: p?.weightKg && p.weightKg >= WEIGHT_RANGE.min && p.weightKg <= WEIGHT_RANGE.max ? p.weightKg : null, updatedAt: p?.updatedAt ?? null });
    } catch {
      set({ loaded: true });
    }
  },
  async setWeight(kg, now = Date.now()) {
    const weightKg = kg !== null && Number.isFinite(kg) && kg >= WEIGHT_RANGE.min && kg <= WEIGHT_RANGE.max ? Number(kg.toFixed(1)) : null;
    set({ weightKg, updatedAt: weightKg === null ? null : now, loaded: true });
    try {
      if (weightKg === null) await SecureStore.deleteItemAsync(KEY);
      else await SecureStore.setItemAsync(KEY, JSON.stringify({ weightKg, updatedAt: now }));
    } catch { /* 下次設定再存 */ }
  },
}));
