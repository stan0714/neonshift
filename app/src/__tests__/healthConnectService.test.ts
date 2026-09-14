jest.mock('../../modules/neonshift-health', () => ({
  NeonshiftHealth: {
    PERMISSION_READ_STEPS: 'android.permission.health.READ_STEPS',
    PERMISSION_READ_SLEEP: 'android.permission.health.READ_SLEEP',
    PERMISSION_READ_BACKGROUND: 'android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND',
    LEGACY_DEVICE_ORIGIN: 'android',
    getStatus: jest.fn(),
    getGrantedPermissions: jest.fn(),
    requestPermissions: jest.fn(),
    openSettings: jest.fn(),
    readSteps: jest.fn(),
    readSleepSessions: jest.fn(),
  },
}));

import { NeonshiftHealth } from '../../modules/neonshift-health';
import { HealthError, healthConnect, summarizePermissions, taskDateOf, taskDateRange } from '@/services/health/HealthConnectService';

const native = NeonshiftHealth as jest.Mocked<typeof NeonshiftHealth>;

describe('UTC 任務日（BR-05）', () => {
  test('taskDateOf 與 SD 3.5 一致：floor(unix / 86400)', () => {
    expect(taskDateOf(1_789_000_000)).toBe(20_706);
    expect(taskDateOf(20_706 * 86_400)).toBe(20_706);
    expect(taskDateOf(20_707 * 86_400 - 1)).toBe(20_706);
  });
  test('taskDateRange 為半開區間', () => {
    expect(taskDateRange(20_706)).toEqual({ startUnix: 20_706 * 86_400, endUnix: 20_707 * 86_400 });
  });
});

describe('權限整理（FR-02.5）', () => {
  test('granted／partial／denied 與背景旗標', () => {
    expect(summarizePermissions([]).state).toBe('denied');
    expect(summarizePermissions(['android.permission.health.READ_STEPS']).state).toBe('partial');
    const s = summarizePermissions(['android.permission.health.READ_STEPS', 'android.permission.health.READ_SLEEP']);
    expect(s.state).toBe('granted');
    expect(s.backgroundGranted).toBe(false);
    expect(s.missing).toEqual([]);
  });
});

describe('assertUsable 降級提示', () => {
  const base = { osApi: 36, sdkExtension: 20, spnQuerySupported: false, deviceStepsSupported: true, deviceSpn: null, deviceModel: 'Seeker' };
  test('update_required／unavailable／extension 不足各自對應錯誤碼', async () => {
    native.getStatus.mockResolvedValueOnce({ ...base, availability: 'update_required' });
    await expect(healthConnect.assertUsable()).rejects.toMatchObject({ code: 'HC_UPDATE_REQUIRED' });
    native.getStatus.mockResolvedValueOnce({ ...base, availability: 'unavailable' });
    await expect(healthConnect.assertUsable()).rejects.toMatchObject({ code: 'HC_UNAVAILABLE' });
    native.getStatus.mockResolvedValueOnce({ ...base, availability: 'available', deviceStepsSupported: false });
    await expect(healthConnect.assertUsable()).rejects.toMatchObject({ code: 'HC_UNSUPPORTED_DEVICE' });
    native.getStatus.mockResolvedValueOnce({ ...base, availability: 'available' });
    await expect(healthConnect.assertUsable()).resolves.toMatchObject({ availability: 'available' });
  });
});

describe('讀取', () => {
  test('readStepsForTaskDate 以任務日區間呼叫原生並回傳摘要', async () => {
    native.readSteps.mockResolvedValueOnce({
      total: 9420,
      dataOrigins: [
        { package: 'android', sourceKind: 'android_legacy', steps: 9420, records: 40 },
        { package: 'com.example.fit', sourceKind: 'third_party', steps: 3000, records: 2 },
      ],
      stepRateSummary: { observedMinutes: 720, maxStepsPerMinute: 142 },
      deviceSpn: null,
    });
    const r = await healthConnect.readStepsForTaskDate(20_706);
    expect(native.readSteps).toHaveBeenCalledWith(20_706 * 86_400, 20_707 * 86_400);
    expect(r.total).toBe(9420);
    expect(r.dataOrigins.filter((o) => o.sourceKind === 'third_party')).toHaveLength(1);
  });

  test('原生 SecurityException 映射為 HC_PERMISSION_DENIED', async () => {
    native.readSteps.mockRejectedValueOnce(new Error('java.lang.SecurityException: Caller lacks permission'));
    await expect(healthConnect.readStepsForTaskDate(1)).rejects.toMatchObject({ code: 'HC_PERMISSION_DENIED' });
    native.readSteps.mockRejectedValueOnce(new Error('RemoteException'));
    const err = await healthConnect.readStepsForTaskDate(1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HealthError);
    expect((err as HealthError).code).toBe('HC_READ_FAILED');
  });
});
