import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import type { WorkoutGoal, WorkoutIntent } from '@/services/api/ApiClient';

/** PG-U-01：最近使用模式與目標（本機；供「快速開始」與開始頁預設） */
export type WorkoutMode = 'walk' | 'brisk' | 'run';
export const modeToSport = (m: WorkoutMode): { sport: 'run' | 'walk'; intent: WorkoutIntent } => (m === 'run' ? { sport: 'run', intent: 'run' } : { sport: 'walk', intent: m === 'brisk' ? 'brisk' : 'casual' });
export const modeOfIntent = (sport: 'run' | 'walk', intent: WorkoutIntent | null | undefined): WorkoutMode | null => (sport === 'run' ? 'run' : intent === 'brisk' ? 'brisk' : intent === 'casual' ? 'walk' : null);
export type WorkoutPrefs = { mode: WorkoutMode; goal: WorkoutGoal; voice: boolean; haptic: boolean };
export const GOAL_VERSION = 1;
export const FREE_GOAL: WorkoutGoal = { kind: 'free', target: 0, unit: 's', version: GOAL_VERSION };
const KEY = 'neonshift.workout.prefs.v1';
const initial: WorkoutPrefs = { mode: 'run', goal: FREE_GOAL, voice: false, haptic: false };

type State = WorkoutPrefs & { loaded: boolean; load: () => Promise<WorkoutPrefs>; set: (patch: Partial<WorkoutPrefs>) => Promise<void> };
const pick = (s: State): WorkoutPrefs => ({ mode: s.mode, goal: s.goal, voice: s.voice, haptic: s.haptic });

export const useWorkoutPrefs = create<State>((set, get) => ({
  ...initial,
  loaded: false,
  async load() {
    try {
      const raw = await SecureStore.getItemAsync(KEY);
      const prefs = raw ? { ...initial, ...(JSON.parse(raw) as Partial<WorkoutPrefs>) } : initial;
      set({ ...prefs, loaded: true });
      return prefs;
    } catch {
      set({ ...initial, loaded: true });
      return initial;
    }
  },
  async set(patch) {
    const next = { ...pick(get()), ...patch };
    set(next);
    try {
      await SecureStore.setItemAsync(KEY, JSON.stringify(next));
    } catch {
      /* 偏好無法持久化不影響記錄 */
    }
  },
}));
