/** PG-R-03：LocalWorkoutStore 加密軌跡／checkpoint／去重；WorkoutRecorder 狀態機（單一 session、暫停／恢復／Lap、先保存再同步、同步失敗保留、跨 process 恢復標 interrupted 只允許結束、丟棄清除路線）。 */
import * as Location from 'expo-location';

import type { RawPoint } from '@/domain/gps/engine';
import { LocalWorkoutStore } from '@/services/workouts/LocalWorkoutStore';
import { toRawPoints } from '@/services/workouts/locationTask';
import { WorkoutRecorder } from '@/services/workouts/WorkoutRecorder';

jest.mock('expo-crypto', () => { let n = 0; return { randomUUID: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` }; });
const fsMock = jest.requireMock('expo-file-system') as { __reset: () => void };
const loc = jest.requireMock('expo-location') as Record<string, jest.Mock>;

const M_PER_DEG_LAT = 111_195;
const pts = (n: number, startMs: number, seqStart = 0, speed = 3): RawPoint[] => Array.from({ length: n }, (_, i) => ({ seq: seqStart + i, monotonicMs: startMs + i * 1000, utcMs: startMs + i * 1000, lat: 25 + (speed * (seqStart + i)) / M_PER_DEG_LAT, lon: 121.5, accuracyM: 5 }));

beforeEach(() => {
  fsMock.__reset();
  jest.clearAllMocks();
});

describe('LocalWorkoutStore', () => {
  test('建立 → 追加加密點 → 讀回去重排序；meta 不含座標；刪除清空', async () => {
    const store = new LocalWorkoutStore();
    const meta = await store.create({ sessionId: 's1', sport: 'run', environment: 'outdoor', autoLapMm: null, splitLengthMm: 1_000_000, status: 'recording', startedAtUtc: 1000, startedMonoMs: 1000, processId: 'p1' });
    await store.appendPoints('s1', pts(3, 1000));
    await store.appendPoints('s1', pts(3, 3000, 2)); // seq 2 重複
    const back = await store.readPoints('s1');
    expect(back.map((p) => p.seq)).toEqual([0, 1, 2, 3, 4]);
    expect(JSON.stringify(store.readMeta('s1'))).not.toContain('"lat"');
    expect(store.list().map((m) => m.sessionId)).toEqual(['s1']);
    expect(store.recoverable()).toHaveLength(1);
    // 磁碟上的 points.log 不是明文
    const { File, Paths } = jest.requireMock('expo-file-system') as typeof import('expo-file-system');
    expect(new File(Paths.document, 'workouts', 's1', 'points.log').textSync()).not.toContain('121.5');
    meta.status = 'saved';
    await store.writeMeta(meta);
    expect(store.recoverable()).toHaveLength(0);
    store.delete('s1');
    expect(store.list()).toEqual([]);
    expect(await store.readPoints('s1')).toEqual([]);
  });
});

describe('WorkoutRecorder', () => {
  const mk = (over: { sync?: jest.Mock; now?: () => number } = {}) => {
    let t = 1_000_000;
    const now = over.now ?? (() => t);
    const sync = over.sync ?? jest.fn(async () => ({ sessionId: 'server-1' }));
    const store = new LocalWorkoutStore();
    // 測試用假時鐘會跳躍，關掉牆鐘／單調時鐘漂移偵測與感測器探測（另有專門測試）
    const rec = new WorkoutRecorder({ store, now, sync, monotonic: null, motionProbe: null });
    return { rec, store, sync, tick: (ms: number) => { t += ms; } };
  };

  test('start：前景服務定位；同時只允許一個；室內拒絕；點先落地再餵引擎；Lap／Pause／Resume；finish 先保存摘要再同步（origin gps、無座標）', async () => {
    const { rec, store, sync, tick } = mk();
    await expect(rec.start({ sport: 'run', environment: 'indoor' })).rejects.toThrow(/indoor/);
    const meta = await rec.start({ sport: 'run', environment: 'outdoor' });
    expect(loc.startLocationUpdatesAsync).toHaveBeenCalledWith('neonshift-workout-location-v3', expect.objectContaining({ foregroundService: expect.objectContaining({ notificationTitle: expect.any(String) }) }));
    await expect(rec.start({ sport: 'walk', environment: 'outdoor' })).rejects.toThrow(/already/);
    rec.ingest(pts(200, 1_000_000)); // 600 m
    await new Promise((r) => setTimeout(r, 0));
    expect((await store.readPoints(meta.sessionId)).length).toBe(200);
    expect(rec.snapshot()).toMatchObject({ state: 'recording', accepted: 200, gps: 'ok' });
    tick(200_000);
    expect(rec.snapshot().gps).toBe('searching'); // 10 秒沒有點
    expect(rec.snapshot().distanceMm / 1000).toBeCloseTo(597, -1);
    const lap = await rec.lap();
    expect(lap?.kind).toBe('manual');
    expect(await rec.pause()).toBe(true);
    rec.ingest(pts(1, 1_200_000, 999)); // 暫停中的點不接受
    expect(rec.snapshot().accepted).toBe(200);
    tick(30_000);
    expect(await rec.resume()).toBe(true);
    rec.ingest(pts(200, 1_230_000, 200)); // 再 600 m（座標從 seq 200 續）
    tick(200_000);
    const r = await rec.finish();
    expect(loc.stopLocationUpdatesAsync).toHaveBeenCalled();
    expect(r.summary.distanceMm / 1_000_000).toBeCloseTo(1.2, 1);
    expect(r.summary.pausedMs).toBe(30_000);
    expect(r.synced).toBe(true);
    const input = sync.mock.calls[0]![0] as Record<string, unknown>;
    expect(input).toMatchObject({ origin: 'gps', external_record_id: meta.sessionId, distance_method: 'gps', paused_ms: '30000' });
    expect(JSON.stringify(input)).not.toMatch(/"lat"|121\.5/);
    expect(store.readMeta(meta.sessionId)).toMatchObject({ status: 'saved', syncedSessionId: 'server-1' });
    expect(rec.snapshot().state).toBe('idle');
  });

  test('同步失敗：本機已保存（saved）、syncedSessionId 空、可再同步；缺口 → needs_review 並帶 gps_gap', async () => {
    const sync: jest.Mock = jest.fn(async () => { throw new Error('offline'); });
    const { rec, store, tick } = mk({ sync });
    const meta = await rec.start({ sport: 'walk', environment: 'outdoor' });
    rec.ingest(pts(60, 1_000_000, 0, 1.2));
    rec.ingest(pts(60, 1_100_000, 60, 1.2)); // 40 s 缺口
    tick(160_000);
    const r = await rec.finish();
    expect(r.synced).toBe(false);
    expect(store.readMeta(meta.sessionId)).toMatchObject({ status: 'needs_review', syncedSessionId: null });
    expect(r.summary.quality.gaps).toBe(1);
    sync.mockResolvedValueOnce({ sessionId: 'server-2' } as never);
    expect((await rec.syncMeta(store.readMeta(meta.sessionId)!)).ok).toBe(true);
    expect((sync.mock.calls[1]![0] as { client_flags: string[] }).client_flags).toContain('gps_gap');
  });

  test('恢復：另一個 process 的未結束 session 標 recoverable／interrupted，continue 被拒改為結束（以最後一點時間、不補負時間）；discard 清除路線', async () => {
    const storeA = new LocalWorkoutStore();
    const recA = new WorkoutRecorder({ store: storeA, now: () => 1_000_000, sync: jest.fn(async () => ({ sessionId: null })), monotonic: null, motionProbe: null });
    const meta = await recA.start({ sport: 'run', environment: 'outdoor' });
    recA.ingest(pts(120, 1_000_000)); // 360 m
    await new Promise((r) => setTimeout(r, 0));
    // 新 process
    const storeB = new LocalWorkoutStore();
    const sync: jest.Mock = jest.fn(async () => ({ sessionId: 'server-3' }));
    const recB = new WorkoutRecorder({ store: storeB, now: () => 2_000_000, sync, monotonic: null, motionProbe: null });
    const list = await recB.markRecoverable();
    expect(list.map((m) => [m.sessionId, m.status, m.interrupted])).toEqual([[meta.sessionId, 'recoverable', true]]);
    const c = await recB.recover(meta.sessionId, 'continue');
    expect(c.summary).toBeTruthy(); // interrupted → 不續錄，直接結束
    expect(c.meta?.status).toBe('needs_review');
    expect(c.summary!.distanceMm / 1000).toBeCloseTo(357, -1);
    expect(c.summary!.elapsedMs).toBe(119_000); // 最後一點時間 − 開始
    expect((sync.mock.calls[0]![0] as { client_flags: string[] }).client_flags).toContain('interrupted');
    expect(recB.snapshot().state).toBe('idle');
    // 丟棄另一個
    const meta2 = await recA.start({ sport: 'run', environment: 'outdoor' }).catch(() => null);
    expect(meta2).toBeNull(); // recA 仍有 active session（同 process）
    await recB.recover(meta.sessionId, 'discard');
    expect(storeB.list().map((m) => m.sessionId)).not.toContain(meta.sessionId);
  });

  test('PG-R-12 跑道模式：trackLapMm 寫入 meta、snapshot 即時等效圈、摘要 extras 帶 track_equivalent；跨 process 恢復沿用圈長；舊 meta 無欄位 → null', async () => {
    const storeA = new LocalWorkoutStore();
    const recA = new WorkoutRecorder({ store: storeA, now: () => 1_000_000, sync: jest.fn(async () => ({ sessionId: null })), monotonic: null, motionProbe: null });
    const meta = await recA.start({ sport: 'run', environment: 'outdoor', trackLapMm: 400_000 });
    expect(storeA.readMeta(meta.sessionId)?.trackLapMm).toBe(400_000);
    recA.ingest(pts(200, 1_000_000)); // ≈ 600 m
    expect(recA.snapshot().trackEquivalent).toMatchObject({ laps: 1, lapMm: 400_000 });
    await new Promise((r) => setTimeout(r, 0));
    const sync: jest.Mock = jest.fn(async () => ({ sessionId: 'server-7' }));
    const recB = new WorkoutRecorder({ store: new LocalWorkoutStore(), now: () => 2_000_000, sync, monotonic: null, motionProbe: null });
    await recB.markRecoverable();
    const c = await recB.recover(meta.sessionId, 'continue');
    expect(c.summary!.trackEquivalent).toMatchObject({ laps: 1, lapMm: 400_000 });
    expect((sync.mock.calls[0]![0] as { extras: { track_equivalent: unknown } }).extras.track_equivalent).toMatchObject({ laps: 1, lapMm: 400_000 });
    // 未啟用
    const recC = new WorkoutRecorder({ store: new LocalWorkoutStore(), now: () => 3_000_000, sync: jest.fn(async () => ({ sessionId: null })), monotonic: null, motionProbe: null });
    await recC.start({ sport: 'walk', environment: 'outdoor' });
    expect(recC.snapshot().trackEquivalent).toBeNull();
    const s = await recC.finish();
    expect(s.summary.trackEquivalent).toBeNull();
  });

  test('toRawPoints：同 timestamp 重送不重播、精度缺 → ∞（引擎會拒）', () => {
    const l = (ts: number, acc: number | null) => ({ timestamp: ts, coords: { latitude: 25, longitude: 121.5, accuracy: acc, speed: null, altitude: null, altitudeAccuracy: null, heading: null } });
    const out = toRawPoints([l(1000, 5), l(1000, 5), l(2000, null)] as never);
    expect(out.map((p) => [p.seq, p.accuracyM])).toEqual([[0, 5], [1, Number.POSITIVE_INFINITY]]);
  });

  test('完整性探測（防弊）：GPS 在動而機身無步態 → 兩次不一致記 motion_mismatch；結束 needs_review、client_flags 與 extras.integrity 上送；量不到不計', async () => {
    let t = 1_000_000;
    const sync = jest.fn(async (_input: unknown) => ({ sessionId: 'server-1' }));
    const probe = jest.fn<Promise<boolean | null>, []>();
    const rec = new WorkoutRecorder({ store: new LocalWorkoutStore(), now: () => t, sync, motionProbe: probe, probeIntervalMs: 999_999, monotonic: null });
    await rec.start({ sport: 'run', environment: 'outdoor' });
    await rec.runProbe(); // 還沒有 5 秒窗 → 不探測
    expect(probe).not.toHaveBeenCalled();
    rec.ingest(pts(30, 1_000_000)); // 3 m/s
    t += 30_000;
    probe.mockResolvedValueOnce(null); // 背景／無感測器：不計
    await rec.runProbe();
    probe.mockResolvedValueOnce(false);
    await rec.runProbe();
    expect(rec.snapshot().integrityFlags).toEqual([]);
    probe.mockResolvedValueOnce(false);
    await rec.runProbe();
    expect(rec.snapshot().integrityFlags).toEqual(['motion_mismatch']);
    const r = await rec.finish();
    expect(r.meta.status).toBe('needs_review');
    expect(r.summary.integrity).toMatchObject({ motionProbes: { total: 2, mismatched: 2 }, flags: ['motion_mismatch'] });
    const payload = sync.mock.calls[0]![0] as unknown as { client_flags: string[]; extras: { integrity: { flags: string[] } } };
    expect(payload.client_flags).toContain('motion_mismatch');
    expect(payload.extras.integrity.flags).toEqual(['motion_mismatch']);
  });

  test('模擬定位（LocationObject.mocked）→ RawPoint.mocked → 引擎拒絕並標旗；結束 needs_review', async () => {
    let t = 1_000_000;
    const rec = new WorkoutRecorder({ store: new LocalWorkoutStore(), now: () => t, sync: jest.fn(async () => ({ sessionId: null })), motionProbe: null, monotonic: null });
    await rec.start({ sport: 'walk', environment: 'outdoor' });
    const raw = toRawPoints([{ timestamp: 1_000_000, mocked: true, coords: { latitude: 25, longitude: 121.5, accuracy: 5, altitude: null, altitudeAccuracy: null, heading: null, speed: null } }] as never);
    expect(raw[0]!.mocked).toBe(true);
    rec.ingest([...raw, ...pts(10, 1_001_000, 1, 1)]);
    t += 11_000;
    expect(rec.snapshot().integrityFlags).toEqual(['mock_location']);
    const r = await rec.finish();
    expect(r.meta.status).toBe('needs_review');
    expect(r.summary.integrity.mockPoints).toBe(1);
  });

  test('時鐘漂移：記錄中牆鐘相對單調時鐘跳 60 s → clock_drift（needs_review）', async () => {
    let wall = 1_000_000;
    let mono = 500;
    const rec = new WorkoutRecorder({ store: new LocalWorkoutStore(), now: () => wall, sync: jest.fn(async () => ({ sessionId: null })), motionProbe: null, monotonic: () => mono });
    await rec.start({ sport: 'run', environment: 'outdoor' });
    rec.ingest(pts(5, 1_000_000));
    wall += 5_000; mono += 5_000;
    rec.ingest(pts(5, 1_005_000, 5));
    expect(rec.snapshot().integrityFlags).toEqual([]);
    wall += 65_000; mono += 5_000; // 使用者把系統時間調快 60 s
    rec.ingest(pts(5, 1_070_000, 10));
    expect(rec.snapshot().integrityFlags).toEqual(['clock_drift']);
    const r = await rec.finish();
    expect(r.meta.status).toBe('needs_review');
    expect(r.summary.integrity.clockDriftMs).toBe(60_000);
  });

  test('自動暫停（Style 23.7）：靜止 ≥ 10 s 自動暫停（kind auto）、移動 ≥ 15 m 自動繼續；手動暫停不被移動解除；未啟用不動作', async () => {
    let t = 1_000_000;
    const still = (n: number, startMs: number, seqStart: number, lat: number): RawPoint[] => Array.from({ length: n }, (_, i) => ({ seq: seqStart + i, monotonicMs: startMs + i * 1000, utcMs: startMs + i * 1000, lat, lon: 121.5, accuracyM: 5 }));
    const rec = new WorkoutRecorder({ store: new LocalWorkoutStore(), now: () => t, sync: jest.fn(async () => ({ sessionId: null })), motionProbe: null, monotonic: null });
    await rec.start({ sport: 'run', environment: 'outdoor', autoPause: true });
    rec.ingest(pts(20, 1_000_000)); // 3 m/s 前進 20 s
    t += 20_000;
    const lat = 25 + (3 * 19) / M_PER_DEG_LAT;
    // 原地 6 s：5 秒窗速度降到 0 但不足 10 s → 仍在記錄
    for (let i = 0; i < 6; i++) { t += 1000; rec.ingest(still(1, t, 100 + i, lat)); }
    expect(rec.snapshot().state).toBe('recording');
    // 再原地 8 s → 5 秒窗速度歸零起算滿 10 s → 自動暫停
    for (let i = 0; i < 8; i++) { t += 1000; rec.ingest(still(1, t, 200 + i, lat)); }
    expect(rec.snapshot()).toMatchObject({ state: 'paused', pauseKind: 'auto' });
    // 暫停中小幅移動 5 m 不繼續；移動 20 m → 自動繼續
    t += 1000; rec.ingest(still(1, t, 300, lat + 5 / M_PER_DEG_LAT));
    expect(rec.snapshot().state).toBe('paused');
    t += 1000; rec.ingest(still(1, t, 301, lat + 20 / M_PER_DEG_LAT));
    expect(rec.snapshot()).toMatchObject({ state: 'recording', pauseKind: null });
    expect(rec.snapshot().autoPausedMs).toBeGreaterThan(0);
    // 手動暫停：之後即使移動 100 m 也不自動繼續
    await rec.pause();
    t += 1000; rec.ingest(still(1, t, 400, lat + 120 / M_PER_DEG_LAT));
    expect(rec.snapshot()).toMatchObject({ state: 'paused', pauseKind: 'manual' });
    await rec.resume();
    const r = await rec.finish();
    expect(r.meta.pauses.map((p) => p.kind)).toEqual(['auto', 'manual']);
    expect(r.meta.autoPause).toBe(true);
    // 未啟用：靜止 20 s 仍記錄中
    let t2 = 5_000_000;
    const off = new WorkoutRecorder({ store: new LocalWorkoutStore(), now: () => t2, sync: jest.fn(async () => ({ sessionId: null })), motionProbe: null, monotonic: null });
    await off.start({ sport: 'run', environment: 'outdoor' });
    off.ingest(pts(10, 5_000_000));
    t2 += 10_000;
    for (let i = 0; i < 20; i++) { t2 += 1000; off.ingest(still(1, t2, 100 + i, 25 + (3 * 9) / M_PER_DEG_LAT)); }
    expect(off.snapshot().state).toBe('recording');
    await off.finish();
  });
});

describe('前景通知（實機回饋：退到背景不知道還在記錄）', () => {
  test('每 30 s 以最新距離／時間重送定位選項更新通知；暫停／繼續立即更新；文案由畫面提供', async () => {
    let t = 1_000_000;
    const rec = new WorkoutRecorder({ store: new LocalWorkoutStore(), now: () => t, sync: jest.fn(async () => ({ sessionId: null })), monotonic: null, motionProbe: null });
    rec.setForegroundText((s) => ({ title: s.state === 'paused' ? 'P' : 'R', body: `${(s.distanceMm / 1_000_000).toFixed(2)} km` }));
    await rec.start({ sport: 'run', environment: 'outdoor' });
    expect(loc.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
    expect(loc.startLocationUpdatesAsync.mock.calls[0]![1].foregroundService).toMatchObject({ notificationTitle: 'R', notificationBody: '0.00 km' });
    // 20 s 內不重送
    for (let i = 0; i < 20; i++) { t += 1000; rec.ingest(pts(1, t, i)); }
    expect(loc.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
    // 滿 30 s → 重送一次，帶最新距離
    for (let i = 20; i < 31; i++) { t += 1000; rec.ingest(pts(1, t, i)); }
    expect(loc.startLocationUpdatesAsync).toHaveBeenCalledTimes(2);
    expect(loc.startLocationUpdatesAsync.mock.calls[1]![1].foregroundService.notificationBody).toMatch(/^0\.\d\d km$/);
    expect(loc.startLocationUpdatesAsync.mock.calls[1]![1].foregroundService.notificationBody).not.toBe('0.00 km');
    // 暫停／繼續：不等 30 s
    t += 1000; await rec.pause();
    expect(loc.startLocationUpdatesAsync).toHaveBeenCalledTimes(3);
    expect(loc.startLocationUpdatesAsync.mock.calls[2]![1].foregroundService.notificationTitle).toBe('P');
    t += 1000; await rec.resume();
    expect(loc.startLocationUpdatesAsync).toHaveBeenCalledTimes(4);
    expect(loc.startLocationUpdatesAsync.mock.calls[3]![1].foregroundService.notificationTitle).toBe('R');
    await rec.finish();
  });
});
