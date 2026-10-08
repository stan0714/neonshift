import type { Feather } from '@expo/vector-icons';

import type { WorkoutMode } from '@/state/workoutPrefsStore';
import { color } from '@/theme/tokens';

/**
 * 三模式的運動樣態（Style 24.6；sport-experience-gameplay 1）：走路／健走／跑步不只文案不同，
 * 主指標、目標預設、自動圈、提示節奏、配色與圖示都不同。健走仍是使用者選擇的模式（不依速度自動判定），
 * 只多一個「建議區間」作為即時回饋，不影響任何獎勵或判定。
 */
export type ModeProfile = {
  mode: WorkoutMode;
  /** 主題色（tab 底線、GPS／狀態 chip、目標進度、軌跡） */
  accent: string;
  accentTone: 'violet' | 'cyan' | 'mint';
  icon: React.ComponentProps<typeof Feather>['name'];
  /** 記錄頁主數字 */
  primary: 'time' | 'speed' | 'pace';
  /** 目標預設（分鐘／公里） */
  timePresets: readonly number[];
  distPresets: readonly number[];
  /** 自動圈預設 */
  autoLapDefault: 'off' | '400' | '1000';
  /** 建議速度區間（km/h；只作即時回饋） */
  speedZoneKmh: readonly [number, number] | null;
  /** 記錄頁次要格順序 */
  tiles: readonly ('time' | 'distance' | 'avg' | 'last' | 'speed' | 'pace')[];
};

export const MODE_PROFILES: Record<WorkoutMode, ModeProfile> = {
  walk: { mode: 'walk', accent: color.violet, accentTone: 'violet', icon: 'sun', primary: 'time', timePresets: [15, 30, 45], distPresets: [1, 2, 3], autoLapDefault: 'off', speedZoneKmh: null, tiles: ['distance', 'speed', 'avg', 'last'] },
  brisk: { mode: 'brisk', accent: color.cyan, accentTone: 'cyan', icon: 'trending-up', primary: 'speed', timePresets: [10, 20, 30], distPresets: [2, 3, 5], autoLapDefault: '1000', speedZoneKmh: [5.5, 7.5], tiles: ['time', 'distance', 'avg', 'last'] },
  run: { mode: 'run', accent: color.mint, accentTone: 'mint', icon: 'zap', primary: 'pace', timePresets: [10, 20, 30], distPresets: [1, 3, 5, 10], autoLapDefault: 'off', speedZoneKmh: null, tiles: ['time', 'distance', 'avg', 'last'] },
};

export const profileOf = (mode: WorkoutMode): ModeProfile => MODE_PROFILES[mode];

/** 換模式時把目標預設值對齊新模式的選項：不在清單內就取最接近的一個 */
export const snapPreset = (value: number, presets: readonly number[]): number => presets.reduce((best, p) => (Math.abs(p - value) < Math.abs(best - value) ? p : best), presets[0]!);

export type SpeedZone = 'below' | 'in' | 'above';
/** 健走建議區間判定；速度未知 → null */
export function speedZone(profile: ModeProfile, speedKmh: number | null): SpeedZone | null {
  if (!profile.speedZoneKmh || speedKmh === null || !Number.isFinite(speedKmh)) return null;
  const [lo, hi] = profile.speedZoneKmh;
  return speedKmh < lo ? 'below' : speedKmh > hi ? 'above' : 'in';
}

/** 跑步：目前配速 vs 平均配速（％；負＝比平均快）；資料不足 → null */
export function paceVsAvg(currentSPerKm: number | null, avgSPerKm: number | null): number | null {
  if (currentSPerKm === null || avgSPerKm === null || avgSPerKm <= 0 || currentSPerKm <= 0) return null;
  return Math.round(((currentSPerKm - avgSPerKm) / avgSPerKm) * 100);
}
