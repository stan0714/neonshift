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
  expect(e.currentPaceSPerKm()).toBe(335); // 顯示用配速取到 5 秒
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
  expect(e.addPoint({ seq: 1, monotonicMs: 1000, utcMs: 0, lat: 25, lon: 121.5, accuracyM: 65 }).reason).toBe('low_accuracy');
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

test('PG-R-12 跑道等效圈：記錄中即時 floor＋餘數、與摘要一致；未啟用 → null；圈長非正數 → null', () => {
  const e = new GpsMetricsEngine('run', { trackLapMm: 200_000 });
  e.start(0);
  expect(e.trackEquivalent()).toEqual({ laps: 0, remainderMm: 0, lapMm: 200_000 });
  run(track({ speedMs: 4, seconds: 125 }), e); // ≈ 500 m
  const live = e.trackEquivalent()!;
  expect(live.laps).toBe(2);
  expect(live.remainderMm / 1000).toBeCloseTo(100, -1);
  expect(e.finish(125_000).trackEquivalent).toEqual(live);
  expect(new GpsMetricsEngine('run').trackEquivalent()).toBeNull();
  expect(new GpsMetricsEngine('run', { trackLapMm: 0 }).trackEquivalent()).toBeNull();
});

describe('完整性／防弊（GPS_RULES_VERSION 2）', () => {
  test('模擬定位點一律拒絕並標 mock_location；正常點不受影響', () => {
    const e = new GpsMetricsEngine('run');
    e.start(0);
    const t = track({ speedMs: 3, seconds: 20 });
    t[5] = { ...t[5]!, mocked: true };
    t[6] = { ...t[6]!, mocked: true };
    const r = run(t, e);
    expect(r.filter((x) => x.reason === 'mock_location')).toHaveLength(2);
    const s = e.finish(20_000);
    expect(s.integrity).toMatchObject({ mockPoints: 2, flags: ['mock_location'] });
    expect(s.quality.rejected.mock_location).toBe(2);
  });

  test('持續超速：跑步 60 秒滑動窗平均 > 6.5 m/s 記一次 episode（單點跳點另計）；3 m/s 不記', () => {
    const ok = new GpsMetricsEngine('run');
    ok.start(0);
    run(track({ speedMs: 3, seconds: 180 }), ok);
    expect(ok.finish(180_000).integrity).toMatchObject({ sustainedSpeedEpisodes: 0, flags: [] });
    const fast = new GpsMetricsEngine('run');
    fast.start(0);
    run(track({ speedMs: 8, seconds: 180 }), fast); // 8 m/s < 12 m/s 跳點上限，但持續 3 分鐘 ≈ 29 km/h
    const s = fast.finish(180_000);
    expect(s.integrity.sustainedSpeedEpisodes).toBe(1);
    expect(s.integrity.flags).toEqual(['sustained_speed']);
    // 走路 3 m/s（10.8 km/h）持續也超過 2.8 m/s
    const walk = new GpsMetricsEngine('walk');
    walk.start(0);
    run(track({ speedMs: 3, seconds: 120 }), walk);
    expect(walk.finish(120_000).integrity.flags).toEqual(['sustained_speed']);
  });

  test('缺口瞬移：10 秒缺口內位移 500 m（50 m/s）記 gap_teleport；缺口內位移合理則只算缺口', () => {
    const e = new GpsMetricsEngine('run');
    e.start(0);
    run(track({ speedMs: 3, seconds: 10 }), e);
    run(track({ speedMs: 3, seconds: 10, startSec: 20, startLat: 25 + 530 / M_PER_DEG_LAT, seqStart: 100 }), e);
    const s = e.finish(30_000);
    expect(s.quality.gaps).toBe(1);
    expect(s.integrity).toMatchObject({ gapTeleports: 1, flags: ['gap_teleport'] });
    const fine = new GpsMetricsEngine('run');
    fine.start(0);
    run(track({ speedMs: 3, seconds: 10 }), fine);
    run(track({ speedMs: 3, seconds: 10, startSec: 20, startLat: 25 + 60 / M_PER_DEG_LAT, seqStart: 100 }), fine);
    expect(fine.finish(30_000).integrity.flags).toEqual([]);
  });

  test('時鐘漂移：utc − monotonic 偏移量變化 > 30 s 記 clock_drift', () => {
    const e = new GpsMetricsEngine('run');
    e.start(0);
    const t = track({ speedMs: 3, seconds: 20 });
    for (let i = 10; i < t.length; i++) t[i] = { ...t[i]!, utcMs: t[i]!.utcMs + 60_000 }; // 中途系統時鐘被調快 60 s
    run(t, e);
    const s = e.finish(20_000);
    expect(s.integrity.clockDriftMs).toBe(60_000);
    expect(s.integrity.flags).toEqual(['clock_drift']);
  });

  test('感測器探測：≥ 2 次且過半不一致才記 motion_mismatch', () => {
    const e = new GpsMetricsEngine('run');
    e.start(0);
    run(track({ speedMs: 3, seconds: 10 }), e);
    e.recordMotionProbe(true);
    expect(e.integrity().flags).toEqual([]); // 1 次不足
    e.recordMotionProbe(false);
    e.recordMotionProbe(false);
    expect(e.integrity().flags).toEqual([]); // 1/3 不過半
    e.recordMotionProbe(true);
    e.recordMotionProbe(true);
    expect(e.integrity()).toMatchObject({ motionProbes: { total: 5, mismatched: 3 }, flags: ['motion_mismatch'] });
  });
});

