/** PG-LINK-02：上傳佇列——舊到新、單一 worker、隊首失敗擋住後續、退避、手動一次授權、中途關閉不取下一筆、跨錢包隔離、排除、訪客歸屬。 */
import { LocalWorkoutStore, type SessionMeta } from '@/services/workouts/LocalWorkoutStore';
import { backoffMs, WorkoutOutbox } from '@/services/workouts/WorkoutOutbox';
import type { SyncOutcome } from '@/services/workouts/WorkoutRecorder';

const fsMock = jest.requireMock('expo-file-system') as { __reset: () => void };
const A = 'walletA';
const B = 'walletB';

type Fixture = { store: LocalWorkoutStore; sent: string[]; outcomes: Map<string, SyncOutcome[]>; outbox: WorkoutOutbox; auto: Set<string>; owner: { current: string | null }; now: { t: number }; inflight: { n: number; max: number } };
async function fixture(): Promise<Fixture> {
  fsMock.__reset();
  const store = new LocalWorkoutStore();
  const sent: string[] = [];
  const outcomes = new Map<string, SyncOutcome[]>();
  const auto = new Set<string>();
  const owner = { current: A as string | null };
  const now = { t: 1_000_000 };
  const inflight = { n: 0, max: 0 };
  const send = async (meta: SessionMeta): Promise<SyncOutcome> => {
    inflight.n += 1; inflight.max = Math.max(inflight.max, inflight.n);
    await new Promise((r) => setTimeout(r, 1));
    inflight.n -= 1;
    sent.push(meta.sessionId);
    const q = outcomes.get(meta.sessionId);
    const o = q?.shift() ?? { ok: true };
    if (o.ok) { meta.syncedSessionId = `srv-${meta.sessionId}`; await store.writeMeta(meta); }
    return o;
  };
  const outbox = new WorkoutOutbox({ store, send, now: () => now.t, autoEnabled: (o) => !!o && auto.has(o), currentOwner: () => owner.current, online: async () => true });
  return { store, sent, outcomes, outbox, auto, owner, now, inflight };
}
async function mk(store: LocalWorkoutStore, id: string, day: number, owner: string | null, extra: Partial<SessionMeta> = {}) {
  const m = await store.create({ sessionId: id, sport: 'run', environment: 'outdoor', autoLapMm: null, splitLengthMm: 1_000_000, status: 'saved', startedAtUtc: Date.UTC(2026, 8, day, 12), startedMonoMs: 0, processId: 'p', owner, ...extra });
  m.endedAtUtc = m.startedAtUtc + 1_800_000;
  m.summary = { distanceMm: 5_000_000, elapsedMs: 1_800_000 } as never;
  await store.writeMeta(m);
  return m;
}

test('順序：依 startedAtUtc → endedAtUtc → sessionId，與建立順序／顯示順序無關；三筆離線紀錄 17 → 18 → 19 上傳', async () => {
  const f = await fixture();
  await mk(f.store, 's19', 19, A);
  await mk(f.store, 's17', 17, A);
  await mk(f.store, 's18b', 18, A);
  await mk(f.store, 's18a', 18, A); // 同開始／結束時間：以 id 穩定排序
  expect(f.outbox.list(A).map((e) => e.meta.sessionId)).toEqual(['s17', 's18a', 's18b', 's19']);
  const r = await f.outbox.run(A, { manual: true });
  expect(r).toMatchObject({ sent: 4, stoppedAt: null });
  expect(f.sent).toEqual(['s17', 's18a', 's18b', 's19']);
  expect(f.outbox.list(A)).toEqual([]);
  expect(f.inflight.max).toBe(1);
});

test('同一玩家只有一個 worker：同時觸發回同一個 promise；隊首暫時失敗 → 退避、後續暫停不跳過；手動重試從隊首開始', async () => {
  const f = await fixture();
  f.auto.add(A);
  await mk(f.store, 's17', 17, A);
  await mk(f.store, 's18', 18, A);
  f.outcomes.set('s17', [{ ok: false, code: 'NETWORK_ERROR', message: 'offline' }]);
  const p1 = f.outbox.run(A);
  const p2 = f.outbox.run(A);
  expect(p2).toBe(p1);
  const r = await p1;
  expect(r.sent).toBe(0);
  expect(r.stoppedAt).toMatchObject({ sessionId: 's17', outcome: { code: 'NETWORK_ERROR' } });
  expect(f.sent).toEqual(['s17']); // s18 沒送
  const head = f.outbox.list(A)[0]!;
  expect(head).toMatchObject({ status: 'retry_wait', attempt: 1, nextAttemptAt: f.now.t + backoffMs(1) });
  expect(f.outbox.summary(A)).toMatchObject({ pending: 2 });
  // 自動：退避未到 → 不送
  const r2 = await f.outbox.run(A);
  expect(f.sent).toEqual(['s17']);
  expect(r2.stoppedAt?.outcome).toMatchObject({ code: 'NETWORK_ERROR' });
  // 手動一次授權：忽略退避從隊首開始；連線恢復後兩筆都送
  const r3 = await f.outbox.run(A, { manual: true, target: 's18' });
  expect(f.sent).toEqual(['s17', 's17', 's18']);
  expect(r3).toMatchObject({ sent: 2, target: { ok: true } });
  expect(backoffMs(1)).toBe(1_000); expect(backoffMs(3)).toBe(4_000); expect(backoffMs(20)).toBe(300_000);
});

