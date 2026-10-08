/**
 * 運動中提示（PG-U-02；sport-experience-gameplay 3）：依距離間隔（每 500 m／每 1 km／目標一半）與自訂圈可選語音或震動；預設關閉。
 * 2026-09-16 實機回饋：手機在口袋、螢幕關閉時也要播（前景服務持續記錄，TTS 在背景可播）；來電時由系統音訊焦點處理。
 * 只在新跨過的距離界線／新完成的圈觸發一次；不補播過期提示（以計數比較，不重播已過的界線）。
 * 2026-09-19 review 7／8：播報以 session 為單位由 `cueController` 驅動（訂閱 recorder，不依賴記錄頁）；
 * `reset()` 的時間基準改取引擎最後一個完整分段的結束時間，不再用「目前運動時間」，返回畫面也不會算出異常配速。
 */
import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';

import type { Lap } from '@/domain/gps/engine';
import type { RecorderSnapshot } from '@/services/workouts/WorkoutRecorder';
import type { CueEvery } from '@/state/workoutPrefsStore';

export type CuePrefs = { voice: boolean; haptic: boolean; locale: 'zh-TW' | 'en'; cueEvery?: CueEvery };
type Deps = { speak: (text: string, opts: { language: string }) => void; haptic: () => Promise<void>; /** 可播報（測試用；預設永遠可播，含背景） */ canPlay: () => boolean };
const defaultDeps: Deps = {
  speak: (text, opts) => Speech.speak(text, { language: opts.language }),
  haptic: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  canPlay: () => true,
};

const paceText = (paceSPerKm: number | null, sport: 'run' | 'walk', locale: CuePrefs['locale']): string => {
  if (paceSPerKm === null) return '';
  if (sport === 'walk') {
    const kmh = (3600 / paceSPerKm).toFixed(1);
    return locale === 'zh-TW' ? `，時速 ${kmh} 公里` : `, ${kmh} kilometers per hour`;
  }
  const m = Math.floor(paceSPerKm / 60);
  const s = paceSPerKm % 60;
  return locale === 'zh-TW' ? `，配速 ${m} 分 ${s} 秒` : `, pace ${m} minutes ${s} seconds`;
};

const durationText = (ms: number, locale: CuePrefs['locale']): string => {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (locale === 'zh-TW') return h ? `${h} 小時 ${m} 分` : `${m} 分 ${s} 秒`;
  return h ? `${h} hours ${m} minutes` : `${m} minutes ${s} seconds`;
};

const distanceText = (mm: number, locale: CuePrefs['locale']): string => {
  const km = Math.round(mm / 10_000) / 100; // 0.01 km
  if (km < 1) {
    const m = Math.round(mm / 1000);
    return locale === 'zh-TW' ? `${m} 公尺` : `${m} meters`;
  }
  const label = Number.isInteger(km) ? String(km) : km.toFixed(km * 10 === Math.round(km * 10) ? 1 : 2);
  return locale === 'zh-TW' ? `${label} 公里` : `${label} kilometer${km === 1 ? '' : 's'}`;
};

/** 圈（自訂距離圈）提示文字 */
export function cueText(lap: Lap, sport: 'run' | 'walk', locale: CuePrefs['locale']): string {
  const km = lap.kind === 'split' ? lap.index : Math.round(lap.distanceMm / 1000) / 1000;
  const label = lap.kind === 'split' ? (locale === 'zh-TW' ? `${km} 公里` : `${km} kilometer${km === 1 ? '' : 's'}`) : locale === 'zh-TW' ? `第 ${lap.index} 圈` : `Lap ${lap.index}`;
  return `${label}${paceText(lap.paceSPerKm, sport, locale)}`;
}

/** 距離界線提示文字：距離＋（目標一半／達標）＋這一段配速或時速＋總時間 */
export function distanceCueText(o: { distanceMm: number; segmentPaceSPerKm: number | null; elapsedMs: number; half: 'half' | 'goal' | null }, sport: 'run' | 'walk', locale: CuePrefs['locale']): string {
  const dist = distanceText(o.distanceMm, locale);
  const marker = o.half === 'half' ? (locale === 'zh-TW' ? '目標一半，' : 'Halfway, ') : o.half === 'goal' ? (locale === 'zh-TW' ? '目標達成，' : 'Goal reached, ') : '';
  const time = locale === 'zh-TW' ? `，用時 ${durationText(o.elapsedMs, locale)}` : `, ${durationText(o.elapsedMs, locale)}`;
  return `${marker}${dist}${paceText(o.segmentPaceSPerKm, sport, locale)}${time}`;
}

