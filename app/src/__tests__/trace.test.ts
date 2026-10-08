/** 軌跡投影（domain/gps/trace）：精度過濾、缺口斷線、等比置中、比例尺。 */
import type { RawPoint } from '@/domain/gps/engine';
import { GPS_QUALITY } from '@/domain/gps/thresholds';
import { buildTrace, scaleBarMeters } from '@/domain/gps/trace';

const M_PER_DEG_LAT = 111_195;
const p = (seq: number, dx: number, dy: number, o: Partial<RawPoint> = {}): RawPoint => ({ seq, monotonicMs: seq * 1000, utcMs: seq * 1000, lat: 25 + dy / M_PER_DEG_LAT, lon: 121.5 + dx / (M_PER_DEG_LAT * Math.cos((25 * Math.PI) / 180)), accuracyM: 5, ...o });

test('空輸入／全部精度差 → 無線段、無比例尺', () => {
  expect(buildTrace([], { width: 300, height: 200 })).toMatchObject({ segments: [], metersPerPx: null, start: null, end: null, pointCount: 0 });
  // 門檻由 GPS_QUALITY.acceptMaxAccuracyM 決定（2026-09-19 統一為 50 m）；剛好等於門檻可採用，超過一點就略過
  expect(buildTrace([p(0, 0, 0, { accuracyM: GPS_QUALITY.acceptMaxAccuracyM })], { width: 300, height: 200 }).pointCount).toBe(1);
  expect(buildTrace([p(0, 0, 0, { accuracyM: GPS_QUALITY.acceptMaxAccuracyM + 1 })], { width: 300, height: 200 }).pointCount).toBe(0);
});

test('直線 100 m 東向：等比置中、起終點在左右、比例尺 20 m', () => {
  const t = buildTrace([p(0, 0, 0), p(1, 50, 0), p(2, 100, 0)], { width: 300, height: 200, padding: 16 });
  expect(t.segments).toHaveLength(1);
  expect(t.segments[0]).toHaveLength(3);
  expect(t.start!.x).toBeCloseTo(16, 0);
  expect(t.end!.x).toBeCloseTo(284, 0);
  expect(Math.abs(t.start!.y - 100)).toBeLessThan(2); // 垂直置中（零高度以 1 m 計）
  expect(t.metersPerPx!).toBeCloseTo(100 / 268, 3);
  expect(scaleBarMeters(t.metersPerPx)).toBe(20); // 20 m ≈ 54 px，介於 40～120
});

test('北向為畫布上方；缺口（> 5 s）斷成兩段、精度差的點被略過', () => {
  const t = buildTrace([p(0, 0, 0), p(1, 0, 100), p(2, 0, 120, { accuracyM: GPS_QUALITY.acceptMaxAccuracyM + 10 }), { ...p(3, 0, 200), monotonicMs: 20_000 }, { ...p(4, 0, 300), monotonicMs: 21_000 }], { width: 200, height: 400 });
  expect(t.pointCount).toBe(4);
  expect(t.segments).toHaveLength(2);
  expect(t.start!.y).toBeGreaterThan(t.end!.y);
});

test('比例尺：找不到 40～120 px 的候選 → null', () => {
  expect(scaleBarMeters(null)).toBeNull();
  expect(scaleBarMeters(0)).toBeNull();
  expect(scaleBarMeters(1000)).toBeNull(); // 1 px = 1 km → 最小候選 10 m 太短
});
