/**
 * SensorModule 的 JS 門面（PG-A-05）。負責：啟動 20 秒引導式取樣、進度訂閱、
 * 轉成 SD 4.3 的 `sensor_summary` 欄位。不做風險判定（後端 PG-B-08／09）。
 */
import { NeonshiftSensors, type LiveMotionOptions, type LiveMotionProgress, type LiveMotionSummary } from '../../../modules/neonshift-sensors';

/** SD 5.1：前景 50 Hz、20 秒、兩個 10 秒視窗 */
export const LIVE_MOTION_DEFAULTS = { durationSeconds: 20, windowSeconds: 10, sampleRateHz: 50 } as const;

/** SD 4.3 request.sensor_summary */
export type SensorSummaryPayload = {
  sample_rate_hz: number;
  window_count: number;
  window_seconds: number;
  step_delta: number;
  dominant_freq_hz: number;
  freq_variance: number;
  accel_rms: number;
  gyro_rms: number;
  zero_crossing_rate: number;
};

export type LiveMotionErrorCode = 'NO_SENSOR' | 'SENSOR_BUSY' | 'CANCELLED' | 'SENSOR_FAILED';

export class LiveMotionError extends Error {
  constructor(
    public readonly code: LiveMotionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LiveMotionError';
  }
}

const round = (v: number, digits: number) => Number(v.toFixed(digits));

export function toSensorSummaryPayload(s: LiveMotionSummary): SensorSummaryPayload {
  return {
    sample_rate_hz: round(s.sampleRateHz, 1),
    window_count: s.windowCount,
    window_seconds: s.windowSeconds,
    step_delta: s.stepDelta,
    dominant_freq_hz: round(s.dominantFreqHz, 2),
    freq_variance: round(s.freqVariance, 3),
    accel_rms: round(s.accelRms, 3),
    gyro_rms: round(s.gyroRms, 3),
    zero_crossing_rate: round(s.zeroCrossingRate, 2),
  };
}

export const liveMotion = {
  getCapabilities: () => NeonshiftSensors.getCapabilities(),

  /**
   * 執行一次 live motion check。`onProgress` 供 UI 倒數（Style 7.3 Verifying）。
   * 只回傳摘要；原始序列不會離開原生層。
   */
  async run(onProgress?: (p: LiveMotionProgress) => void, options: LiveMotionOptions = LIVE_MOTION_DEFAULTS): Promise<LiveMotionSummary> {
    const sub = onProgress ? NeonshiftSensors.addListener('onLiveMotionProgress', onProgress) : null;
    try {
      return await NeonshiftSensors.startLiveMotionCheck(options);
    } catch (e) {
      throw mapError(e);
    } finally {
      sub?.remove();
    }
  },

  cancel: () => NeonshiftSensors.cancelLiveMotionCheck(),
};

function mapError(e: unknown): LiveMotionError {
  const code = (e as { code?: string })?.code ?? '';
  const msg = e instanceof Error ? e.message : String(e);
  if (code === 'ERR_NO_SENSOR') return new LiveMotionError('NO_SENSOR', msg);
  if (code === 'ERR_SENSOR_BUSY') return new LiveMotionError('SENSOR_BUSY', msg);
  if (code === 'ERR_SENSOR_CANCELLED') return new LiveMotionError('CANCELLED', msg);
  return new LiveMotionError('SENSOR_FAILED', msg);
}