describe('靜止漂移抑制（GPS_RULES_VERSION 3）', () => {
  const prng = (seed: number) => () => { seed = (seed * 1_664_525 + 1_013_904_223) % 4_294_967_296; return seed / 4_294_967_296; };
  test('放在桌上 30 分鐘：位置在 ±12 m 內隨機漂移、OS 速度 0 → 距離 < 30 m（v2 會累積數百公尺）', () => {
    const rnd = prng(7);
    const e = new GpsMetricsEngine('run');
    e.start(0);
    for (let i = 0; i <= 1800; i++) {
      const acc = 8 + rnd() * 12; // 8～20 m
      e.addPoint({ seq: i, monotonicMs: i * 1000, utcMs: i * 1000, lat: 25 + ((rnd() - 0.5) * 24) / M_PER_DEG_LAT, lon: 121.5 + ((rnd() - 0.5) * 24) / (M_PER_DEG_LAT * Math.cos((25 * Math.PI) / 180)), accuracyM: acc, speedMs: rnd() * 0.2 });
    }
    const s = e.finish(1_800_000);
    expect(s.distanceMm).toBeLessThan(30_000);
    expect(s.quality.stationary).toBeGreaterThan(1000); // 其餘為速度跳點拒絕（隨機跳 > 12 m/s）
  });
  test('真的在走：1.4 m/s、OS 速度 1.3、精度 12 m → 距離仍正確累積（≈ 168 m／2 min）', () => {
    const e = new GpsMetricsEngine('walk');
    e.start(0);
    for (let i = 0; i <= 120; i++) e.addPoint({ seq: i, monotonicMs: i * 1000, utcMs: i * 1000, lat: 25 + (1.4 * i) / M_PER_DEG_LAT, lon: 121.5, accuracyM: 12, speedMs: 1.3 });
    const s = e.finish(120_000);
    expect(s.distanceMm / 1000).toBeGreaterThan(155);
    expect(s.distanceMm / 1000).toBeLessThanOrEqual(168);
  });
  test('OS 速度永遠 0 的裝置：位移超過 3 × 精度仍信位置（跑 3 m/s、精度 5 m）', () => {
    const e = new GpsMetricsEngine('run');
    e.start(0);
    for (let i = 0; i <= 60; i++) e.addPoint({ seq: i, monotonicMs: i * 1000, utcMs: i * 1000, lat: 25 + (3 * i) / M_PER_DEG_LAT, lon: 121.5, accuracyM: 5, speedMs: 0 });
    expect(e.finish(60_000).distanceMm / 1000).toBeGreaterThan(165);
  });
});

test('顯示配速保持（實機：主數字每秒跳動）：GPS 抖動下 5 秒窗每秒變、顯示配速一分鐘內只換少數次且落在 5 s 格', () => {
  const e = new GpsMetricsEngine('run');
  e.start(0);
  // 每秒交替 2.4／3.6 m/s（平均 3 m/s）的抖動軌跡 70 s
  let lat = 25;
  const rawSeen = new Set<number>();
  const shownSeen: (number | null)[] = [];
  for (let i = 0; i <= 70; i++) {
    e.addPoint({ seq: i, monotonicMs: i * 1000, utcMs: i * 1000, lat, lon: 121.5, accuracyM: 5 });
    lat += (i % 2 === 0 ? 2.4 : 3.6) / M_PER_DEG_LAT;
    if (i >= 20) {
      rawSeen.add(Math.round((e.windowSpeedMs() ?? 0) * 100));
      const p = e.currentPaceSPerKm();
      if (shownSeen[shownSeen.length - 1] !== p) shownSeen.push(p);
    }
  }
  expect(rawSeen.size).toBeGreaterThan(1); // 原始 5 秒窗確實在跳
  expect(shownSeen.length).toBeLessThanOrEqual(4); // 顯示值 50 s 內最多換幾次
  for (const p of shownSeen) expect(p! % 5).toBe(0);
  expect(Math.abs(e.currentPaceSPerKm()! - 335)).toBeLessThanOrEqual(15); // 接近 3 m/s ≈ 5:33
  // 前 10 s 窗未滿 → 顯示 —；5 秒窗（最高速度）仍照舊
  const f = new GpsMetricsEngine('run');
  f.start(0);
  run(track({ speedMs: 3, seconds: 8 }), f);
  expect(f.windowSpeedMs()).not.toBeNull();
  expect(f.currentPaceSPerKm()).toBeNull();
});

test('顯示速度平滑（EMA τ 15 s）：速度驟變時顯示值漸進、原始 5 秒窗即時；恢復後重設', () => {
  const e = new GpsMetricsEngine('run');
  e.start(0);
  run(track({ speedMs: 3, seconds: 12 }), e);
  expect(e.currentSpeedMs()).toBeCloseTo(3, 1);
  // 突然變 1.5 m/s：5 秒窗約 6 秒後到 1.5，EMA 應仍明顯高於窗值
  run(track({ speedMs: 1.5, seconds: 6, startSec: 13, startLat: 25 + 36 / M_PER_DEG_LAT, seqStart: 100 }), e);
  const raw = e.windowSpeedMs()!;
  const shown = e.currentSpeedMs()!;
  expect(raw).toBeLessThan(2);
  expect(shown).toBeGreaterThan(raw + 0.2);
  expect(shown).toBeLessThan(3);
  expect(e.currentPaceSPerKm()! % 5).toBe(0);
  e.pause(20_000);
  e.resume(30_000);
  expect(e.currentSpeedMs()).toBeNull();
});