test('隊首需本人處理（未登入／被拒）→ blocked；指定較晚那筆回 BLOCKED_EARLIER；排除後不再阻擋、不計入；取消排除回到隊列', async () => {
  const f = await fixture();
  await mk(f.store, 's17', 17, A);
  await mk(f.store, 's18', 18, A);
  f.outcomes.set('s17', [{ ok: false, code: 'REJECTED', message: 'ended before started' }]);
  const r = await f.outbox.run(A, { manual: true, target: 's18' });
  expect(r.target).toMatchObject({ ok: false, code: 'BLOCKED_EARLIER' });
  expect(f.outbox.list(A)[0]).toMatchObject({ status: 'blocked', attempt: 0, lastError: { code: 'REJECTED' } });
  expect(f.sent).toEqual(['s17']);
  await f.outbox.exclude('s17', 'ended before started');
  expect(f.outbox.list(A).map((e) => [e.meta.sessionId, e.status])).toEqual([['s17', 'excluded'], ['s18', 'queued']]);
  expect(f.store.readMeta('s17')?.status).toBe('needs_review');
  const r2 = await f.outbox.run(A, { manual: true, target: 's18' });
  expect(r2.target).toEqual({ ok: true });
  expect(f.sent).toEqual(['s17', 's18']);
  await f.outbox.unexclude('s17');
  expect(f.outbox.list(A)[0]).toMatchObject({ meta: { sessionId: 's17' }, status: 'queued' });
});

test('自動同步預設關閉：kick 不發請求；開啟後才送；中途關閉 → 已送出的完成、不取下一筆；afterFinish 關閉時回 DISABLED', async () => {
  const f = await fixture();
  await mk(f.store, 's17', 17, A);
  await mk(f.store, 's18', 18, A);
  expect(await f.outbox.kick('startup')).toBeNull();
  expect(f.sent).toEqual([]);
  const m19 = await mk(f.store, 's19', 19, A);
  expect(await f.outbox.afterFinish(m19)).toMatchObject({ ok: false, code: 'DISABLED' });
  expect(f.sent).toEqual([]);
  f.auto.add(A);
  // 送出第一筆時關閉開關 → 第一筆完成、第二筆不送
  const origSet = f.outcomes;
  origSet.set('s17', []);
  const p = f.outbox.kick('toggle');
  await new Promise((r) => setTimeout(r, 0)); // 第一筆已在途
  f.auto.delete(A);
  const r = await p;
  expect(f.sent).toEqual(['s17']);
  expect(r?.stoppedAt).toMatchObject({ sessionId: 's18', outcome: { code: 'DISABLED' } });
  f.auto.add(A);
  const m20 = await mk(f.store, 's20', 20, A);
  expect(await f.outbox.afterFinish(m20)).toEqual({ ok: true });
  expect(f.sent).toEqual(['s17', 's18', 's19', 's20']);
});

test('跨錢包隔離：A 的紀錄不列在 B 的佇列；換錢包後在途 worker 不再用新 session 上傳 A 的紀錄；訪客紀錄需明確歸屬', async () => {
  const f = await fixture();
  await mk(f.store, 'a17', 17, A);
  await mk(f.store, 'a18', 18, A);
  await mk(f.store, 'b17', 17, B);
  await mk(f.store, 'g16', 16, null);
  expect(f.outbox.list(B).map((e) => e.meta.sessionId)).toEqual(['b17']);
  expect(f.outbox.unassigned().map((m) => m.sessionId)).toEqual(['g16']);
  expect(f.outbox.summary(A)).toMatchObject({ pending: 2, unassigned: 1 });
  // A 在送第一筆時換成 B
  const p = f.outbox.run(A, { manual: true });
  f.owner.current = B;
  const r = await p;
  expect(f.sent).toEqual(['a17']);
  expect(r.stoppedAt).toMatchObject({ sessionId: 'a18', outcome: { code: 'NO_SESSION' } });
  // 訪客紀錄歸屬到 B 後進 B 的佇列並排在 b17 前面（更早）
  await f.outbox.assign(['g16'], B);
  expect(f.outbox.list(B).map((e) => e.meta.sessionId)).toEqual(['g16', 'b17']);
  await f.outbox.assign(['g16'], A); // 已歸屬不可再改
  expect(f.store.readMeta('g16')?.owner).toBe(B);
});
