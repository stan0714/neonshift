package expo.modules.neonshiftsensors

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.sin

/** PG-A-05：以合成訊號驗證主頻、RMS、零交越率與變異數；不需要裝置。 */
class MotionStatsTest {
  private fun sine(hz: Double, rate: Double, seconds: Double, amp: Double = 1.0): DoubleArray {
    val n = (rate * seconds).toInt()
    return DoubleArray(n) { amp * sin(2 * PI * hz * it / rate) }
  }

  @Test
  fun dominant_frequency_of_walking_like_signal() {
    val s = sine(1.8, 50.0, 10.0)
    val f = MotionStats.dominantFrequency(s, 50.0)
    assertEquals(1.8, f, 0.15)
  }

  @Test
  fun dominant_frequency_of_running_like_signal() {
    val s = sine(2.8, 50.0, 10.0)
    assertEquals(2.8, MotionStats.dominantFrequency(s, 50.0), 0.2)
  }

  @Test
  fun static_signal_has_no_dominant_frequency() {
    assertEquals(0.0, MotionStats.dominantFrequency(DoubleArray(500), 50.0), 0.0)
    val noise = DoubleArray(500) { if (it % 2 == 0) 1e-6 else -1e-6 }
    assertEquals(0.0, MotionStats.dominantFrequency(noise, 50.0), 0.0)
  }

  @Test
  fun window_summary_fields() {
    val s = sine(2.0, 50.0, 10.0, amp = 2.0)
    val w = MotionStats.summarizeWindow(s, DoubleArray(500) { 0.5 }, 10.0)
    assertEquals(500, w.samples)
    assertEquals(50.0, w.sampleRateHz, 0.01)
    assertEquals(2.0 / Math.sqrt(2.0), w.accelRms, 0.05)
    assertEquals(0.5, w.gyroRms, 0.001)
    // 2 Hz 正弦每秒 4 次零交越
    assertEquals(4.0, w.zeroCrossingRate, 0.3)
    assertEquals(2.0, w.dominantFreqHz, 0.15)
  }

  @Test
  fun low_amplitude_noise_is_treated_as_stationary() {
    // 0.05 m/s² 的 2 Hz 雜訊：低於 MIN_MOTION_RMS，不得回報主頻
    val w = MotionStats.summarizeWindow(sine(2.0, 50.0, 10.0, amp = 0.05), DoubleArray(0), 10.0)
    assertEquals(0.0, w.dominantFreqHz, 0.0)
    assertTrue(w.accelRms < MotionStats.MIN_MOTION_RMS)
  }

  @Test
  fun variance_of_regular_vs_irregular_cadence() {
    assertEquals(0.0, MotionStats.variance(listOf(1.8, 1.8, 1.8, 1.8)), 0.0)
    assertTrue(MotionStats.variance(listOf(1.5, 2.1, 1.7, 2.4)) > 0.08)
    assertEquals(0.0, MotionStats.variance(listOf(1.0)), 0.0)
  }

  @Test
  fun short_or_empty_windows_do_not_crash() {
    val w = MotionStats.summarizeWindow(DoubleArray(0), DoubleArray(0), 10.0)
    assertEquals(0, w.samples)
    assertEquals(0.0, w.dominantFreqHz, 0.0)
    val one = MotionStats.summarizeWindow(doubleArrayOf(1.0), DoubleArray(0), 0.02)
    assertEquals(0.0, one.sampleRateHz, 0.0)
  }
}
