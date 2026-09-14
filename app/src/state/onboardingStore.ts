import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

/** Onboarding 進度（Style 2.1：Wallet → Health → Activity → Shoe Mint）。持久化於本機。 */
export type OnboardingFlags = {
  healthGranted: boolean;
  activityGranted: boolean;
  /** 使用者已選擇稍後處理（10.2：不可反覆彈出） */
  healthDeferred: boolean;
  activityDeferred: boolean;
  shoeMinted: boolean;
};

const KEY = 'neonshift.onboarding.v1';
const initial: OnboardingFlags = { healthGranted: false, activityGranted: false, healthDeferred: false, activityDeferred: false, shoeMinted: false };

type State = OnboardingFlags & {
  loaded: boolean;
  load: () => Promise<OnboardingFlags>;
  set: (patch: Partial<OnboardingFlags>) => Promise<void>;
  reset: () => Promise<void>;
};

export const useOnboardingStore = create<State>((set, get) => ({
  ...initial,
  loaded: false,
  async load() {
    try {
      const raw = await SecureStore.getItemAsync(KEY);
      const flags = raw ? { ...initial, ...(JSON.parse(raw) as Partial<OnboardingFlags>) } : initial;
      set({ ...flags, loaded: true });
      return flags;
    } catch {
      set({ ...initial, loaded: true });
      return initial;
    }
  },
  async set(patch) {
    const next = { ...pick(get()), ...patch };
    set(next);
    await SecureStore.setItemAsync(KEY, JSON.stringify(next));
  },
  async reset() {
    set({ ...initial });
    await SecureStore.deleteItemAsync(KEY);
  },
}));

function pick(s: State): OnboardingFlags {
  const { healthGranted, activityGranted, healthDeferred, activityDeferred, shoeMinted } = s;
  return { healthGranted, activityGranted, healthDeferred, activityDeferred, shoeMinted };
}

/** 9.3：已完成 onboarding（鑄鞋）且 session 可恢復時跳過 Landing */
export const isOnboardingComplete = (f: OnboardingFlags) => f.shoeMinted;
