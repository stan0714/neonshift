import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import type { WorkoutGoal, WorkoutIntent } from '@/services/api/ApiClient';

/** PG-U-01：最近使用模式與目標（本機；供「快速開始」與開始頁預設） */
export type WorkoutMode = 'walk' | 'brisk' | 'run';
export const modeToSport = (m: WorkoutMode): { sport: 'run' | 'walk'; intent: WorkoutIntent } => (m === 'run' ? { sport: 'run', intent: 'run' } : { sport: 'walk', intent: m === 'brisk' ? 'brisk' : 'casual' });
export const modeOfIntent = (sport: 'run' | 'walk', intent: WorkoutIntent | null | undefined): WorkoutMode | null => (sport === 'run' ? 'run' : intent === 'brisk' ? 'brisk' : intent === 'casual' ? 'walk' : null);
/** showRoute：摘要頁顯示本機軌跡折線（預設開啟；只在畫面上畫，不上傳） */
/** traceLayer：軌跡底圖（趣味圖層，不含地理資訊；真實地圖待供應商）。`shoe`＝跟隨目前跑鞋的棲地（PG-LINK-07，預設）；棲地需曾取得該鞋階 */
export type TraceLayerPref = 'shoe' | 'grid' | 'mars' | 'chain' | 'space' | 'forest' | 'ocean' | 'jungle' | 'snow';
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
  /** PG-LINK-04：日誌排序（預設由舊到新，與同步順序一致）與檢視（清單／月曆）——瀏覽偏好，不影響同步 */
  activityOrder: 'asc' | 'desc';
  /** 偏好結構版本（遷移用；不顯示於介面） */
  prefsSchema?: number;
  activityView: 'list' | 'calendar';
  /** PG-LINK-06：儀表板期間（週／月／年／全部） */
  activityPeriod: 'week' | 'month' | 'year' | 'all';
};
/**
 * 目標快照版本。v1：時間目標以總時間（含暫停）判定。
 * v2（2026-09-19 review 2）：時間目標以**運動時間**（不含暫停）判定，與畫面主時間一致，暫停中不會默默達標。
 */
export const GOAL_VERSION = 2;
export const FREE_GOAL: WorkoutGoal = { kind: 'free', target: 0, unit: 's', version: GOAL_VERSION };
const KEY = 'neonshift.workout.prefs.v1';
/**
 * 偏好結構版本。2：Activity 預設改為由新到舊（運動紀錄的慣例是最近的在最上面）。
 * 舊裝置存的 'asc' 是當初的預設值、不是使用者選的，一次性翻成 'desc'；之後使用者自己切換的選擇照常保留。
 */
const PREFS_SCHEMA = 2;
const initial: WorkoutPrefs = { mode: 'run', goal: FREE_GOAL, voice: false, haptic: false, showRoute: true, traceLayer: 'shoe', autoPause: false, cueEvery: '1000', keepAwake: true, detailView: false, activityOrder: 'desc', activityView: 'list', activityPeriod: 'month', prefsSchema: PREFS_SCHEMA };

type State = WorkoutPrefs & { loaded: boolean; load: () => Promise<WorkoutPrefs>; set: (patch: Partial<WorkoutPrefs>) => Promise<void> };
const pick = (s: State): WorkoutPrefs => ({ mode: s.mode, goal: s.goal, voice: s.voice, haptic: s.haptic, showRoute: s.showRoute, traceLayer: s.traceLayer, autoPause: s.autoPause, cueEvery: s.cueEvery, keepAwake: s.keepAwake, detailView: s.detailView, activityOrder: s.activityOrder, activityView: s.activityView, activityPeriod: s.activityPeriod, prefsSchema: PREFS_SCHEMA });

export const useWorkoutPrefs = create<State>((set, get) => ({
  ...initial,
  loaded: false,
  async load() {
    try {
      const raw = await SecureStore.getItemAsync(KEY);
      const stored = raw ? (JSON.parse(raw) as Partial<WorkoutPrefs>) : null;
      let prefs = stored ? { ...initial, ...stored } : initial;
      if (stored && (stored.prefsSchema ?? 1) < PREFS_SCHEMA) {
        prefs = { ...prefs, activityOrder: initial.activityOrder, prefsSchema: PREFS_SCHEMA };
        try { await SecureStore.setItemAsync(KEY, JSON.stringify(prefs)); } catch { /* 遷移寫回失敗下次再試 */ }
      }
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
