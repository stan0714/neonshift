import { act, renderHook } from '@testing-library/react-native';

import { BOOTSTRAP_TIMING, runBootstrap, useBootstrap, type BootstrapTask } from '@/bootstrap';

const task = (id: BootstrapTask['id'], run: BootstrapTask['run']): BootstrapTask => ({ id, label: id, run, timeoutMs: 60_000 });
const never = () => new Promise<never>(() => {});

describe('runBootstrap（Style 8.2 載入順序）', () => {
  test('依序執行，單一步驟失敗不中止', async () => {
    const order: string[] = [];
    const res = await runBootstrap(
      [
        task('profile', async (ctx) => { order.push('profile'); ctx.onboardingComplete = true; return { status: 'done' }; }),
        task('health', async () => { order.push('health'); throw new Error('HC unavailable'); }),
        task('wallet', async (ctx) => { order.push('wallet'); ctx.walletConnected = true; return { status: 'done' }; }),
      ],
      () => {},
    );
    expect(order).toEqual(['profile', 'health', 'wallet']);
    expect(res).toMatchObject({ kind: 'ok', route: 'Main' });
  });

  test('onboarding 未完成或 session 不可恢復 → Landing（9.3）', async () => {
    const res = await runBootstrap([task('profile', async (ctx) => { ctx.onboardingComplete = true; return { status: 'done' }; })], () => {});
    expect(res).toMatchObject({ kind: 'ok', route: 'Landing' });
  });

  test('強制更新為 blocked，不偽裝成一般 loading', async () => {
    const res = await runBootstrap(
      [task('network', async () => ({ status: 'blocked', reason: 'forceUpdate', detail: 'v0.1.0 < 0.2.0' }))],
      () => {},
    );
    expect(res).toMatchObject({ kind: 'blocked', reason: 'forceUpdate' });
  });
});

describe('runBootstrap 步驟逾時', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  test('單一步驟超過 timeoutMs 視為 failed，不阻塞啟動', async () => {
    const p = runBootstrap([{ id: 'wallet', label: 'w', run: never, timeoutMs: 1_000 }], () => {});
    await jest.advanceTimersByTimeAsync(1_000);
    const res = await p;
    expect(res).toMatchObject({ kind: 'ok', route: 'Landing' });
  });
});

describe('useBootstrap 時間門檻', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('300ms 內完成不顯示畫面', async () => {
    const tasks = [task('profile', async () => ({ status: 'done' }))];
    const { result } = await renderHook(() => useBootstrap(tasks));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(result.current.phase).toBe('done');
    expect(result.current.result).toMatchObject({ kind: 'ok', route: 'Landing' });
  });

  test('300ms → loading，3s → slow，10s → stalled；有快取才可離線', async () => {
    const tasks = [task('profile', async (ctx) => { ctx.hasCache = true; return { status: 'done' }; }), task('network', never)];
    const { result } = await renderHook(() => useBootstrap(tasks));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.phase).toBe('hidden');

    await act(async () => { jest.advanceTimersByTime(BOOTSTRAP_TIMING.showAfterMs); });
    expect(result.current.phase).toBe('loading');
    expect(result.current.canUseOffline).toBe(false);

    await act(async () => { jest.advanceTimersByTime(BOOTSTRAP_TIMING.slowAfterMs - BOOTSTRAP_TIMING.showAfterMs); });
    expect(result.current.phase).toBe('slow');
    expect(result.current.canUseOffline).toBe(true);
    expect(result.current.steps.map((step) => step.status)).toEqual(['done', 'running']);

    await act(async () => { jest.advanceTimersByTime(BOOTSTRAP_TIMING.stalledAfterMs - BOOTSTRAP_TIMING.slowAfterMs); });
    expect(result.current.phase).toBe('stalled');
    expect(result.current.diagnostics).toEqual([]);
  });

  test('無快取時 stalled 也不提供離線進入', async () => {
    const tasks = [task('network', never)];
    const { result } = await renderHook(() => useBootstrap(tasks));
    await act(async () => { jest.advanceTimersByTime(BOOTSTRAP_TIMING.stalledAfterMs); });
    expect(result.current.phase).toBe('stalled');
    expect(result.current.canUseOffline).toBe(false);
  });

  test('continueOffline 以目前 ctx 決定路由並結束', async () => {
    const tasks = [task('profile', async (ctx) => { ctx.hasCache = true; return { status: 'done' }; }), task('network', never)];
    const { result } = await renderHook(() => useBootstrap(tasks));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { jest.advanceTimersByTime(BOOTSTRAP_TIMING.slowAfterMs); });
    await act(async () => result.current.continueOffline());
    expect(result.current.phase).toBe('done');
    expect(result.current.result).toMatchObject({ kind: 'ok', route: 'Landing' });
  });

  test('retry 重新開始並重設步驟', async () => {
    let calls = 0;
    const tasks = [task('network', async () => { calls += 1; return calls === 1 ? never() : { status: 'done' }; })];
    const { result } = await renderHook(() => useBootstrap(tasks));
    await act(async () => { jest.advanceTimersByTime(BOOTSTRAP_TIMING.stalledAfterMs); });
    expect(result.current.phase).toBe('stalled');
    await act(async () => { result.current.retry(); await Promise.resolve(); await Promise.resolve(); });
    expect(calls).toBe(2);
    expect(result.current.phase).toBe('done');
  });
});
