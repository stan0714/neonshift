/** PG-U-02：距離間隔提示（500 m／1 km／目標一半）——只對新跨過的界線觸發一次、不補播、手動圈不播、預設關閉、背景仍播；語音文字（中英、跑步配速／走路時速）。 */
import type { Lap } from '@/domain/gps/engine';
import { cueIntervalMm, cueText, distanceCueText, WorkoutCues } from '@/services/workouts/WorkoutCues';
import type { RecorderSnapshot } from '@/services/workouts/WorkoutRecorder';

const lap = (o: Partial<Lap>): Lap => ({ kind: 'split', index: 1, startElapsedMs: 0, endElapsedMs: 330_000, distanceMm: 1_000_000, durationMs: 330_000, paceSPerKm: 330, isPartial: false, uncertain: false, ...o });
const snap = (o: Partial<RecorderSnapshot>): RecorderSnapshot => ({ state: 'recording', sessionId: 's', sport: 'run', elapsedMs: 0, movingMs: 0, pausedMs: 0, distanceMm: 0, currentSpeedMs: null, currentPaceSPerKm: null, gps: 'ok', accepted: 0, splits: [], laps: [], trackEquivalent: null, interrupted: false, intent: 'run', goal: null, goalReached: false, integrityFlags: [], path: [], speedSamples: [], lastAccuracyM: null, fixes: 0, gpsRestarts: 0, gpsFallback: false, gpsIssue: null, pauseKind: null, autoPausedMs: 0, storage: { pendingPoints: 0, failing: false, lastError: null }, paceStale: false, finishError: null, ...o });

test('cueText（圈）與 distanceCueText：跑步配速、走路時速、目標一半／達標；中英', () => {
  expect(cueText(lap({ kind: 'auto_distance', index: 3, distanceMm: 400_000, paceSPerKm: 300 }), 'run', 'zh-TW')).toBe('第 3 圈，配速 5 分 0 秒');
  expect(cueText(lap({ kind: 'auto_distance', index: 2, distanceMm: 400_000, paceSPerKm: null }), 'run', 'en')).toBe('Lap 2');
  expect(distanceCueText({ distanceMm: 1_000_000, segmentPaceSPerKm: 330, elapsedMs: 330_000, half: null }, 'run', 'zh-TW')).toBe('1 公里，配速 5 分 30 秒，用時 5 分 30 秒');
  expect(distanceCueText({ distanceMm: 500_000, segmentPaceSPerKm: 720, elapsedMs: 360_000, half: null }, 'walk', 'en')).toBe('500 meters, 5.0 kilometers per hour, 6 minutes 0 seconds');
  expect(distanceCueText({ distanceMm: 2_500_000, segmentPaceSPerKm: 300, elapsedMs: 750_000, half: 'half' }, 'run', 'zh-TW')).toBe('目標一半，2.5 公里，配速 5 分 0 秒，用時 12 分 30 秒');
  expect(distanceCueText({ distanceMm: 5_000_000, segmentPaceSPerKm: 300, elapsedMs: 1_500_000, half: 'goal' }, 'run', 'en')).toBe('Goal reached, 5 kilometers, pace 5 minutes 0 seconds, 25 minutes 0 seconds');
});

test('cueIntervalMm：500／1000／目標一半（無距離目標視同 1 km）', () => {
  expect(cueIntervalMm('500', null)).toBe(500_000);
  expect(cueIntervalMm('1000', null)).toBe(1_000_000);
  expect(cueIntervalMm('half', null)).toBe(1_000_000);
  expect(cueIntervalMm('half', { kind: 'time', target: 600, unit: 's', version: 1 })).toBe(1_000_000);
  expect(cueIntervalMm('half', { kind: 'distance', target: 5_000_000, unit: 'mm', version: 1 })).toBe(2_500_000);
  expect(cueIntervalMm(undefined, null)).toBe(1_000_000);
});

