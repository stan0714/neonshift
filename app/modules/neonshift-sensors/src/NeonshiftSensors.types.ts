/** 與 Kotlin NeonshiftSensorsModule 對應（PG-A-05，SD 4.3 sensor_summary）。 */

export type SensorCapabilities = {
  accelerometer: boolean;
  linearAcceleration: boolean;
  gyroscope: boolean;
  stepCounter: boolean;
};

export type LiveMotionOptions = {
  durationSeconds?: number;
  windowSeconds?: number;
  sampleRateHz?: number;
};

export type LiveMotionProgress = {
  elapsedSeconds: number;
  durationSeconds: number;
  windowIndex: number;
  windowCount: number;
};

export type LiveMotionWindow = {
  samples: number;
  seconds: number;
  dominantFreqHz: number;
  accelRms: number;
};

/** 只有統計摘要，沒有原始序列（BR-09） */
export type LiveMotionSummary = {
  sampleRateHz: number;
  windowCount: number;
  windowSeconds: number;
  stepDelta: number;
  stepCounterAvailable: boolean;
  dominantFreqHz: number;
  freqVariance: number;
  accelRms: number;
  gyroRms: number;
  zeroCrossingRate: number;
  accelSource: 'linear_acceleration' | 'accelerometer';
  windows: LiveMotionWindow[];
};