/** 依偏好與目標決定距離界線（mm）；目標一半但無距離目標 → 1 km */
export function cueIntervalMm(cueEvery: CueEvery | undefined, goal: RecorderSnapshot['goal']): number {
  if (cueEvery === '500') return 500_000;
  if (cueEvery === 'half' && goal && goal.kind === 'distance' && goal.target > 0) return Math.max(100_000, Math.round(goal.target / 2));
  return 1_000_000;
}

export class WorkoutCues {
  private seenLaps = 0;
  private seenBoundary = 0;
  private lastBoundaryMs = 0;
  private lastBoundaryMm = 0;
  constructor(private readonly deps: Deps = defaultDeps) {}

  reset(snapshot?: RecorderSnapshot, prefs?: CuePrefs) {
    this.seenLaps = snapshot?.laps.length ?? 0;
    const interval = cueIntervalMm(prefs?.cueEvery, snapshot?.goal ?? null);
    this.seenBoundary = Math.floor((snapshot?.distanceMm ?? 0) / interval);
    this.lastBoundaryMm = this.seenBoundary * interval;
    // review 8：時間基準取「上一條界線」的實際時間。界線與引擎分段長度一致時用最後一個完整分段的結束時間；
    // 否則（尚無界線）從 0 起算。之前用「目前運動時間」配「上一個完整公里」，在 1.8 km 返回會播出 0.2 km 的時間除以 1 km。
    const completed = (snapshot?.splits ?? []).filter((l) => !l.isPartial);
    const lastSplit = completed[completed.length - 1];
    const splitMatchesInterval = !!lastSplit && Math.abs(lastSplit.distanceMm - interval) < 1000;
    this.lastBoundaryMs = this.seenBoundary === 0 ? 0 : splitMatchesInterval && completed.length === this.seenBoundary ? lastSplit!.endElapsedMs : (snapshot?.movingMs ?? 0);
  }

  /** 自動暫停／繼續的即時確認（review 4）：震動一次；語音開啟時說一句。不看距離界線 */
  announce(kind: 'auto_pause' | 'auto_resume', prefs: CuePrefs): string | null {
    if (!prefs.voice && !prefs.haptic) return null;
    if (!this.deps.canPlay()) return null;
    const text = kind === 'auto_pause' ? (prefs.locale === 'zh-TW' ? '自動暫停' : 'Auto-paused') : prefs.locale === 'zh-TW' ? '自動繼續' : 'Resumed';
    if (prefs.haptic) void this.deps.haptic().catch(() => {});
    if (prefs.voice) this.deps.speak(text, { language: prefs.locale === 'zh-TW' ? 'zh-TW' : 'en-US' });
    return text;
  }

  /** 每次 snapshot 更新呼叫；回傳本次觸發的提示文字（測試用） */
  onSnapshot(s: RecorderSnapshot, prefs: CuePrefs): string[] {
    const texts: string[] = [];
    const interval = cueIntervalMm(prefs.cueEvery, s.goal);
    const count = Math.floor(s.distanceMm / interval);
    if (count > this.seenBoundary) {
      // 只播最新一條界線（跨多條時不補播舊的）；配速取上一條界線到現在
      const boundaryMm = count * interval;
      const segMm = boundaryMm - this.lastBoundaryMm;
      const segMs = Math.max(0, s.movingMs - this.lastBoundaryMs);
      const pace = segMm > 0 && segMs > 0 ? Math.round(segMs / (segMm / 1_000_000) / 1000) : null;
      const isDistanceGoal = !!s.goal && s.goal.kind === 'distance' && s.goal.target > 0;
      const half = prefs.cueEvery === 'half' && isDistanceGoal ? (boundaryMm >= s.goal!.target ? 'goal' : 'half') : null;
      texts.push(distanceCueText({ distanceMm: boundaryMm, segmentPaceSPerKm: pace, elapsedMs: s.movingMs, half }, s.sport, prefs.locale));
      this.seenBoundary = count;
      this.lastBoundaryMs = s.movingMs;
      this.lastBoundaryMm = boundaryMm;
    }
    const freshLaps = s.laps.slice(this.seenLaps).filter((l) => l.kind !== 'manual');
    this.seenLaps = s.laps.length;
    for (const l of freshLaps) texts.push(cueText(l, s.sport, prefs.locale));
    if (!texts.length || (!prefs.voice && !prefs.haptic)) return [];
    if (!this.deps.canPlay()) return [];
    if (prefs.haptic) void this.deps.haptic().catch(() => {});
    if (prefs.voice) for (const t of texts) this.deps.speak(t, { language: prefs.locale === 'zh-TW' ? 'zh-TW' : 'en-US' });
    return texts;
  }
}

export const workoutCues = new WorkoutCues();
