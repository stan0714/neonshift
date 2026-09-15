package expo.modules.neonshiftsensors

import kotlin.math.abs
import kotlin.math.sqrt

/**
 * 純計算：把一個視窗的取樣序列化成統計摘要（SD 4.3 sensor_summary）。
 * 不依賴 Android，可單獨測試。呼叫端在算完後必須丟棄原始序列（BR-09）。
 */
object MotionStats {
  /** 步行／跑步主頻搜尋範圍（Hz） */
  const val MIN_STEP_HZ = 0.5
  const val MAX_STEP_HZ = 4.0
  /** 低於此 RMS（m/s²）視為靜止：不估主頻，避免把感測器雜訊當成步態（Seeker 實測靜置 RMS ≈ 0.004） */
  const val MIN_MOTION_RMS = 0.15

  data class WindowSummary(
    val samples: Int,
    val seconds: Double,
    val sampleRateHz: Double,
    val accelRms: Double,
    val gyroRms: Double,
    val zeroCrossingRate: Double,
    val dominantFreqHz: Double,
  )

  /**
   * @param accelMag 線性加速度向量長度序列（已去重力；若只有原始加速度，呼叫端先減去平均）
   * @param gyroMag 角速度向量長度序列（可為空）
   */
  fun summarizeWindow(accelMag: DoubleArray, gyroMag: DoubleArray, seconds: Double): WindowSummary {
    val n = accelMag.size
    if (n < 2 || seconds <= 0.0) {
      return WindowSummary(n, seconds, 0.0, 0.0, 0.0, 0.0, 0.0)
    }
    val rate = n / seconds
    val mean = accelMag.average()
    val detrended = DoubleArray(n) { accelMag[it] - mean }
    val accelRms = sqrt(detrended.sumOf { it * it } / n)
    val gyroRms = if (gyroMag.isEmpty()) 0.0 else sqrt(gyroMag.sumOf { it * it } / gyroMag.size)
    var crossings = 0
    for (i in 1 until n) {
      if ((detrended[i - 1] < 0 && detrended[i] >= 0) || (detrended[i - 1] >= 0 && detrended[i] < 0)) crossings++
    }
    val zcr = crossings / seconds
    val dominant = if (accelRms < MIN_MOTION_RMS) 0.0 else dominantFrequency(detrended, rate)
    return WindowSummary(n, seconds, rate, accelRms, gyroRms, zcr, dominant)
  }

  /**
   * 以自相關在 [MIN_STEP_HZ, MAX_STEP_HZ] 找主頻；不做 FFT，O(n·lag) 對 500 點視窗足夠。
   * 訊號能量過低（靜止）回 0。
   */
  fun dominantFrequency(detrended: DoubleArray, rate: Double): Double {
    val n = detrended.size
    val energy = detrended.sumOf { it * it }
    if (n < 8 || rate <= 0.0 || energy < 1e-9) return 0.0
    val minLag = (rate / MAX_STEP_HZ).toInt().coerceAtLeast(1)
    val maxLag = (rate / MIN_STEP_HZ).toInt().coerceAtMost(n - 2)
    if (maxLag <= minLag) return 0.0
    var bestLag = 0
    var best = Double.NEGATIVE_INFINITY
    for (lag in minLag..maxLag) {
      var acc = 0.0
      for (i in 0 until n - lag) acc += detrended[i] * detrended[i + lag]
      val norm = acc / energy
      if (norm > best) {
        best = norm
        bestLag = lag
      }
    }
    // 自相關峰值太弱代表沒有週期性動作
    return if (best < 0.2 || bestLag == 0) 0.0 else rate / bestLag
  }

  /** 母體變異數；少於兩個值回 0 */
  fun variance(values: List<Double>): Double {
    if (values.size < 2) return 0.0
    val m = values.average()
    return values.sumOf { (it - m) * (it - m) } / values.size
  }

  fun magnitude(x: Float, y: Float, z: Float): Double = sqrt((x * x + y * y + z * z).toDouble())

  @Suppress("unused")
  fun absMean(values: DoubleArray): Double = if (values.isEmpty()) 0.0 else values.sumOf { abs(it) } / values.size
}
