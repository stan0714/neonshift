/** PG-U-02：每公里／自訂圈提示——只對新完成的分段觸發一次、手動圈不播、預設關閉、背景／通話不搶播且不補播、語音文字（中英、跑步配速／走路時速）。 */
import type { Lap } from '@/domain/gps/engine';
import { cueText, WorkoutCues } from '@/services/workouts/WorkoutCues';
import type { RecorderSnapshot } from '@/services/workouts/WorkoutRecorder';

const lap = (o: Partial<Lap>): Lap => ({ kind: 'split', index: 1, startElapsedMs: 0, endElapsedMs: 330_000, distanceMm: 1_000_000, durationMs: 330_000, paceSPerKm: 330, isPartial: false, uncertain: false, ...o });
const snap = (o: Partial<RecorderSnapshot>): RecorderSnapshot => ({ state: 'recording', sessionId: 's', sport: 'run', elapsedMs: 0, movingMs: 0, pausedMs: 0, distanceMm: 0, currentSpeedMs: null, currentPaceSPerKm: null, gps: 'ok', accepted: 0, splits: [], laps: [], trackEquivalent: null, interrupted: false, intent: 'run', goal: null, goalReached: false, integrityFlags: [], ...o });

test('cueText：跑步配速、走路時速、自訂圈；中英', () => {
  expect(cueText(lap({}), 'run', 'zh-TW')).toBe('1 公里，配速 5 分 30 秒');
  expect(cueText(lap({ index: 2 }), 'run', 'en')).toBe('2 kilometers, pace 5 minutes 30 seconds');
  expect(cueText(lap({ paceSPerKm: 720 }), 'walk', 'en')).toBe('1 kilometer, 5.0 kilometers per hour');
  expect(cueText(lap({ kind: 'auto_distance', index: 3, distanceMm: 400_000, paceSPerKm: 300 }), 'run', 'zh-TW')).toBe('第 3 圈，配速 5 分 0 秒');
  expect(cueText(lap({ paceSPerKm: null }), 'run', 'en')).toBe('1 kilometer');
});

test('只對新分段觸發一次；手動圈不播；預設關閉不觸發；背景不播且恢復後不補播', () => {
  const speak = jest.fn();
  const haptic = jest.fn(async () => {});
  let active = true;
  const cues = new WorkoutCues({ speak, haptic, appActive: () => active });
  cues.reset(snap({}));
  const on = { voice: true, haptic: true, locale: 'en' as const };
  expect(cues.onSnapshot(snap({ splits: [lap({})] }), on)).toEqual(['1 kilometer, pace 5 minutes 30 seconds']);
  expect(speak).toHaveBeenCalledWith('1 kilometer, pace 5 minutes 30 seconds', { language: 'en-US' });
  expect(haptic).toHaveBeenCalledTimes(1);
  expect(cues.onSnapshot(snap({ splits: [lap({})] }), on)).toEqual([]); // 同一分段不重播
  expect(cues.onSnapshot(snap({ splits: [lap({})], laps: [lap({ kind: 'manual', index: 1 })] }), on)).toEqual([]); // 手動圈不播
  active = false;
  expect(cues.onSnapshot(snap({ splits: [lap({}), lap({ index: 2 })] }), on)).toEqual([]); // 背景：不搶播
  active = true;
  expect(cues.onSnapshot(snap({ splits: [lap({}), lap({ index: 2 })] }), on)).toEqual([]); // 不補播過期提示
  expect(cues.onSnapshot(snap({ splits: [lap({}), lap({ index: 2 }), lap({ index: 3 })] }), { voice: false, haptic: false, locale: 'en' })).toEqual([]); // 預設關閉
  expect(speak).toHaveBeenCalledTimes(1);
});
