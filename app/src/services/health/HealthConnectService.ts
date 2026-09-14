/**
 * HealthConnectModule 的 JS 門面（PG-A-04）。
 * 只做：UTC 任務日區間換算、權限狀態整理、錯誤分類。達標判定在 TaskEngine（PG-A-08）。
 */
import { NeonshiftHealth, type CachedHealthSummary, type HealthStatus, type SleepResult, type StepsResult } from '../../../modules/neonshift-health';

export const SECONDS_PER_DAY = 86_400;

/** BR-05：任務日 = floor(unix / 86400) */
export function taskDateOf(unixSeconds: number): number {
  return Math.floor(unixSeconds / SECONDS_PER_DAY);
}

/** 任務日的 UTC 區間 [start, end) */
export function taskDateRange(taskDate: number): { startUnix: number; endUnix: number } {
  return { startUnix: taskDate * SECONDS_PER_DAY, endUnix: (taskDate + 1) * SECONDS_PER_DAY };
}

export type PermissionState = 'granted' | 'partial' | 'denied';

export type HealthPermissionSummary = {
  state: PermissionState;
  granted: string[];
  missing: string[];
  /** 背景讀取為 S 級，缺少不影響前景打卡 */
  backgroundGranted: boolean;
};

export const REQUIRED_PERMISSIONS = () => [NeonshiftHealth.PERMISSION_READ_STEPS, NeonshiftHealth.PERMISSION_READ_SLEEP];
export const OPTIONAL_PERMISSIONS = () => [NeonshiftHealth.PERMISSION_READ_BACKGROUND];

export function summarizePermissions(granted: string[]): HealthPermissionSummary {
  const required = REQUIRED_PERMISSIONS();
  const missing = required.filter((p) => !granted.includes(p));
  const state: PermissionState = missing.length === 0 ? 'granted' : missing.length === required.length ? 'denied' : 'partial';
  return { state, granted, missing, backgroundGranted: granted.includes(NeonshiftHealth.PERMISSION_READ_BACKGROUND) };
}

export type HealthErrorCode = 'HC_UNAVAILABLE' | 'HC_UPDATE_REQUIRED' | 'HC_PERMISSION_DENIED' | 'HC_UNSUPPORTED_DEVICE' | 'HC_READ_FAILED';

export class HealthError extends Error {
  constructor(
    public readonly code: HealthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'HealthError';
  }
}

export const healthConnect = {
  getStatus: (): Promise<HealthStatus> => NeonshiftHealth.getStatus(),

  /** 啟動時檢查（SD 5.1）：不可用／需更新／不支援內建計步各自回可辨識錯誤，供 UI 給降級提示 */
  async assertUsable(): Promise<HealthStatus> {
    const status = await NeonshiftHealth.getStatus();
    if (status.availability === 'update_required') throw new HealthError('HC_UPDATE_REQUIRED', 'Health Connect needs an update');
    if (status.availability !== 'available') throw new HealthError('HC_UNAVAILABLE', 'Health Connect is not available on this device');
    if (!status.deviceStepsSupported) throw new HealthError('HC_UNSUPPORTED_DEVICE', 'Device-recorded steps require a newer Health Connect (SDK extension 20)');
    return status;
  },

  async getPermissions(): Promise<HealthPermissionSummary> {
    return summarizePermissions(await NeonshiftHealth.getGrantedPermissions());
  },

  /** 只請求必要權限；背景權限由 PG-A-19 在需要時另行請求（BRD 6.1 分階段說明） */
  async requestRequiredPermissions(): Promise<HealthPermissionSummary> {
    const granted = await NeonshiftHealth.requestPermissions(REQUIRED_PERMISSIONS());
    return summarizePermissions(granted);
  },

  async requestBackgroundPermission(): Promise<HealthPermissionSummary> {
    const granted = await NeonshiftHealth.requestPermissions([...REQUIRED_PERMISSIONS(), ...OPTIONAL_PERMISSIONS()]);
    return summarizePermissions(granted);
  },

  openSettings: (): Promise<void> => NeonshiftHealth.openSettings(),

  /** 任務日步數（只含可歸因來源）與速率摘要 */
  async readStepsForTaskDate(taskDate: number): Promise<StepsResult> {
    const { startUnix, endUnix } = taskDateRange(taskDate);
    try {
      return await NeonshiftHealth.readSteps(startUnix, endUnix);
    } catch (e) {
      throw mapNativeError(e);
    }
  },

  // ---- PG-A-19：背景同步（FR-02.3，S 級）與快取 ----

  /** 15 分鐘（WorkManager 下限）；需 READ_HEALTH_DATA_IN_BACKGROUND，未授權時工作會靜默結束 */
  async enableBackgroundSync(intervalMinutes = 15): Promise<boolean> {
    try {
      const r = await NeonshiftHealth.scheduleBackgroundSync(intervalMinutes);
      return r.scheduled;
    } catch {
      return false;
    }
  },
  disableBackgroundSync: (): Promise<void> => NeonshiftHealth.cancelBackgroundSync(),

  /** 前景同步結果寫入共用快取（供離線／下次啟動先顯示） */
  async cacheSummary(summary: CachedHealthSummary): Promise<void> {
    try {
      await NeonshiftHealth.setCachedSummary(JSON.stringify(summary));
    } catch {
      // 快取失敗不影響主流程
    }
  },
  async readCachedSummary(): Promise<CachedHealthSummary | null> {
    try {
      return await NeonshiftHealth.getCachedSummary();
    } catch {
      return null;
    }
  },
  clearCache: (): Promise<void> => NeonshiftHealth.clearCache(),

  /** 結束時間落在任務日內的睡眠 session（BR-05） */
  async readSleepForTaskDate(taskDate: number): Promise<SleepResult> {
    const { startUnix, endUnix } = taskDateRange(taskDate);
    try {
      return await NeonshiftHealth.readSleepSessions(startUnix, endUnix);
    } catch (e) {
      throw mapNativeError(e);
    }
  },
};

function mapNativeError(e: unknown): HealthError {
  const msg = e instanceof Error ? e.message : String(e);
  if (/SecurityException|permission/i.test(msg)) return new HealthError('HC_PERMISSION_DENIED', msg);
  return new HealthError('HC_READ_FAILED', msg);
}
