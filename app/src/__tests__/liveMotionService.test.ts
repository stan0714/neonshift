import { NeonshiftSensors, type LiveMotionSummary } from '../../modules/neonshift-sensors';
import { LIVE_MOTION_DEFAULTS, LiveMotionError, liveMotion, toSensorSummaryPayload } from '@/services/sensors/LiveMotionService';

const native = NeonshiftSensors as jest.Mocked<typeof NeonshiftSensors>;

const summary: LiveMotionSummary = {
  sampleRateHz: 49.87,
  windowCount: 2,
  windowSeconds: 10,
  stepDelta: 34,
  stepCounterAvailable: true,
  dominantFreqHz: 1.8712,
  freqVariance: 0.3105,
  accelRms: 1.2401,
  gyroRms: 0.4199,
  zeroCrossingRate: 3.61,
  accelSource: 'linear_acceleration',
  windows: [],
};

describe('LiveMotionService（PG-A-05，BR-09）', () => {
  test('預設 20 秒／10 秒視窗／50 Hz（SD 5.1）', () => {
    expect(LIVE_MOTION_DEFAULTS).toEqual({ durationSeconds: 20, windowSeconds: 10, sampleRateHz: 50 });
  });

  test('摘要轉為 SD 4.3 sensor_summary 欄位，且不含原始序列', () => {
    const p = toSensorSummaryPayload(summary);
    expect(p).toEqual({
      sample_rate_hz: 49.9,
      window_count: 2,
      window_seconds: 10,
      step_delta: 34,
      dominant_freq_hz: 1.87,
      freq_variance: 0.31,
      accel_rms: 1.24,
      gyro_rms: 0.42,
      zero_crossing_rate: 3.61,
    });
    expect(Object.keys(p)).not.toContain('windows');
  });

  test('run 訂閱進度並在結束後移除', async () => {
    const remove = jest.fn();
    native.addListener.mockReturnValueOnce({ remove } as never);
    native.startLiveMotionCheck.mockResolvedValueOnce(summary);
    const onProgress = jest.fn();
    await expect(liveMotion.run(onProgress)).resolves.toBe(summary);
    expect(native.addListener).toHaveBeenCalledWith('onLiveMotionProgress', onProgress);
    expect(native.startLiveMotionCheck).toHaveBeenCalledWith(LIVE_MOTION_DEFAULTS);
    expect(remove).toHaveBeenCalled();
  });

  test('原生錯誤碼映射', async () => {
    for (const [code, expected] of [
      ['ERR_NO_SENSOR', 'NO_SENSOR'],
      ['ERR_SENSOR_BUSY', 'SENSOR_BUSY'],
      ['ERR_SENSOR_CANCELLED', 'CANCELLED'],
      ['ERR_OTHER', 'SENSOR_FAILED'],
    ] as const) {
      native.startLiveMotionCheck.mockRejectedValueOnce(Object.assign(new Error('x'), { code }));
      const err = await liveMotion.run().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(LiveMotionError);
      expect((err as LiveMotionError).code).toBe(expected);
    }
  });
});
