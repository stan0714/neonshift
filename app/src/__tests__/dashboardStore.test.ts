import { PublicKey } from '@solana/web3.js';

import { useDashboardStore, formatTskr, estimateReward, workoutEvidenceFor, workoutProgress, demoProfile } from '@/state/dashboardStore';
import { healthConnect } from '@/services/health/HealthConnectService';

jest.mock('@/services/health/HealthConnectService', () => ({
  healthConnect: { readStepsForTaskDate: jest.fn(), readSleepForTaskDate: jest.fn(), cacheSummary: jest.fn(), readCachedSummary: jest.fn() },
}));
jest.mock('@/config/features', () => ({ FEATURES: { sleep: false, demoLevel: 0 } }));
jest.mock('@/services/chain/ClaimSubmitter', () => ({ claimSubmitter: { receiptExists: jest.fn(async () => false) } }));

const hc = healthConnect as jest.Mocked<typeof healthConnect>;
const steps = (total: number) => ({ total, dataOrigins: [], stepRateSummary: { bucketMinutes: 1 as const, buckets: [], observedMinutes: 0, maxStepsPerMinute: 0 }, deviceSpn: null });
const sleep = (minutes: number) => ({ sessions: minutes ? [{ startUnix: 0, endUnix: minutes * 60, minutes, package: 'p', recordingMethod: 'automatic' as const }] : [] });

beforeEach(() => {
  useDashboardStore.setState({ health: null, tasks: { steps: 'not_met', sleep: 'not_met', workout: 'not_met' }, healthSyncing: false });
  jest.clearAllMocks();
});

describe('PG-A-12／A-19 dashboardStore', () => {
  test('前景同步：更新任務狀態並寫入快取', async () => {
    hc.readStepsForTaskDate.mockResolvedValue(steps(8_500));
    hc.readSleepForTaskDate.mockResolvedValue(sleep(300));
    await useDashboardStore.getState().syncHealth();
    const s = useDashboardStore.getState();
    expect(s.health?.source).toBe('foreground');
    expect(s.tasks).toEqual({ steps: 'ready', sleep: 'not_met', workout: 'not_met' });
    expect(hc.cacheSummary).toHaveBeenCalledWith(expect.objectContaining({ source: 'foreground', taskDate: s.taskDate }));
  });

  test('離線：讀取失敗保留前值並標記錯誤', async () => {
    hc.readStepsForTaskDate.mockResolvedValueOnce(steps(1_000));
    hc.readSleepForTaskDate.mockResolvedValueOnce(sleep(0));
    await useDashboardStore.getState().syncHealth();
    hc.readStepsForTaskDate.mockRejectedValueOnce(new Error('offline'));
    hc.readSleepForTaskDate.mockRejectedValueOnce(new Error('offline'));
    await useDashboardStore.getState().syncHealth();
    const s = useDashboardStore.getState();
    expect(s.health?.steps?.total).toBe(1_000);
    // 2026-09-29：error 從原始字串改成分類（原始訊息不再進使用者文案，但要保留供診斷）
    expect(s.health?.error?.reason).toBe('unknown');
    expect(s.health?.error?.detail).toBe('offline');
    expect(s.health?.error?.ref).toBe('offline · healthRead');
  });

  test('快取：同任務日且較新才採用；換日不採用', async () => {
    const taskDate = useDashboardStore.getState().taskDate;
    hc.readCachedSummary.mockResolvedValueOnce({ taskDate, steps: steps(9_000), sleep: sleep(0), syncedAt: 5, source: 'background' });
    expect(await useDashboardStore.getState().loadCachedHealth()).toBe(true);
    expect(useDashboardStore.getState().health?.source).toBe('cache');
    expect(useDashboardStore.getState().tasks.steps).toBe('ready');
    hc.readCachedSummary.mockResolvedValueOnce({ taskDate: taskDate - 1, steps: steps(9_000), sleep: sleep(0), syncedAt: 99, source: 'background' });
    expect(await useDashboardStore.getState().loadCachedHealth()).toBe(false);
  });

  test('UTC 換日重置任務狀態', () => {
    useDashboardStore.setState({ tasks: { steps: 'claimed', sleep: 'rejected', workout: 'not_met' } });
    const d = useDashboardStore.getState().taskDate;
    expect(useDashboardStore.getState().rollDay(d * 86_400)).toBe(false);
    expect(useDashboardStore.getState().rollDay((d + 1) * 86_400)).toBe(true);
    expect(useDashboardStore.getState().tasks).toEqual({ steps: 'not_met', sleep: 'not_met', workout: 'not_met' });
  });

  test('tSKR 格式與獎勵預估', () => {
    expect(formatTskr(10_000_000n)).toBe('10');
    expect(formatTskr(12_500_000n)).toBe('12.5');
    expect(formatTskr(null)).toBe('—');
    const cfg = { clusterId: 1, attestorPubkey: new Uint8Array(32), mint: PublicKey.unique(), rewardVault: PublicKey.unique(), dailyCap: 40_000_000n, baseStepsReward: 10_000_000n, baseSleepReward: 5_000_000n, coreMultiplierBps: [10_000, 12_000, 15_000, 18_000, 22_000], shoeXpThresholds: [], paused: false };
    expect(estimateReward(cfg, null, 'steps')).toBe(10_000_000n);
    expect(estimateReward(cfg, { coreLevel: 3 } as never, 'sleep')).toBe(7_500_000n);
  });
});

