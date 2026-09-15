/** PG-R-04／R-05：固定軌跡重播 — 距離跨圈／跨多圈、暫停不重設分段、英里、最高 5 秒速度（跳點／不足窗）、零距離、末段不參與最快、缺口、去重與倒序、跑道等效圈。 */
import { GpsMetricsEngine, haversineMm, SPLIT_MILE_MM, type RawPoint } from '@/domain/gps/engine';

const M_PER_DEG_LAT = 111_195;
/** 產生沿緯度方向等速前進的軌跡：每 intervalMs 一點 */
function track(opts: { speedMs: number; seconds: number; startSec?: number; startLat?: number; intervalMs?: number; seqStart?: number; accuracy?: number }): RawPoint[] {
  const interval = opts.intervalMs ?? 1000;
  const pts: RawPoint[] = [];
  const n = Math.floor((opts.seconds * 1000) / interval);
  for (let i = 0; i <= n; i++) {
    const t = (opts.startSec ?? 0) * 1000 + i * interval;
    pts.push({ seq: (opts.seqStart ?? 0) + i, monotonicMs: t, utcMs: 1_700_000_000_000 + t, lat: (opts.startLat ?? 25) + (opts.speedMs * (i * interval)) / 1000 / M_PER_DEG_LAT, lon: 121.5, accuracyM: opts.accuracy ?? 5 });
  }
  return pts;
}
const run = (pts: RawPoint[], engine: GpsMetricsEngine) => pts.map((p) => engine.addPoint(p));

test('haversine：1 度緯度 ≈ 111.19 km', () => {
  expect(Math.round(haversineMm(0, 0, 1, 0) / 1_000_000)).toBe(111);
});

test('等速 3 m/s 跑 400 s：距離 ≈ 1.2 km、2 個公里分段（1 完整＋末段 partial）、末段不參與最快、平均配速含暫停', () => {
  const e = new GpsMetricsEngine('run');
  e.start(0);
  const r = run(track({ speedMs: 3, seconds: 400 }), e);
  expect(r.every((x) => x.accepted)).toBe(true);
  const s = e.finish(400_000);
  expect(s.distanceMm / 1_000_000).toBeCloseTo(1.2, 2);
  expect(s.splits.map((x) => [x.isPartial, Math.round(x.distanceMm / 1000)])).toEqual([[false, 1000], [true, 200]]);
  expect(s.splits[0]!.durationMs).toBeCloseTo(333_333, -3);
  expect(s.fastestSplit?.index).toBe(1);
  expect(s.avgPaceSPerKm).toBe(333);
  expect(s.maxSpeed5sKmh).toBeCloseTo(10.8, 0);
  expect(s.quality).toMatchObject({ accepted: 401, gaps: 0, segments: 1, complete: true });
  expect(s.trackEquivalent).toBeNull();
});

test('一次跨多界線：兩點相距 2.5 km（間隔 4 s、精度合格但速度超上限）→ 拒為跳點；用走路引擎、慢速大步跨界逐一切分', () => {
  const e = new GpsMetricsEngine('run', { maxSpeedMs: 10_000 }); // 關掉速度上限以測跨多界線
  e.start(0);
  e.addPoint({ seq: 0, monotonicMs: 0, utcMs: 0, lat: 25, lon: 121.5, accuracyM: 5 });
  e.addPoint({ seq: 1, monotonicMs: 4000, utcMs: 4000, lat: 25 + 2500 / M_PER_DEG_LAT, lon: 121.5, accuracyM: 5 });
  const s = e.finish(4000);
  expect(s.splits.filter((x) => !x.isPartial)).toHaveLength(2);
  expect(s.splits[0]!.endElapsedMs).toBe(1600);
  expect(s.splits[1]!.endElapsedMs).toBe(3200);
  expect(s.splits[2]).toMatchObject({ isPartial: true });
  const spike = new GpsMetricsEngine('run');
  spike.start(0);
  spike.addPoint({ seq: 0, monotonicMs: 0, utcMs: 0, lat: 25, lon: 121.5, accuracyM: 5 });
  expect(spike.addPoint({ seq: 1, monotonicMs: 4000, utcMs: 4000, lat: 25 + 2500 / M_PER_DEG_LAT, lon: 121.5, accuracyM: 5 })).toMatchObject({ accepted: false, reason: 'speed_spike' });
});

