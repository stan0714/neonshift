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
    const rec = new WorkoutRecorder({ store, now, sync });
    return { rec, store, sync, tick: (ms: number) => { t += ms; } };
  };

  test('start：前景服務定位；同時只允許一個；室內拒絕；點先落地再餵引擎；Lap／Pause／Resume；finish 先保存摘要再同步（origin gps、無座標）', async () => {
    const { rec, store, sync, tick } = mk();
    await expect(rec.start({ sport: 'run', environment: 'indoor' })).rejects.toThrow(/indoor/);
    const meta = await rec.start({ sport: 'run', environment: 'outdoor' });
    expect(loc.startLocationUpdatesAsync).toHaveBeenCalledWith('neonshift-workout-location', expect.objectContaining({ foregroundService: expect.objectContaining({ notificationTitle: expect.any(String) }) }));
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
    expect(await rec.syncMeta(store.readMeta(meta.sessionId)!)).toBe(true);
    expect((sync.mock.calls[1]![0] as { client_flags: string[] }).client_flags).toContain('gps_gap');
  });

  test('恢復：另一個 process 的未結束 session 標 recoverable／interrupted，continue 被拒改為結束（以最後一點時間、不補負時間）；discard 清除路線', async () => {
    const storeA = new LocalWorkoutStore();
    const recA = new WorkoutRecorder({ store: storeA, now: () => 1_000_000, sync: jest.fn(async () => ({ sessionId: null })) });
    const meta = await recA.start({ sport: 'run', environment: 'outdoor' });
    recA.ingest(pts(120, 1_000_000)); // 360 m
    await new Promise((r) => setTimeout(r, 0));
    // 新 process
    const storeB = new LocalWorkoutStore();
    const sync: jest.Mock = jest.fn(async () => ({ sessionId: 'server-3' }));
    const recB = new WorkoutRecorder({ store: storeB, now: () => 2_000_000, sync });
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
    const recA = new WorkoutRecorder({ store: storeA, now: () => 1_000_000, sync: jest.fn(async () => ({ sessionId: null })) });
    const meta = await recA.start({ sport: 'run', environment: 'outdoor', trackLapMm: 400_000 });
    expect(storeA.readMeta(meta.sessionId)?.trackLapMm).toBe(400_000);
    recA.ingest(pts(200, 1_000_000)); // ≈ 600 m
    expect(recA.snapshot().trackEquivalent).toMatchObject({ laps: 1, lapMm: 400_000 });
    await new Promise((r) => setTimeout(r, 0));
    const sync: jest.Mock = jest.fn(async () => ({ sessionId: 'server-7' }));
    const recB = new WorkoutRecorder({ store: new LocalWorkoutStore(), now: () => 2_000_000, sync });
    await recB.markRecoverable();
    const c = await recB.recover(meta.sessionId, 'continue');
    expect(c.summary!.trackEquivalent).toMatchObject({ laps: 1, lapMm: 400_000 });
    expect((sync.mock.calls[0]![0] as { extras: { track_equivalent: unknown } }).extras.track_equivalent).toMatchObject({ laps: 1, lapMm: 400_000 });
    // 未啟用
    const recC = new WorkoutRecorder({ store: new LocalWorkoutStore(), now: () => 3_000_000, sync: jest.fn(async () => ({ sessionId: null })) });
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
});