test('每 1 km：只對新跨過的界線觸發一次；配速取上一界線到現在；手動圈不播；預設關閉不觸發；背景仍播；跨多條只播最新', () => {
  const speak = jest.fn();
  const haptic = jest.fn(async () => {});
  let canPlay = true;
  const cues = new WorkoutCues({ speak, haptic, canPlay: () => canPlay });
  const on = { voice: true, haptic: true, locale: 'en' as const, cueEvery: '1000' as const };
  cues.reset(snap({}), on);
  expect(cues.onSnapshot(snap({ distanceMm: 990_000, movingMs: 320_000 }), on)).toEqual([]);
  expect(cues.onSnapshot(snap({ distanceMm: 1_005_000, movingMs: 330_000 }), on)).toEqual(['1 kilometer, pace 5 minutes 30 seconds, 5 minutes 30 seconds']);
  expect(speak).toHaveBeenCalledWith('1 kilometer, pace 5 minutes 30 seconds, 5 minutes 30 seconds', { language: 'en-US' });
  expect(haptic).toHaveBeenCalledTimes(1);
  expect(cues.onSnapshot(snap({ distanceMm: 1_200_000, movingMs: 400_000 }), on)).toEqual([]); // 同一界線不重播
  expect(cues.onSnapshot(snap({ distanceMm: 1_200_000, movingMs: 400_000, laps: [lap({ kind: 'manual', index: 1 })] }), on)).toEqual([]); // 手動圈不播
  canPlay = false;
  expect(cues.onSnapshot(snap({ distanceMm: 2_001_000, movingMs: 630_000 }), on)).toEqual([]);
  canPlay = true;
  // 跨了 3 與 4 km 兩條 → 只播 4 km，配速取 2→4 km 這段（2 km／10 分 = 5:00）
  expect(cues.onSnapshot(snap({ distanceMm: 4_010_000, movingMs: 1_230_000 }), on)).toEqual(['4 kilometers, pace 5 minutes 0 seconds, 20 minutes 30 seconds']);
  expect(cues.onSnapshot(snap({ distanceMm: 5_000_000, movingMs: 1_500_000 }), { ...on, voice: false, haptic: false })).toEqual([]); // 關閉
  expect(speak).toHaveBeenCalledTimes(2);
});

test('每 500 m 與目標一半：500 m 界線；5 km 目標 → 2.5 km「目標一半」、5 km「目標達成」；自訂圈照播', () => {
  const speak = jest.fn();
  const cues = new WorkoutCues({ speak, haptic: async () => {}, canPlay: () => true });
  const zh = { voice: true, haptic: false, locale: 'zh-TW' as const, cueEvery: '500' as const };
  cues.reset(snap({}), zh);
  expect(cues.onSnapshot(snap({ distanceMm: 500_000, movingMs: 165_000 }), zh)).toEqual(['500 公尺，配速 5 分 30 秒，用時 2 分 45 秒']);
  expect(cues.onSnapshot(snap({ distanceMm: 1_000_000, movingMs: 330_000, laps: [lap({ kind: 'auto_distance', index: 1, distanceMm: 400_000, paceSPerKm: 300 })] }), zh)).toEqual(['1 公里，配速 5 分 30 秒，用時 5 分 30 秒', '第 1 圈，配速 5 分 0 秒']);
  const goal = { kind: 'distance' as const, target: 5_000_000, unit: 'mm' as const, version: 1 };
  const half = { ...zh, cueEvery: 'half' as const };
  const c2 = new WorkoutCues({ speak, haptic: async () => {}, canPlay: () => true });
  c2.reset(snap({ goal }), half);
  expect(c2.onSnapshot(snap({ goal, distanceMm: 2_400_000, movingMs: 700_000 }), half)).toEqual([]);
  expect(c2.onSnapshot(snap({ goal, distanceMm: 2_500_000, movingMs: 750_000 }), half)).toEqual(['目標一半，2.5 公里，配速 5 分 0 秒，用時 12 分 30 秒']);
  expect(c2.onSnapshot(snap({ goal, distanceMm: 5_000_000, movingMs: 1_500_000 }), half)).toEqual(['目標達成，5 公里，配速 5 分 0 秒，用時 25 分 0 秒']);
});

test('reset 帶入既有距離：回到記錄頁不會重播已過的界線', () => {
  const speak = jest.fn();
  const cues = new WorkoutCues({ speak, haptic: async () => {}, canPlay: () => true });
  const on = { voice: true, haptic: false, locale: 'en' as const, cueEvery: '1000' as const };
  cues.reset(snap({ distanceMm: 2_300_000, movingMs: 700_000 }), on);
  expect(cues.onSnapshot(snap({ distanceMm: 2_400_000, movingMs: 730_000 }), on)).toEqual([]);
  expect(cues.onSnapshot(snap({ distanceMm: 3_000_000, movingMs: 900_000 }), on)).toEqual(['3 kilometers, pace 3 minutes 20 seconds, 15 minutes 0 seconds']);
});
