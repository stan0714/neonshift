import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import type { WorkoutGoal, WorkoutIntent } from '@/services/api/ApiClient';

/** PG-U-01：最近使用模式與目標（本機；供「快速開始」與開始頁預設） */
export type WorkoutMode = 'walk' | 'brisk' | 'run';
export const modeToSport = (m: WorkoutMode): { sport: 'run' | 'walk'; intent: WorkoutIntent } => (m === 'run' ? { sport: 'run', intent: 'run' } : { sport: 'walk', intent: m === 'brisk' ? 'brisk' : 'casual' });
export const modeOfIntent = (sport: 'run' | 'walk', intent: WorkoutIntent | null | undefined): WorkoutMode | null => (sport === 'run' ? 'run' : intent === 'brisk' ? 'brisk' : intent === 'casual' ? 'walk' : null);
/** showRoute：摘要頁顯示本機軌跡折線（預設開啟；只在畫面上畫，不上傳） */
export type TraceLayerPref = 'grid' | 'mars' | 'chain' | 'space';
/** traceLayer：軌跡底圖（趣味圖層，不含地理資訊；真實地圖待供應商） */
/** autoPause：靜止自動暫停（預設關；Style 23.7） */
/** cueEvery：語音／震動提示的距離間隔——每 500 m、每 1 km、或目標距離的一半（無距離目標時視同 1 km） */
export type CueEvery = '500' | '1000' | 'half';
export type WorkoutPrefs = {
  mode: WorkoutMode;
  goal: WorkoutGoal;
  voice: boolean;
  haptic: boolean;
  showRoute: boolean;
  traceLayer: TraceLayerPref;
  autoPause: boolean;
  cueEvery: CueEvery;
  /** 記錄中螢幕常亮（review 10）；暫停中一律允許休眠以省電 */
  keepAwake: boolean;
  /** 記錄頁詳細模式（review 9）：預設精簡（配速／距離／運動時間／暫停／計圈）；開啟才顯示分段表、軌跡、速度曲線與配速比較 */
  detailView: boolean;
};
/**
 * 目標快照版本。v1：時間目標以總時間（含暫停）判定。
 * v2（2026-09-19 review 2）：時間目標以**運動時間**（不含暫停）判定，與畫面主時間一致，暫停中不會默默達標。
 */
export const GOAL_VERSION = 2;
export const FREE_GOAL: WorkoutGoal = { kind: 'free', target: 0, unit: 's', version: GOAL_VERSION };
const KEY = 'neonshift.workout.prefs.v1';
const initial: WorkoutPrefs = { mode: 'run', goal: FREE_GOAL, voice: false, haptic: false, showRoute: true, traceLayer: 'grid', autoPause: false, cueEvery: '1000', keepAwake: true, detailView: false };

type State = WorkoutPrefs & { loaded: boolean; load: () => Promise<WorkoutPrefs>; set: (patch: Partial<WorkoutPrefs>) => Promise<void> };
const pick = (s: State): WorkoutPrefs => ({ mode: s.mode, goal: s.goal, voice: s.voice, haptic: s.haptic, showRoute: s.showRoute, traceLayer: s.traceLayer, autoPause: s.autoPause, cueEvery: s.cueEvery, keepAwake: s.keepAwake, detailView: s.detailView });

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