test('睡眠停用不讀取、不接受舊快取睡眠進度，步數同步照常', async () => {
  hc.readStepsForTaskDate.mockResolvedValue(steps(8_500));
  await useDashboardStore.getState().syncHealth();
  expect(hc.readSleepForTaskDate).not.toHaveBeenCalled();
  expect(useDashboardStore.getState().health?.sleep).toBeNull();
  expect(useDashboardStore.getState().tasks.steps).toBe('ready');
  expect(hc.cacheSummary).toHaveBeenCalledWith(expect.objectContaining({ sleep: { sessions: [] } }));
  useDashboardStore.setState({ health: null });
  hc.readCachedSummary.mockResolvedValueOnce({ taskDate: useDashboardStore.getState().taskDate, steps: steps(9_000), sleep: sleep(480), syncedAt: 5, source: 'background' });
  await useDashboardStore.getState().loadCachedHealth();
  expect(useDashboardStore.getState().health?.sleep).toBeNull();
  expect(useDashboardStore.getState().tasks.sleep).toBe('not_met');
});

test('維持規則 v2 運動任務：同 UTC 日、非刪除、已同步且 saved 的最長紀錄為證據；未同步／待審／移動不足 10 分不達標；進度以公尺計、門檻 1,000 m', () => {
  const day = 20_710;
  const at = (h: number) => day * 86_400_000 + h * 3_600_000;
  const mk = (sessionId: string, o: Record<string, unknown>) => ({ sessionId, startedAtUtc: at(8), status: 'saved', syncedSessionId: 'srv-' + sessionId, summary: { distanceMm: 3_000_000, movingMs: 1_200_000 }, ...o });
  expect(workoutEvidenceFor([], day)).toBeNull();
  const sessions = [
    mk('a', { summary: { distanceMm: 1_500_000, movingMs: 700_000 } }),
    mk('b', {}), // 3 km 已同步 → 證據
    mk('c', { summary: { distanceMm: 9_000_000, movingMs: 3_000_000 }, syncedSessionId: null }), // 更長但未同步
    mk('d', { status: 'needs_review', summary: { distanceMm: 8_000_000, movingMs: 3_000_000 } }),
    mk('e', { startedAtUtc: at(-2) }), // 前一天
    mk('f', { deletedAt: 1 }),
  ];
  const ev = workoutEvidenceFor(sessions, day)!;
  expect(ev).toMatchObject({ localId: 'b', serverId: 'srv-b', distanceM: 3000, synced: true, underReview: false });
  expect(workoutProgress(ev)).toMatchObject({ type: 'workout', value: 3000, goal: 1000, met: true });
  // 只有未同步 → 證據為該筆但進度 0
  const only = workoutEvidenceFor([sessions[2]!], day)!;
  expect(only).toMatchObject({ localId: 'c', synced: false });
  expect(workoutProgress(only).met).toBe(false);
  // 已同步但移動不到 10 分鐘 → 不達標
  expect(workoutProgress(workoutEvidenceFor([mk('g', { summary: { distanceMm: 2_000_000, movingMs: 300_000 } })], day)).met).toBe(false);
});

test('展示版覆寫（FEATURES.demoLevel）：關閉時 profile 原樣；開啟時鞋階／最高階／XP 顯示為指定值，沒有 profile 也造一個（純顯示）', () => {
  const wallet = new PublicKey('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
  const cfg = { shoeXpThresholds: [0n, 450n, 1500n, 3600n, 7500n] } as never;
  const real = { wallet, coreLevel: 1, shoeLevel: 1, xp: 120n, lastTaskDate: 0, streakDays: 2, maxStreakDays: 2, claimedToday: 0n, todayDate: 0, migrated: true, highestLevel: 1, epochAnchor: 0, lastSettledEpoch: 0, epochPoints: 100, epochBitmap: 1, maintenanceRulesVersion: 2 };
  expect(demoProfile(real, wallet, cfg)).toBe(real); // 預設 demoLevel=0
  const features = jest.requireMock('@/config/features') as { FEATURES: { demoLevel: number } };
  features.FEATURES.demoLevel = 3;
  expect(demoProfile(real, wallet, cfg)).toMatchObject({ coreLevel: 3, shoeLevel: 3, highestLevel: 3, xp: 1500n, streakDays: 2, epochPoints: 100 });
  expect(demoProfile(null, wallet, cfg)).toMatchObject({ coreLevel: 3, highestLevel: 3, xp: 1500n, migrated: true });
  features.FEATURES.demoLevel = 0;
});
