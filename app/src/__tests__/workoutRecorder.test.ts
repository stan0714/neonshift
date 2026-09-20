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
    expect(rec.snapshot().state).toBe('idle'); // review 3：保存後立即回到 idle，不等同步
    expect((await r.sync).ok).toBe(true);
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
    expect((await r.sync).ok).toBe(false);
    expect(store.readMeta(meta.sessionId)).toMatchObject({ status: 'needs_review', syncedSessionId: null });
    expect(r.summary.quality.gaps).toBe(1);
    sync.mockResolvedValueOnce({ sessionId: 'server-2' } as never);
    expect((await rec.syncMeta(store.readMeta(meta.sessionId)!)).ok).toBe(true);
    expect((sync.mock.calls[1]![0] as { client_flags: string[] }).client_flags).toContain('gps_gap');
    expect(sync.mock.calls[1]![0].extras.route_appearance).toEqual({ version: 1, layer: 'grid' });
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
    // 暫停中小幅移動 5 m 不繼續；單一點 20 m 不算（review 4：需連續 2 個可用點都離開 ≥ 15 m，抵擋單點飄移）
    t += 1000; rec.ingest(still(1, t, 300, lat + 5 / M_PER_DEG_LAT));
    expect(rec.snapshot().state).toBe('paused');
    t += 1000; rec.ingest(still(1, t, 301, lat + 20 / M_PER_DEG_LAT));
    expect(rec.snapshot().state).toBe('paused');
    // 中間插一個飄回去的點 → 連續計數歸零；之後再兩點才繼續
    t += 1000; rec.ingest(still(1, t, 302, lat + 3 / M_PER_DEG_LAT));
    t += 1000; rec.ingest(still(1, t, 303, lat + 22 / M_PER_DEG_LAT));
    expect(rec.snapshot().state).toBe('paused');
    t += 1000; rec.ingest(still(1, t, 304, lat + 25 / M_PER_DEG_LAT));
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
    // 暫停／繼續：不等 30 s（更新經序列化佇列，等一個 tick）
    const tick = () => new Promise((r) => setTimeout(r, 0));
    t += 1000; await rec.pause(); await tick();
    expect(loc.startLocationUpdatesAsync).toHaveBeenCalledTimes(3);
    expect(loc.startLocationUpdatesAsync.mock.calls[2]![1].foregroundService.notificationTitle).toBe('P');
    t += 1000; await rec.resume(); await tick();
    expect(loc.startLocationUpdatesAsync).toHaveBeenCalledTimes(4);
    expect(loc.startLocationUpdatesAsync.mock.calls[3]![1].foregroundService.notificationTitle).toBe('R');
    await rec.finish();
  });
});

