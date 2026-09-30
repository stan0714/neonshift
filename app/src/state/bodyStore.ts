import * as SecureStore from 'expo-secure-store';
import { useEffect } from 'react';
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

/**
 * 讀體重（熱量估算用）。**消費端一律用這支**，不要直接 `useBody((b) => b.weightKg)`：
 * weightKg 要等 load() 從 SecureStore 讀回來才有值，而 load() 原本只有 Profile 的
 * BodyWeightCard 會呼叫——冷啟動後直接看運動紀錄，體重明明設過卻顯示「—」＋
 * 「請到 Profile 設定體重」（2026-09-30 實機回報）。把載入綁在讀取上，下一個
 * 消費端就不可能再忘記。
 *
 * `loaded` 讓畫面能分辨「還沒讀完」與「真的沒設」——否則每次進畫面都會先閃一下提示。
 */
export function useWeightKg(): { weightKg: number | null; loaded: boolean } {
  const weightKg = useBody((b) => b.weightKg);
  const loaded = useBody((b) => b.loaded);
  useEffect(() => { void useBody.getState().load(); }, []);
  return { weightKg, loaded };
}
