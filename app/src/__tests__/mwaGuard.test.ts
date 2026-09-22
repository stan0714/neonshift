/** COMP-W01：MWA 守門——回前景寬限、硬逾時、正常完成、再切去錢包取消寬限、晚到結果丟棄、stale 標記 */
import { _resetStaleForTests, guardWalletOp, NATIVE_CLIENT_TIMEOUT_MS, staleUntil } from '@/services/wallet/mwaGuard';

type Listener = (s: 'active' | 'background' | 'inactive') => void;
const fakeAppState = () => {
  const listeners = new Set<Listener>();
  return {
    currentState: 'active' as const,
    addEventListener: (_: 'change', l: Listener) => { listeners.add(l); return { remove: () => listeners.delete(l) }; },
    emit: (s: 'active' | 'background' | 'inactive') => listeners.forEach((l) => l(s)),
    size: () => listeners.size,
  };
};

beforeEach(() => { jest.useFakeTimers(); _resetStaleForTests(); });
afterEach(() => { jest.useRealTimers(); });

test('正常完成：回傳結果、移除監聽、不標 stale', async () => {
  const app = fakeAppState();
  let resolveOp!: (v: string) => void;
  const p = guardWalletOp(() => new Promise<string>((r) => { resolveOp = r; }), { appState: app });
  app.emit('background'); app.emit('active');
  resolveOp('sig');
  await expect(p).resolves.toBe('sig');
  expect(app.size()).toBe(0);
  expect(staleUntil()).toBe(0);
});

test('回前景後寬限內無回覆 → WALLET_NO_REPLY，標記 stale 90 s；晚到的結果被丟棄', async () => {
  const app = fakeAppState();
  let resolveOp!: (v: string) => void;
  const p = guardWalletOp(() => new Promise<string>((r) => { resolveOp = r; }), { appState: app, foregroundGraceMs: 8_000, now: () => 1_000_000 });
  app.emit('background');
  app.emit('active');
  jest.advanceTimersByTime(7_999);
  let state = 'pending';
  void p.then(() => { state = 'resolved'; }, () => { state = 'rejected'; });
  await Promise.resolve();
  expect(state).toBe('pending'); // 7.999 s 仍在等
  jest.advanceTimersByTime(1);
  await expect(p).rejects.toMatchObject({ code: 'WALLET_NO_REPLY' });
  expect(staleUntil(1_000_000)).toBe(1_000_000 + NATIVE_CLIENT_TIMEOUT_MS);
  resolveOp('late'); // 晚到：不影響已 reject 的 promise，也不清 stale
  await Promise.resolve(); await Promise.resolve();
  expect(state).toBe('rejected');
  expect(staleUntil(1_000_000)).toBe(1_000_000 + NATIVE_CLIENT_TIMEOUT_MS);
  expect(app.size()).toBe(0);
});

test('回前景又切回錢包（使用者手動回去核准）→ 取消寬限；之後回覆仍成功', async () => {
  const app = fakeAppState();
  let resolveOp!: (v: string) => void;
  const p = guardWalletOp(() => new Promise<string>((r) => { resolveOp = r; }), { appState: app, foregroundGraceMs: 8_000 });
  app.emit('active');
  jest.advanceTimersByTime(5_000);
  app.emit('background'); // 又去錢包
  jest.advanceTimersByTime(20_000); // 超過原寬限
  resolveOp('ok');
  await expect(p).resolves.toBe('ok');
});

test('硬逾時：完全沒有前景事件也會在上限後結束', async () => {
  const app = fakeAppState();
  const p = guardWalletOp(() => new Promise<string>(() => {}), { appState: app, hardTimeoutMs: 120_000 });
  jest.advanceTimersByTime(120_000);
  await expect(p).rejects.toMatchObject({ code: 'WALLET_NO_REPLY' });
});

test('op 自己失敗：原錯誤透傳、不標 stale', async () => {
  const app = fakeAppState();
  await expect(guardWalletOp(() => Promise.reject(new Error('boom')), { appState: app })).rejects.toThrow('boom');
  expect(staleUntil()).toBe(0);
});
