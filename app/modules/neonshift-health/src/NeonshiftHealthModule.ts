import { NativeModule, requireNativeModule } from 'expo';

import type { CachedHealthSummary, HealthStatus, SleepResult, StepsResult } from './NeonshiftHealth.types';

declare class NeonshiftHealthModule extends NativeModule {
  PERMISSION_READ_STEPS: string;
  PERMISSION_READ_SLEEP: string;
  PERMISSION_READ_BACKGROUND: string;
  LEGACY_DEVICE_ORIGIN: string;
  getStatus(): Promise<HealthStatus>;
  getGrantedPermissions(): Promise<string[]>;
  requestPermissions(permissions: string[]): Promise<string[]>;
  openSettings(): Promise<void>;
  readSteps(startUnix: number, endUnix: number): Promise<StepsResult>;
  readSleepSessions(startUnix: number, endUnix: number): Promise<SleepResult>;
  scheduleBackgroundSync(intervalMinutes: number): Promise<{ scheduled: boolean; intervalMinutes: number }>;
  cancelBackgroundSync(): Promise<void>;
  runBackgroundSyncNow(): Promise<void>;
  getCachedSummary(): Promise<CachedHealthSummary | null>;
  setCachedSummary(json: string): Promise<void>;
  clearCache(): Promise<void>;
}

export default requireNativeModule<NeonshiftHealthModule>('NeonshiftHealth');