test('暫停不重設公里分段；暫停中的點拒絕；恢復後新段、5 秒窗重建；elapsed 含暫停、moving 不含', () => {
  const e = new GpsMetricsEngine('run');
  e.start(0);
  run(track({ speedMs: 3, seconds: 200 }), e); // 600 m
  expect(e.pause(200_000)).toBe(true);
  expect(e.addPoint({ seq: 999, monotonicMs: 205_000, utcMs: 0, lat: 26, lon: 121.5, accuracyM: 5 })).toMatchObject({ accepted: false, reason: 'paused' });
  expect(e.lap(205_000)).toBeNull();
  expect(e.resume(260_000)).toBe(true);
  expect(e.currentSpeedMs()).toBeNull();
  const startLat = 25 + (3 * 200) / M_PER_DEG_LAT;
  run(track({ speedMs: 3, seconds: 200, startSec: 260, startLat, seqStart: 1000 }), e); // 再 600 m
  const s = e.finish(460_000);
  expect(s.distanceMm / 1_000_000).toBeCloseTo(1.2, 1);
  expect(s.splits.filter((x) => !x.isPartial)).toHaveLength(1);
  expect(s.pausedMs).toBe(60_000);
  expect(s.elapsedMs).toBe(460_000);
  expect(s.movingMs).toBe(400_000);
  expect(s.quality.segments).toBe(2);
  expect(s.quality.gaps).toBe(0); // 暫停造成的新段不算缺口
});

test('英里分段必須用 1,609.344 m', () => {
  const e = new GpsMetricsEngine('run', { splitLengthMm: SPLIT_MILE_MM });
  e.start(0);
  run(track({ speedMs: 4, seconds: 500 }), e); // 2 km
  const s = e.finish(500_000);
  expect(s.splits[0]).toMatchObject({ distanceMm: 1_609_344, isPartial: false });
  expect(s.splits[1]!.isPartial).toBe(true);
});

test('最高速度：單點跳點不計；不足 5 秒窗顯示 —；正常窗取最大', () => {
  const e = new GpsMetricsEngine('run');
  e.start(0);
  run(track({ speedMs: 3, seconds: 3 }), e);
  expect(e.currentSpeedMs()).toBeNull();
  expect(e.currentPaceSPerKm()).toBeNull();
  run(track({ speedMs: 3, seconds: 10, startSec: 4, startLat: 25 + 12 / M_PER_DEG_LAT, seqStart: 100 }), e);
  expect(e.currentSpeedMs()).toBeCloseTo(3, 1);
  expect(e.currentPaceSPerKm()).toBe(333);
  // 跳點：1 秒內位移 50 m → 拒絕，不進最高速度
  expect(e.addPoint({ seq: 500, monotonicMs: 15_000, utcMs: 0, lat: 25 + (42 + 50) / M_PER_DEG_LAT, lon: 121.5, accuracyM: 5 })).toMatchObject({ accepted: false, reason: 'speed_spike' });
  const s = e.finish(15_000);
  expect(s.maxSpeed5sKmh).toBeLessThan(11);
});

test('零距離：原地抖動不累加、無分段、平均配速 —、手動 Lap 不新增', () => {
  const e = new GpsMetricsEngine('walk');
  e.start(0);
  for (let i = 0; i <= 30; i++) e.addPoint({ seq: i, monotonicMs: i * 1000, utcMs: 0, lat: 25 + ((i % 2) * 1) / M_PER_DEG_LAT, lon: 121.5, accuracyM: 8 });
  expect(e.lap(30_000)).toBeNull();
  const s = e.finish(30_000);
  expect(s.distanceMm).toBe(0);
  expect(s.splits).toEqual([]);
  expect(s.avgPaceSPerKm).toBeNull();
  expect(s.quality.stationary).toBe(30);
});

