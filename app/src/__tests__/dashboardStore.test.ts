import { PublicKey } from '@solana/web3.js';

import { useDashboardStore, formatTskr, estimateReward } from '@/state/dashboardStore';
import { healthConnect } from '@/services/health/HealthConnectService';

jest.mock('@/services/health/HealthConnectService', () => ({
  healthConnect: { readStepsForTaskDate: jest.fn(), readSleepForTaskDate: jest.fn(), cacheSummary: jest.fn(), readCachedSummary: jest.fn() },
}));
jest.mock('@/services/chain/ClaimSubmitter', () => ({ claimSubmitter: { receiptExists: jest.fn(async () => false) } }));

const hc = healthConnect as jest.Mocked<typeof healthConnect>;
const steps = (total: number) => ({ total, dataOrigins: [], stepRateSummary: { bucketMinutes: 1 as const, buckets: [], observedMinutes: 0, maxStepsPerMinute: 0 }, deviceSpn: null });
const sleep = (minutes: number) => ({ sessions: minutes ? [{ startUnix: 0, endUnix: minutes * 60, minutes, package: 'p', recordingMethod: 'automatic' as const }] : [] });

beforeEach(() => {
  useDashboardStore.setState({ health: null, tasks: { steps: 'not_met', sleep: 'not_met' }, healthSyncing: false });
  jest.clearAllMocks();
});

describe('PG-A-12／A-19 dashboardStore', () => {
  test('前景同步：更新任務狀態並寫入快取', async () => {
    hc.readStepsForTaskDate.mockResolvedValue(steps(8_500));
    hc.readSleepForTaskDate.mockResolvedValue(sleep(300));
    await useDashboardStore.getState().syncHealth();
    const s = useDashboardStore.getState();
    expect(s.health?.source).toBe('foreground');
    expect(s.tasks).toEqual({ steps: 'ready', sleep: 'not_met' });
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
    expect(s.health?.error).toBe('offline');
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
    useDashboardStore.setState({ tasks: { steps: 'claimed', sleep: 'rejected' } });
    const d = useDashboardStore.getState().taskDate;
    expect(useDashboardStore.getState().rollDay(d * 86_400)).toBe(false);
    expect(useDashboardStore.getState().rollDay((d + 1) * 86_400)).toBe(true);
    expect(useDashboardStore.getState().tasks).toEqual({ steps: 'not_met', sleep: 'not_met' });
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
