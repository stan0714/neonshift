import { NativeModule, requireNativeModule } from 'expo';

import type { LiveMotionOptions, LiveMotionProgress, LiveMotionSummary, SensorCapabilities } from './NeonshiftSensors.types';

type Events = { onLiveMotionProgress: (p: LiveMotionProgress) => void };

declare class NeonshiftSensorsModule extends NativeModule<Events> {
  getCapabilities(): Promise<SensorCapabilities>;
  startLiveMotionCheck(options: LiveMotionOptions): Promise<LiveMotionSummary>;
  cancelLiveMotionCheck(): Promise<void>;
}

export default requireNativeModule<NeonshiftSensorsModule>('NeonshiftSensors');