describe('2026-09-19 review：可重試啟動、寫入失敗不掉點、序列化定位服務、探測綁定 session、meta 原子寫入', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const mk = (over: { sync?: jest.Mock; now?: () => number; store?: LocalWorkoutStore } = {}) => {
    let t = 1_000_000;
    const now = over.now ?? (() => t);
    const sync = over.sync ?? jest.fn(async () => ({ sessionId: 'server-1' }));
    const store = over.store ?? new LocalWorkoutStore();
    const rec = new WorkoutRecorder({ store, now, sync, monotonic: null, motionProbe: null });
    return { rec, store, sync, tick: (ms: number) => { t += ms; } };
  };

  test('review 1：定位服務啟動失敗 → start 拒絕、回到 idle、本機不留半截 session；再 start 可成功', async () => {
    const { rec, store } = mk();
    loc.startLocationUpdatesAsync.mockRejectedValueOnce(new Error('foreground service not allowed'));
    const states: string[] = [];
    rec.subscribe(() => states.push(rec.snapshot().state));
    await expect(rec.start({ sport: 'run', environment: 'outdoor' })).rejects.toThrow(/foreground service/);
    expect(states).toContain('starting');
    expect(rec.snapshot()).toMatchObject({ state: 'idle', sessionId: null });
    expect(store.list()).toEqual([]); // 不會變成一筆可恢復的空紀錄
    // 之前的 bug：這裡會被「a session is already active」擋住
    const meta = await rec.start({ sport: 'run', environment: 'outdoor' });
    expect(rec.snapshot()).toMatchObject({ state: 'recording', sessionId: meta.sessionId });
    await rec.finish();
  });

  test('review 2：appendPoints 失敗 → 點留在佇列、storage.failing、退避重試成功後補寫，不遺失；結束時仍失敗 → unsavedPoints 與 storage_incomplete', async () => {
    jest.useFakeTimers();
    try {
      const store = new LocalWorkoutStore();
      const real = store.appendPoints.bind(store);
      const append = jest.spyOn(store, 'appendPoints');
      const sync: jest.Mock = jest.fn(async () => ({ sessionId: 'server-1' }));
      const { rec } = mk({ store, sync });
      const meta = await rec.start({ sport: 'run', environment: 'outdoor' });
      // 前兩次寫入失敗（磁碟／加密），第三次起正常
      append.mockRejectedValueOnce(new Error('disk full')).mockRejectedValueOnce(new Error('disk full')).mockImplementation(real);
      rec.ingest(pts(10, 1_000_000));
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      expect(rec.snapshot().storage).toMatchObject({ failing: true, pendingPoints: 10, lastError: 'disk full' });
      expect(rec.snapshot().accepted).toBe(10); // 畫面距離已累加，但 storage 標示未落地
      expect(await store.readPoints(meta.sessionId)).toHaveLength(0);
      // 第一次退避 1 s → 仍失敗 → 2 s → 成功
      await jest.advanceTimersByTimeAsync(1_000);
      expect(rec.snapshot().storage.failing).toBe(true);
      await jest.advanceTimersByTimeAsync(2_000);
      expect(rec.snapshot().storage).toMatchObject({ failing: false, pendingPoints: 0, lastError: null });
      expect((await store.readPoints(meta.sessionId)).map((p) => p.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      // 結束前再進 5 點且寫入一直失敗：finish 重試 3 次後放棄，記入 unsavedPoints，狀態 needs_review，同步旗標 storage_incomplete
      append.mockRejectedValue(new Error('disk full'));
      rec.ingest(pts(5, 1_010_000, 10));
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      const r = await rec.finish();
      expect(r.meta.unsavedPoints).toBe(5);
      expect(r.meta.status).toBe('needs_review');
      expect((sync.mock.calls[0]![0] as { client_flags: string[] }).client_flags).toContain('storage_incomplete');
      expect(rec.snapshot()).toMatchObject({ state: 'idle', storage: { pendingPoints: 0, failing: false } });
    } finally {
      jest.useRealTimers();
    }
  });

  test('實機：開始後一直沒有定位點 → 12 s 重啟背景任務、24 s 開前景備援訂閱；備援點餵入 ingest；有點後不再重啟；finish 移除備援', async () => {
    jest.useFakeTimers();
    try {
      const remove = jest.fn();
      let cb: ((l: { timestamp: number; coords: { latitude: number; longitude: number; accuracy: number; speed: number | null } }) => void) | null = null;
      loc.watchPositionAsync.mockImplementation(async (_o: unknown, fn: typeof cb) => { cb = fn; return { remove }; });
      const { rec } = mk();
      await rec.start({ sport: 'run', environment: 'outdoor' });
      const startCalls = () => loc.startLocationUpdatesAsync.mock.calls.length;
      const stopCalls = () => loc.stopLocationUpdatesAsync.mock.calls.length;
      const s0 = startCalls();
      const p0 = stopCalls();
      expect(rec.snapshot()).toMatchObject({ gpsRestarts: 0, gpsFallback: false });
      await jest.advanceTimersByTimeAsync(12_000);
      expect(rec.snapshot().gpsRestarts).toBe(1);
      expect(stopCalls()).toBe(p0 + 1);
      expect(startCalls()).toBe(s0 + 1);
      expect(loc.watchPositionAsync).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(12_000);
      expect(loc.watchPositionAsync).toHaveBeenCalledTimes(1);
      expect(rec.snapshot()).toMatchObject({ gpsRestarts: 1, gpsFallback: true });
      // 備援訂閱送點 → 進 ingest
      cb!({ timestamp: 1_000_500, coords: { latitude: 25, longitude: 121.5, accuracy: 6, speed: 0 } });
      expect(rec.snapshot().fixes).toBe(1);
      await jest.advanceTimersByTimeAsync(30_000);
      expect(rec.snapshot().gpsRestarts).toBe(1); // 不再重啟
      await rec.finish();
      expect(remove).toHaveBeenCalled();
      expect(rec.snapshot().gpsFallback).toBe(false);
    } finally {
      loc.watchPositionAsync.mockReset();
      loc.watchPositionAsync.mockImplementation(async () => ({ remove: jest.fn() }));
      jest.useRealTimers();
    }
  });

  test('實機：有定位點進來就不重啟（看門狗只在 0 點時動作）', async () => {
    jest.useFakeTimers();
    try {
      const { rec } = mk();
      await rec.start({ sport: 'run', environment: 'outdoor' });
      const s0 = loc.startLocationUpdatesAsync.mock.calls.length;
      rec.ingest(pts(3, 1_000_000));
      await jest.advanceTimersByTimeAsync(30_000);
      expect(rec.snapshot().gpsRestarts).toBe(0);
      expect(loc.startLocationUpdatesAsync.mock.calls.length).toBe(s0);
      expect(loc.watchPositionAsync).not.toHaveBeenCalled();
      await rec.finish();
    } finally {
      jest.useRealTimers();
    }
  });

  test('review 4：finish 期間排隊中的通知更新不會在 stop 之後把定位服務重新叫起來', async () => {
    const { rec, tick: advance } = mk();
    await rec.start({ sport: 'run', environment: 'outdoor' });
    const order: string[] = [];
    // 讓「更新通知」的 start 卡住，模擬與 finish 的 stop 交錯
    let releaseStart: () => void = () => {};
    loc.startLocationUpdatesAsync.mockImplementationOnce(() => new Promise<void>((res) => { releaseStart = () => { order.push('start:done'); res(); }; order.push('start:begin'); }));
    loc.stopLocationUpdatesAsync.mockImplementation(async () => { order.push('stop'); });
    rec.ingest(pts(5, 1_000_000));
    advance(31_000);
    rec.ingest(pts(1, 1_031_000, 5)); // 滿 30 s → 更新通知（會卡住）
    const finishing = rec.finish();
    await tick();
    expect(order).toEqual(['start:begin']); // stop 排在 start 之後，還沒執行
    releaseStart();
    await finishing;
    expect(order).toEqual(['start:begin', 'start:done', 'stop']);
    // 結束後再觸發任何更新：不會呼叫 start
    const calls = loc.startLocationUpdatesAsync.mock.calls.length;
    advance(60_000);
    rec.ingest(pts(1, 1_100_000, 99)); // idle 時忽略
    await tick();
    expect(loc.startLocationUpdatesAsync.mock.calls.length).toBe(calls);
    expect(order.filter((o) => o === 'stop')).toHaveLength(1);
  });

  test('review 4b：結束時已排隊但尚未執行的通知更新，執行時發現 session 已結束 → 跳過，不呼叫 start', async () => {
    const { rec, tick: advance } = mk();
    await rec.start({ sport: 'run', environment: 'outdoor' });
    const startCalls = () => loc.startLocationUpdatesAsync.mock.calls.length;
    let releaseStop: () => void = () => {};
    // 先讓一個 start 卡住（佇列忙碌）
    let releaseFirst: () => void = () => {};
    loc.startLocationUpdatesAsync.mockImplementationOnce(() => new Promise<void>((res) => { releaseFirst = res; }));
    rec.ingest(pts(5, 1_000_000));
    advance(31_000);
    rec.ingest(pts(1, 1_031_000, 5)); // 卡住的 start
    const before = startCalls();
    // 再排一個更新（force）：會在佇列裡等
    await rec.pause();
    // 此時 finish：撤銷 session，stop 也排進佇列
    loc.stopLocationUpdatesAsync.mockImplementationOnce(() => new Promise<void>((res) => { releaseStop = res; }));
    const finishing = rec.finish();
    releaseFirst();
    await tick();
    // pause 排的那次更新在執行時發現 locationSession 已撤銷 → 跳過
    expect(startCalls()).toBe(before);
    releaseStop();
    await finishing;
    expect(startCalls()).toBe(before);
  });

  test('review 6：感測器探測在舊運動結束、新運動開始後才回來 → 結果不落到新 session', async () => {
    let t = 1_000_000;
    let resolveProbe: (v: boolean | null) => void = () => {};
    const probe = jest.fn(() => new Promise<boolean | null>((res) => { resolveProbe = res; }));
    const rec = new WorkoutRecorder({ store: new LocalWorkoutStore(), now: () => t, sync: jest.fn(async () => ({ sessionId: null })), motionProbe: probe, probeIntervalMs: 999_999, monotonic: null });
    await rec.start({ sport: 'run', environment: 'outdoor' });
    rec.ingest(pts(30, 1_000_000));
    t += 30_000;
    const probing = rec.runProbe(); // 開始量測（懸而未決）
    expect(probe).toHaveBeenCalledTimes(1);
    await rec.finish(); // 舊運動結束
    await rec.start({ sport: 'walk', environment: 'outdoor' }); // 新運動
    rec.ingest(pts(30, 1_100_000, 0, 1.2));
    t += 30_000;
    resolveProbe(false); // 舊量測回來：「機身沒有步態」
    await probing;
    // 舊結果不可記到新 session
    expect(rec.snapshot().integrityFlags).toEqual([]);
    const r = await rec.finish();
    expect(r.summary.integrity.motionProbes.total).toBe(0);
  });

  test('review 7：meta.json 以暫存檔原子替換；主檔壞掉退回暫存檔；兩者皆壞 → corrupted() 列出而非無聲消失；schema 不符不當成 meta', async () => {
    const store = new LocalWorkoutStore();
    const { File, Paths } = jest.requireMock('expo-file-system') as typeof import('expo-file-system');
    const meta = await store.create({ sessionId: 's7', sport: 'run', environment: 'outdoor', autoLapMm: null, splitLengthMm: 1_000_000, status: 'recording', startedAtUtc: 1000, startedMonoMs: 1000, processId: 'p1' });
    // 寫完後暫存檔不存在、主檔存在
    expect(new File(Paths.document, 'workouts', 's7', 'meta.json.tmp').exists).toBe(false);
    expect(new File(Paths.document, 'workouts', 's7', 'meta.json').exists).toBe(true);
    // 模擬 move 之前被殺：主檔半截、暫存檔完整 → 讀得到
    new File(Paths.document, 'workouts', 's7', 'meta.json.tmp').write(JSON.stringify({ ...meta, acceptedCount: 42 }));
    new File(Paths.document, 'workouts', 's7', 'meta.json').write('{"sessionId":"s7","sport":"run"');
    expect(store.readMeta('s7')?.acceptedCount).toBe(42);
    expect(store.list().map((m) => m.sessionId)).toEqual(['s7']);
    expect(store.corrupted()).toEqual([]);
    // 兩者皆壞：list 不含、corrupted 列出原因、目錄與點檔仍在
    new File(Paths.document, 'workouts', 's7', 'meta.json.tmp').write('not json');
    expect(store.readMeta('s7')).toBeNull();
    expect(store.list()).toEqual([]);
    expect(store.corrupted()).toEqual([{ sessionId: 's7', reason: expect.stringMatching(/meta: json.*tmp: json/) }]);
    expect(new File(Paths.document, 'workouts', 's7', 'points.log').exists).toBe(true);
    // schema 不符（JSON 合法但缺欄位）→ corrupt: schema
    new File(Paths.document, 'workouts', 's7', 'meta.json').write(JSON.stringify({ sessionId: 's7' }));
    new File(Paths.document, 'workouts', 's7', 'meta.json.tmp').delete();
    expect(store.readMetaResult('s7')).toEqual({ kind: 'corrupt', sessionId: 's7', reason: 'meta: schema' });
    store.delete('s7');
    expect(store.corrupted()).toEqual([]);
  });
});

describe('2026-09-19 第二輪 review：配速一致、暫停不達標、配速過期、自動繼續門檻、finish 重試、進行中 session', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const mk = (over: { sync?: jest.Mock; store?: LocalWorkoutStore } = {}) => {
    let t = 1_000_000;
    const sync = over.sync ?? jest.fn(async () => ({ sessionId: 'server-1' }));
    const store = over.store ?? new LocalWorkoutStore();
    const rec = new WorkoutRecorder({ store, now: () => t, sync, monotonic: null, motionProbe: null });
    return { rec, store, sync, now: () => t, tick: (ms: number) => { t += ms; } };
  };

  test('review 1：摘要同時給運動平均（不含暫停）與全程平均（含暫停）；暫停 5 分鐘時兩者不同，運動平均與記錄頁算法一致', async () => {
    const { rec, tick: advance } = mk();
    await rec.start({ sport: 'run', environment: 'outdoor' });
    rec.ingest(pts(300, 1_000_000)); // 300 s × 3 m/s ≈ 900 m
    advance(300_000);
    await rec.pause();
    advance(300_000); // 暫停 5 分鐘
    await rec.resume();
    rec.ingest(pts(300, 1_600_000, 300)); // 再 900 m
    advance(300_000);
    const snapBefore = rec.snapshot();
    const liveAvg = Math.round(snapBefore.movingMs / 1000 / (snapBefore.distanceMm / 1_000_000)); // 記錄頁算法
    const r = await rec.finish();
    expect(r.summary.pausedMs).toBe(300_000);
    expect(r.summary.movingAvgPaceSPerKm).toBe(liveAvg);
    expect(r.summary.avgPaceSPerKm).toBeGreaterThan(r.summary.movingAvgPaceSPerKm!); // 含暫停一定較慢
    expect(r.summary.avgPaceSPerKm! - r.summary.movingAvgPaceSPerKm!).toBeCloseTo(300 / (r.summary.distanceMm / 1_000_000), -1);
    expect(r.summary.movingAvgSpeedKmh).toBeGreaterThan(r.summary.avgSpeedKmh!);
  });

  test('review 2：時間目標用運動時間——暫停中時間流逝不達標；繼續運動後才達標', async () => {
    const { rec, tick: advance } = mk();
    await rec.start({ sport: 'walk', environment: 'outdoor', goal: { kind: 'time', target: 60, unit: 's', version: 2 } });
    rec.ingest(pts(30, 1_000_000, 0, 1.2));
    advance(30_000);
    expect(rec.snapshot().goalReached).toBe(false);
    await rec.pause();
    advance(120_000); // 休息 2 分鐘：總時間早已超過 60 s
    const paused = rec.snapshot();
    expect(paused.elapsedMs).toBeGreaterThan(60_000);
    expect(paused.movingMs).toBeLessThan(60_000);
    expect(paused.goalReached).toBe(false); // 之前的 bug：這裡會是 true
    await rec.resume();
    rec.ingest(pts(35, 1_150_000, 30, 1.2));
    advance(35_000);
    expect(rec.snapshot().goalReached).toBe(true);
    await rec.finish();
  });

  test('review 3：定位點持續被拒（精度差）超過 10 s → paceStale、速度／配速為 null、距離保留；恢復可用點後再顯示', async () => {
    const { rec, now, tick: advance } = mk();
    await rec.start({ sport: 'run', environment: 'outdoor' });
    // 每秒一個好點、共 20 s（時鐘與點同步推進，才不會被「10 s 無點」判成 searching）
    for (let i = 0; i < 20; i++) { advance(1000); rec.ingest(pts(1, now(), i)); }
    const good = rec.snapshot();
    expect(good.gps).toBe('ok');
    expect(good.currentSpeedMs).not.toBeNull();
    expect(good.paceStale).toBe(false);
    const dist = good.distanceMm;
    // 接下來 15 s 每秒都有點進來，但精度 120 m 全被拒
    for (let i = 0; i < 15; i++) {
      advance(1000);
      rec.ingest([{ ...pts(1, now(), 20 + i)[0]!, accuracyM: 120 }]);
    }
    const stale = rec.snapshot();
    expect(stale.gps).not.toBe('searching'); // 有點進來，不是「搜尋中」
    expect(stale.paceStale).toBe(true);
    expect(stale.currentSpeedMs).toBeNull();
    expect(stale.currentPaceSPerKm).toBeNull();
    expect(stale.distanceMm).toBe(dist); // 距離不動
    expect(stale.accepted).toBe(20);
    // 好點回來：需要重新累積 5 秒窗
    for (let i = 0; i < 6; i++) { advance(1000); rec.ingest(pts(1, now(), 40 + i)); }
    expect(rec.snapshot().paceStale).toBe(false);
    await rec.finish();
  });

  test('review 4：精度 40 m（介於 20～50）的連續移動點也能解除自動暫停；自動暫停／繼續會發事件', async () => {
    const { rec, now, tick: advance } = mk();
    const events: string[] = [];
    rec.onEvent((e) => events.push(e.kind));
    const still = (seq: number, lat: number, acc = 5): RawPoint[] => [{ seq, monotonicMs: now(), utcMs: now(), lat, lon: 121.5, accuracyM: acc }];
    await rec.start({ sport: 'run', environment: 'outdoor', autoPause: true });
    rec.ingest(pts(20, 1_000_000));
    advance(20_000);
    const lat = 25 + (3 * 19) / M_PER_DEG_LAT;
    for (let i = 0; i < 14; i++) { advance(1000); rec.ingest(still(100 + i, lat)); }
    await tick();
    expect(rec.snapshot()).toMatchObject({ state: 'paused', pauseKind: 'auto' });
    expect(events).toContain('auto_pause');
    // 精度 40 m 的兩個連續點各離開 20 m：之前門檻 20 m 會忽略它們、一直停在暫停
    advance(1000); rec.ingest(still(200, lat + 20 / M_PER_DEG_LAT, 40));
    expect(rec.snapshot().state).toBe('paused');
    advance(1000); rec.ingest(still(201, lat + 24 / M_PER_DEG_LAT, 40));
    expect(rec.snapshot().state).toBe('recording');
    expect(events).toContain('auto_resume');
    // 精度 60 m（超過可採用門檻）不算可用點：手動觸發一次自動暫停後，兩個 60 m 的點不會解除
    await rec.pause('auto');
    (rec as unknown as { autoPausedAt: { lat: number; lon: number } }).autoPausedAt = { lat: lat + 24 / M_PER_DEG_LAT, lon: 121.5 };
    advance(1000); rec.ingest(still(300, lat + 60 / M_PER_DEG_LAT, 60));
    advance(1000); rec.ingest(still(301, lat + 65 / M_PER_DEG_LAT, 60));
    expect(rec.snapshot().state).toBe('paused');
    await rec.resume();
    await rec.finish();
  });

  test('review 5：finish 寫入 meta 失敗 → 狀態停在 finishing、finishError、active() 仍在；retryFinish 成功 → idle、本機已保存', async () => {
    const store = new LocalWorkoutStore();
    const write = jest.spyOn(store, 'writeMeta');
    const { rec } = mk({ store });
    const meta = await rec.start({ sport: 'run', environment: 'outdoor' });
    rec.ingest(pts(30, 1_000_000));
    await tick();
    write.mockRejectedValueOnce(new Error('ENOSPC'));
    await expect(rec.finish()).rejects.toThrow(/ENOSPC/);
    const snap = rec.snapshot();
    expect(snap.state).toBe('finishing');
    expect(snap.finishError).toBe('ENOSPC');
    expect(rec.active()).toMatchObject({ sessionId: meta.sessionId, state: 'finishing' });
    expect(store.readMeta(meta.sessionId)?.summary).toBeNull(); // 還沒存進去
    // 不允許在這狀態再 start
    await expect(rec.start({ sport: 'run', environment: 'outdoor' })).rejects.toThrow(/already active/);
    const r = await rec.retryFinish();
    expect(r.meta.summary).toBeTruthy();
    expect(rec.snapshot()).toMatchObject({ state: 'idle', finishError: null });
    expect(store.readMeta(meta.sessionId)?.summary?.distanceMm).toBe(r.summary.distanceMm);
    expect(rec.active()).toBeNull();
    await expect(rec.retryFinish()).rejects.toThrow(/no failed finish/);
  });

  test('review 6：active() 回報進行中 session；markRecoverable 不把它列成可恢復紀錄', async () => {
    const { rec, store } = mk();
    expect(rec.active()).toBeNull();
    const meta = await rec.start({ sport: 'walk', environment: 'outdoor' });
    expect(rec.active()).toEqual({ sessionId: meta.sessionId, state: 'recording', sport: 'walk' });
    expect(store.recoverable().map((m) => m.sessionId)).toContain(meta.sessionId); // store 層面它仍是 recording
    expect((await rec.markRecoverable()).map((m) => m.sessionId)).not.toContain(meta.sessionId); // recorder 層面排除
    expect(store.readMeta(meta.sessionId)?.status).toBe('recording'); // 也沒被改成 recoverable／interrupted
    await rec.pause();
    expect(rec.active()?.state).toBe('paused');
    await rec.finish();
    expect(rec.active()).toBeNull();
  });
});

test('route 外觀保存後跨重啟、同步 metadata 更新不可改寫；新 session 可有不同背景', async () => {
  const store = new LocalWorkoutStore();
  const meta = await store.create({ sessionId: 'frozen-art', sport: 'run', environment: 'outdoor', autoLapMm: null, splitLengthMm: 1000000, status: 'recording', startedAtUtc: 1000, startedMonoMs: 1000, processId: 'p1', routeAppearance: { version: 1, layer: 'ocean' } });
  meta.status = 'saved';
  await store.writeMeta(meta);
  const reopened = new LocalWorkoutStore();
  const changed = reopened.readMeta(meta.sessionId)!;
  changed.routeAppearance = { version: 1, layer: 'snow' };
  changed.syncedSessionId = 'remote-art';
  await reopened.writeMeta(changed);
  expect(reopened.readMeta(meta.sessionId)).toMatchObject({ routeAppearance: { version: 1, layer: 'ocean' }, syncedSessionId: 'remote-art' });
  const second = await store.create({ ...meta, sessionId: 'new-art', routeAppearance: { version: 1, layer: 'mars' } });
  expect(second.routeAppearance?.layer).toBe('mars');
});
