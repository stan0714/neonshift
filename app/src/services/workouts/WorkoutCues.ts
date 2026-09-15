/**
 * 運動中提示（PG-U-02；sport-experience-gameplay 3）：每公里／自訂距離圈可選語音或震動；預設關閉。
 * 通話或 App 不在前景時不搶播（AppState !== active 略過），恢復後不補播過期提示；只在新完成的分段／圈時觸發一次。
 */
import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { AppState } from 'react-native';

import type { Lap } from '@/domain/gps/engine';
import { formatPace } from '@/domain/workouts';
import type { RecorderSnapshot } from '@/services/workouts/WorkoutRecorder';

export type CuePrefs = { voice: boolean; haptic: boolean; locale: 'zh-TW' | 'en' };
type Deps = { speak: (text: string, opts: { language: string }) => void; haptic: () => Promise<void>; appActive: () => boolean };
const defaultDeps: Deps = {
  speak: (text, opts) => Speech.speak(text, { language: opts.language }),
  haptic: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  appActive: () => AppState.currentState === 'active',
};

export function cueText(lap: Lap, sport: 'run' | 'walk', locale: CuePrefs['locale']): string {
  const km = lap.kind === 'split' ? lap.index : Math.round(lap.distanceMm / 1000) / 1000;
  const label = lap.kind === 'split' ? (locale === 'zh-TW' ? `${km} 公里` : `${km} kilometer${km === 1 ? '' : 's'}`) : locale === 'zh-TW' ? `第 ${lap.index} 圈` : `Lap ${lap.index}`;
  if (lap.paceSPerKm === null) return label;
  if (sport === 'walk') {
    const kmh = (3600 / lap.paceSPerKm).toFixed(1);
    return locale === 'zh-TW' ? `${label}，時速 ${kmh} 公里` : `${label}, ${kmh} kilometers per hour`;
  }
  const m = Math.floor(lap.paceSPerKm / 60);
  const s = lap.paceSPerKm % 60;
  return locale === 'zh-TW' ? `${label}，配速 ${m} 分 ${s} 秒` : `${label}, pace ${m} minutes ${s} seconds`;
}

export class WorkoutCues {
  private seenSplits = 0;
  private seenLaps = 0;
  constructor(private readonly deps: Deps = defaultDeps) {}

  reset(snapshot?: RecorderSnapshot) {
    this.seenSplits = snapshot?.splits.length ?? 0;
    this.seenLaps = snapshot?.laps.length ?? 0;
  }

  /** 每次 snapshot 更新呼叫；回傳本次觸發的提示文字（測試用） */
  onSnapshot(s: RecorderSnapshot, prefs: CuePrefs): string[] {
    const fresh: Lap[] = [...s.splits.slice(this.seenSplits), ...s.laps.slice(this.seenLaps).filter((l) => l.kind !== 'manual')];
    this.seenSplits = s.splits.length;
    this.seenLaps = s.laps.length;
    if (!fresh.length || (!prefs.voice && !prefs.haptic)) return [];
    if (!this.deps.appActive()) return []; // 通話／背景：不搶播、不補播
    const texts = fresh.map((l) => cueText(l, s.sport, prefs.locale));
    if (prefs.haptic) void this.deps.haptic().catch(() => {});
    if (prefs.voice) for (const t of texts) this.deps.speak(t, { language: prefs.locale === 'zh-TW' ? 'zh-TW' : 'en-US' });
    return texts;
  }
}

export const workoutCues = new WorkoutCues();
