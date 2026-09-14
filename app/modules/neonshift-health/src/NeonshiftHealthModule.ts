import { NativeModule, requireNativeModule } from 'expo';

import type { HealthStatus, SleepResult, StepsResult } from './NeonshiftHealth.types';

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
}

export default requireNativeModule<NeonshiftHealthModule>('NeonshiftHealth');
