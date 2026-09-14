package expo.modules.neonshiftsensors

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/**
 * SensorModule（PG-A-05，SD 5.1、BR-09、FR-07.2）。
 *
 * 步數任務當日首次領取前執行 20 秒引導式 live motion check：前景 50 Hz、兩個 10 秒視窗，
 * 產生統計摘要（取樣率、主頻、頻率變異、振幅 RMS、零交越率）與同步步數增量（TYPE_STEP_COUNTER）。
 * 原始序列只存在於視窗計算期間的記憶體，不回傳、不保存、不上傳。
 * 不負責：推論視窗外的歷史步數、背景持續錄製。
 */
class NeonshiftSensorsModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private var session: Session? = null

  class Options : Record {
    @Field val durationSeconds: Int = 20
    @Field val windowSeconds: Int = 10
    @Field val sampleRateHz: Int = 50
  }

  override fun definition() = ModuleDefinition {
    Name("NeonshiftSensors")

    Events("onLiveMotionProgress")

    AsyncFunction("getCapabilities") {
      val sm = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
      mapOf(
        "accelerometer" to (sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) != null),
        "linearAcceleration" to (sm.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION) != null),
        "gyroscope" to (sm.getDefaultSensor(Sensor.TYPE_GYROSCOPE) != null),
        "stepCounter" to (sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER) != null),
      )
    }

    /** 開始取樣；完成後 resolve 摘要。同時只能有一個 session。 */
    AsyncFunction("startLiveMotionCheck") { options: Options, promise: Promise ->
      if (session != null) {
        promise.reject(CodedException("ERR_SENSOR_BUSY", "live motion check already running", null))
        return@AsyncFunction
      }
      val sm = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
      val accel = sm.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION) ?: sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
      if (accel == null) {
        promise.reject(CodedException("ERR_NO_SENSOR", "no accelerometer available", null))
        return@AsyncFunction
      }
      val s = Session(sm, accel, sm.getDefaultSensor(Sensor.TYPE_GYROSCOPE), sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER), options, promise)
      session = s
      s.start()
    }

    AsyncFunction("cancelLiveMotionCheck") {
      session?.cancel()
      session = null
    }

    OnDestroy {
      session?.cancel()
      session = null
    }
  }

  private inner class Session(
    private val sm: SensorManager,
    private val accelSensor: Sensor,
    private val gyroSensor: Sensor?,
    private val stepSensor: Sensor?,
    private val options: Options,
    private val promise: Promise,
  ) : SensorEventListener {
    private val thread = HandlerThread("neonshift-sensors").apply { start() }
    private val handler = Handler(thread.looper)
    private val isRawAccel = accelSensor.type == Sensor.TYPE_ACCELEROMETER

    // 目前視窗的序列；視窗結束即彙總並清空（BR-09）
    private val accel = ArrayList<Double>(options.sampleRateHz * options.windowSeconds + 64)
    private val gyro = ArrayList<Double>(options.sampleRateHz * options.windowSeconds + 64)
    private val windows = ArrayList<MotionStats.WindowSummary>()
    private val segmentFreqs = ArrayList<Double>()
    private var windowStartNs = 0L
    private var stepFirst: Float? = null
    private var stepLast: Float? = null
    private var finished = false

    fun start() {
      val periodUs = (1_000_000 / options.sampleRateHz.coerceIn(10, 200))
      sm.registerListener(this, accelSensor, periodUs, handler)
      gyroSensor?.let { sm.registerListener(this, it, periodUs, handler) }
      stepSensor?.let { sm.registerListener(this, it, SensorManager.SENSOR_DELAY_FASTEST, handler) }
      windowStartNs = SystemClock.elapsedRealtimeNanos()
      val windowCount = (options.durationSeconds / options.windowSeconds).coerceAtLeast(1)
      for (w in 1..windowCount) {
        handler.postDelayed({ closeWindow(w, w == windowCount) }, (w * options.windowSeconds * 1000L))
      }
      emitProgress(0, windowCount)
      // 每秒進度事件（引導 UI 倒數）
      for (sec in 1 until options.durationSeconds) {
        handler.postDelayed({ if (!finished) emitProgress(sec, windowCount) }, sec * 1000L)
      }
    }

    private fun emitProgress(elapsed: Int, windowCount: Int) {
      sendEvent("onLiveMotionProgress", mapOf(
        "elapsedSeconds" to elapsed,
        "durationSeconds" to options.durationSeconds,
        "windowIndex" to (elapsed / options.windowSeconds).coerceAtMost(windowCount - 1),
        "windowCount" to windowCount,
      ))
    }

    override fun onSensorChanged(event: SensorEvent) {
      if (finished) return
      when (event.sensor.type) {
        Sensor.TYPE_LINEAR_ACCELERATION, Sensor.TYPE_ACCELEROMETER ->
          accel.add(MotionStats.magnitude(event.values[0], event.values[1], event.values[2]))
        Sensor.TYPE_GYROSCOPE ->
          gyro.add(MotionStats.magnitude(event.values[0], event.values[1], event.values[2]))
        Sensor.TYPE_STEP_COUNTER -> {
          val v = event.values[0]
          if (stepFirst == null) stepFirst = v
          stepLast = v
        }
      }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

    private fun closeWindow(index: Int, last: Boolean) {
      if (finished) return
      val nowNs = SystemClock.elapsedRealtimeNanos()
      val seconds = (nowNs - windowStartNs) / 1e9
      windowStartNs = nowNs
      val a = accel.toDoubleArray()
      val g = gyro.toDoubleArray()
      accel.clear()
      gyro.clear()
      // 原始加速度含重力：以視窗平均近似去除（線性加速度感測器則已去重力）
      val series = if (isRawAccel) {
        val m = if (a.isEmpty()) 0.0 else a.average()
        DoubleArray(a.size) { a[it] - m }
      } else a
      val summary = MotionStats.summarizeWindow(series, g, seconds)
      windows += summary
      // 2 秒子段主頻，用於 freq_variance（搖步機頻率過於規律）
      val seg = (summary.sampleRateHz * 2).toInt()
      if (seg >= 8) {
        var i = 0
        while (i + seg <= series.size) {
          val sub = series.copyOfRange(i, i + seg)
          val mean = sub.average()
          for (k in sub.indices) sub[k] -= mean
          val rms = kotlin.math.sqrt(sub.sumOf { it * it } / sub.size)
          val f = if (rms < MotionStats.MIN_MOTION_RMS) 0.0 else MotionStats.dominantFrequency(sub, summary.sampleRateHz)
          if (f > 0) segmentFreqs += f
          i += seg
        }
      }
      if (last) finish()
    }

    private fun finish() {
      finished = true
      sm.unregisterListener(this)
      thread.quitSafely()
      session = null
      val n = windows.size.coerceAtLeast(1)
      val stepDelta = if (stepFirst != null && stepLast != null) (stepLast!! - stepFirst!!).toInt().coerceAtLeast(0) else 0
      promise.resolve(mapOf(
        "sampleRateHz" to windows.map { it.sampleRateHz }.average().let { if (it.isNaN()) 0.0 else it },
        "windowCount" to windows.size,
        "windowSeconds" to options.windowSeconds,
        "stepDelta" to stepDelta,
        "stepCounterAvailable" to (stepSensor != null),
        "dominantFreqHz" to windows.sumOf { it.dominantFreqHz } / n,
        "freqVariance" to MotionStats.variance(segmentFreqs),
        "accelRms" to windows.sumOf { it.accelRms } / n,
        "gyroRms" to windows.sumOf { it.gyroRms } / n,
        "zeroCrossingRate" to windows.sumOf { it.zeroCrossingRate } / n,
        "accelSource" to if (isRawAccel) "accelerometer" else "linear_acceleration",
        "windows" to windows.map {
          mapOf("samples" to it.samples, "seconds" to it.seconds, "dominantFreqHz" to it.dominantFreqHz, "accelRms" to it.accelRms)
        },
      ))
    }

    fun cancel() {
      if (finished) return
      finished = true
      handler.removeCallbacksAndMessages(null)
      sm.unregisterListener(this)
      thread.quitSafely()
      accel.clear()
      gyro.clear()
      promise.reject(CodedException("ERR_SENSOR_CANCELLED", "live motion check cancelled", null))
    }
  }
}