test('缺口 > 5 s：新段不補直線距離、gaps+1、跨缺口的分段標 uncertain 且不參與最快', () => {
  const e = new GpsMetricsEngine('run');
  e.start(0);
  run(track({ speedMs: 3, seconds: 100 }), e); // 300 m
  // 停 20 s 後從 900 m 處出現（缺口間 600 m 不補）
  run(track({ speedMs: 3, seconds: 300, startSec: 120, startLat: 25 + 900 / M_PER_DEG_LAT, seqStart: 1000 }), e); // 再 900 m
  const s = e.finish(420_000);
  expect(s.distanceMm / 1_000_000).toBeCloseTo(1.2, 1);
  expect(s.quality.gaps).toBe(1);
  expect(s.splits[0]).toMatchObject({ isPartial: false, uncertain: true });
  expect(s.fastestSplit).toBeNull();
  expect(s.quality.complete).toBe(false);
});

test('拒絕：非有限座標、精度 > 20 m、seq 重複、時間倒序；未開始／已結束的點', () => {
  const e = new GpsMetricsEngine('run');
  expect(e.addPoint({ seq: 0, monotonicMs: 0, utcMs: 0, lat: 25, lon: 121.5, accuracyM: 5 })).toMatchObject({ accepted: false, reason: 'not_recording' });
  e.start(0);
  expect(e.addPoint({ seq: 0, monotonicMs: 0, utcMs: 0, lat: NaN, lon: 121.5, accuracyM: 5 }).reason).toBe('not_finite');
  expect(e.addPoint({ seq: 1, monotonicMs: 1000, utcMs: 0, lat: 25, lon: 121.5, accuracyM: 35 }).reason).toBe('low_accuracy');
  expect(e.addPoint({ seq: 2, monotonicMs: 2000, utcMs: 0, lat: 25, lon: 121.5, accuracyM: 5 }).accepted).toBe(true);
  expect(e.addPoint({ seq: 2, monotonicMs: 3000, utcMs: 0, lat: 25, lon: 121.5, accuracyM: 5 }).reason).toBe('duplicate');
  expect(e.addPoint({ seq: 3, monotonicMs: 1500, utcMs: 0, lat: 25, lon: 121.5, accuracyM: 5 }).reason).toBe('out_of_order');
  const s = e.finish(3000);
  expect(s.quality.rejected).toMatchObject({ not_finite: 1, low_accuracy: 1, duplicate: 1, out_of_order: 1, not_recording: 1 });
  expect(e.addPoint({ seq: 9, monotonicMs: 9000, utcMs: 0, lat: 25, lon: 121.5, accuracyM: 5 }).reason).toBe('not_recording');
});

test('手動圈與 400 m 自動圈為獨立序列；手動圈不重設公里分段；跑道等效圈 = floor + 餘數', () => {
  const e = new GpsMetricsEngine('run', { autoLapMm: 400_000, trackLapMm: 400_000 });
  e.start(0);
  run(track({ speedMs: 4, seconds: 150 }), e); // 600 m
  const l1 = e.lap(150_000);
  expect(l1).toMatchObject({ kind: 'manual', index: 1 });
  expect(l1!.distanceMm / 1000).toBeCloseTo(600, 0);
  expect(e.lap(150_000)).toBeNull(); // 重複觸發：零距離零時間
  run(track({ speedMs: 4, seconds: 437, startSec: 151, startLat: 25 + 604 / M_PER_DEG_LAT, seqStart: 1000 }), e); // 約 +1748 m → 2.35 km
  const s = e.finish(588_000);
  expect(s.distanceMm / 1_000_000).toBeCloseTo(2.35, 1);
  expect(s.splits.filter((x) => !x.isPartial)).toHaveLength(2);
  expect(s.splits[2]).toMatchObject({ isPartial: true });
  const auto = s.laps.filter((l) => l.kind === 'auto_distance');
  expect(auto.filter((l) => !l.isPartial)).toHaveLength(5);
  expect(auto[auto.length - 1]!.isPartial).toBe(true);
  expect(s.laps.filter((l) => l.kind === 'manual')).toHaveLength(1);
  expect(s.trackEquivalent).toMatchObject({ laps: 5, lapMm: 400_000 });
  expect(s.trackEquivalent!.remainderMm / 1000).toBeCloseTo(350, -1);
});
