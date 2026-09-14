package expo.modules.neonshifthealth

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.ext.SdkExtensions
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.aggregate.AggregationResult
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.metadata.DataOrigin
import androidx.health.connect.client.records.metadata.Metadata
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.Serializable
import java.time.Instant
import kotlin.math.max

/**
 * HealthConnectModule（PG-A-04，SD 5.1、BR-05／07／08、FR-02）。
 *
 * 職責：availability／SDK extension 檢查、權限、`aggregate()`、StepsRecord／SleepSessionRecord 讀取、
 * dataOrigin 歸因與 step-rate 摘要。不負責達標判定（TaskEngine，PG-A-08）。
 *
 * 隱私：原始 records 只在本函式內彙總，回傳給 JS 的只有摘要；不保存、不上傳原始序列。
 */
class NeonshiftHealthModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val client: HealthConnectClient by lazy { HealthConnectClient.getOrCreate(context) }

  private lateinit var permissionLauncher: AppContextActivityResultLauncher<PermissionRequest, Set<String>>

  override fun definition() = ModuleDefinition {
    Name("NeonshiftHealth")

    Constants(
      "PERMISSION_READ_STEPS" to HealthPermission.getReadPermission(StepsRecord::class),
      "PERMISSION_READ_SLEEP" to HealthPermission.getReadPermission(SleepSessionRecord::class),
      "PERMISSION_READ_BACKGROUND" to HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND,
      "LEGACY_DEVICE_ORIGIN" to LEGACY_DEVICE_ORIGIN
    )

    RegisterActivityContracts {
      permissionLauncher = registerForActivityResult(PermissionContract())
    }

    /** availability、SDK extension、SPN 支援與目前裝置 SPN（動態取得，不硬編碼） */
    AsyncFunction("getStatus") {
      val sdkStatus = HealthConnectClient.getSdkStatus(context)
      val availability = when (sdkStatus) {
        HealthConnectClient.SDK_AVAILABLE -> "available"
        HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> "update_required"
        else -> "unavailable"
      }
      val extension = sdkExtension()
      val spn = currentDeviceDataSource()
      mapOf(
        "availability" to availability,
        "osApi" to Build.VERSION.SDK_INT,
        "sdkExtension" to extension,
        // SD 5.1：SPN 查詢門檻 extension 11、內建計步 extension 20，分開回報
        "spnQuerySupported" to (extension >= SPN_QUERY_MIN_EXTENSION && spn != null),
        "deviceStepsSupported" to (extension >= DEVICE_STEPS_MIN_EXTENSION),
        "deviceSpn" to spn,
        "deviceModel" to Build.MODEL
      )
    }

    AsyncFunction("getGrantedPermissions") Coroutine { ->
      client.permissionController.getGrantedPermissions().toList()
    }

    /** 顯示系統權限頁；回傳目前已授予的全部權限（含先前授予） */
    AsyncFunction("requestPermissions") Coroutine { permissions: List<String> ->
      if (!this@NeonshiftHealthModule::permissionLauncher.isInitialized) {
        throw CodedException("ERR_HC_LAUNCHER", "permission launcher not ready", null)
      }
      val granted = permissionLauncher.launch(PermissionRequest(permissions))
      // 使用者關閉對話框時 contract 可能回空集合，以實際狀態為準
      if (granted.isEmpty()) client.permissionController.getGrantedPermissions().toList() else granted.toList()
    }

    AsyncFunction("openSettings") {
      val intent = Intent(HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }

    /**
     * 讀取 [startUnix, endUnix) 的步數，依 dataOrigin 歸因（BR-07／08）：
     * - `android_legacy`：歷史 `android` 來源
     * - `current_device_spn`：等於動態取得的裝置 SPN
     * - `manual`：recordingMethod 為手動輸入
     * - `third_party`：其他套件寫入
     * 只有前兩者計入 `total`（以 aggregate + DataOriginFilter 計算）與 step-rate 摘要。
     */
    AsyncFunction("readSteps") Coroutine { startUnix: Double, endUnix: Double ->
      val start = Instant.ofEpochSecond(startUnix.toLong())
      val end = Instant.ofEpochSecond(endUnix.toLong())
      val range = TimeRangeFilter.between(start, end)
      val spn = currentDeviceDataSource()

      val origins = LinkedHashMap<String, OriginAgg>()
      val minuteBuckets = HashMap<Long, Long>()
      var pageToken: String? = null
      do {
        val page = client.readRecords(ReadRecordsRequest(StepsRecord::class, range, pageToken = pageToken))
        for (r in page.records) {
          val pkg = r.metadata.dataOrigin.packageName
          val kind = classify(pkg, r.metadata.recordingMethod, spn)
          val agg = origins.getOrPut(pkg) { OriginAgg(pkg, kind) }
          agg.steps += r.count
          agg.records += 1
          if (kind == KIND_LEGACY || kind == KIND_DEVICE_SPN) {
            spreadIntoMinutes(minuteBuckets, r.startTime, r.endTime, r.count, start, end)
          }
        }
        pageToken = page.pageToken
      } while (pageToken != null)
      // records 用完即丟：離開迴圈後不再持有任何 StepsRecord

      val allowed = origins.values.filter { it.kind == KIND_LEGACY || it.kind == KIND_DEVICE_SPN }.map { DataOrigin(it.pkg) }.toSet()
      // DataOriginFilter 為空代表「全部來源」，不可直接呼叫（BR-07）
      val total: Long = if (allowed.isEmpty()) 0L else {
        val result: AggregationResult = client.aggregate(
          AggregateRequest(setOf(StepsRecord.COUNT_TOTAL), range, dataOriginFilter = allowed)
        )
        result[StepsRecord.COUNT_TOTAL] ?: 0L
      }

      mapOf(
        "total" to total,
        "dataOrigins" to origins.values.map {
          mapOf("package" to it.pkg, "sourceKind" to it.kind, "steps" to it.steps, "records" to it.records)
        },
        "stepRateSummary" to mapOf(
          "observedMinutes" to minuteBuckets.size,
          "maxStepsPerMinute" to (minuteBuckets.values.maxOrNull() ?: 0L)
        ),
        "deviceSpn" to spn
      )
    }

    /**
     * 讀取結束時間落在 [startUnix, endUnix) 的睡眠 session（BR-05：以結束時間歸屬任務日）。
     * 查詢範圍向前多取 24 小時再以 endTime 過濾；不套用步數的 SPN 限制（BR-07）。
     */
    AsyncFunction("readSleepSessions") Coroutine { startUnix: Double, endUnix: Double ->
      val start = Instant.ofEpochSecond(startUnix.toLong())
      val end = Instant.ofEpochSecond(endUnix.toLong())
      val range = TimeRangeFilter.between(start.minusSeconds(24 * 3600), end)
      val sessions = ArrayList<Map<String, Any?>>()
      var pageToken: String? = null
      do {
        val page = client.readRecords(ReadRecordsRequest(SleepSessionRecord::class, range, pageToken = pageToken))
        for (s in page.records) {
          if (s.endTime.isBefore(start) || !s.endTime.isBefore(end)) continue
          sessions += mapOf(
            "startUnix" to s.startTime.epochSecond,
            "endUnix" to s.endTime.epochSecond,
            "minutes" to max(0L, (s.endTime.epochSecond - s.startTime.epochSecond) / 60),
            "package" to s.metadata.dataOrigin.packageName,
            "recordingMethod" to recordingMethodName(s.metadata.recordingMethod)
          )
        }
        pageToken = page.pageToken
      } while (pageToken != null)
      mapOf("sessions" to sessions)
    }
  }

  // ---------------------------------------------------------------- helpers

  private fun sdkExtension(): Int =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      SdkExtensions.getExtensionVersion(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
    } else 0

  /**
   * 以 framework `HealthConnectManager` 動態查詢目前裝置的步數資料來源套件名（SPN）。
   * API 依 SDK extension 版本才存在，因此用反射做功能偵測；不存在時回 null，
   * 呼叫端只接受歷史 `android` 來源。任何時候都不硬編碼 SPN（BR-08）。
   */
  private fun currentDeviceDataSource(): String? {
    if (sdkExtension() < SPN_QUERY_MIN_EXTENSION) return null
    return try {
      val manager = context.getSystemService("healthconnect") ?: return null
      val method = manager.javaClass.methods.firstOrNull {
        it.name == "getCurrentDeviceDataSource" && it.parameterCount == 0
      } ?: return null
      val result = method.invoke(manager)
      when (result) {
        is String -> result.takeIf { it.isNotBlank() }
        null -> null
        else -> {
          // 可能是包裝物件；嘗試常見 getter
          val getter = result.javaClass.methods.firstOrNull { it.name == "getPackageName" && it.parameterCount == 0 }
          (getter?.invoke(result) as? String)?.takeIf { it.isNotBlank() }
        }
      }
    } catch (_: Throwable) {
      null
    }
  }

  private fun classify(pkg: String, recordingMethod: Int, spn: String?): String = when {
    recordingMethod == Metadata.RECORDING_METHOD_MANUAL_ENTRY -> KIND_MANUAL
    pkg == LEGACY_DEVICE_ORIGIN -> KIND_LEGACY
    spn != null && pkg == spn -> KIND_DEVICE_SPN
    else -> KIND_THIRD_PARTY
  }

  private fun recordingMethodName(m: Int): String = when (m) {
    Metadata.RECORDING_METHOD_MANUAL_ENTRY -> "manual"
    Metadata.RECORDING_METHOD_AUTOMATICALLY_RECORDED -> "automatic"
    Metadata.RECORDING_METHOD_ACTIVELY_RECORDED -> "active"
    else -> "unknown"
  }

  /** 把一筆 record 的步數均勻攤到它涵蓋的每一分鐘（裁到查詢範圍內），供每分鐘速率規則使用（BR-10） */
  private fun spreadIntoMinutes(buckets: HashMap<Long, Long>, s: Instant, e: Instant, count: Long, lo: Instant, hi: Instant) {
    val from = max(s.epochSecond, lo.epochSecond)
    val to = minOf(e.epochSecond, hi.epochSecond)
    if (to <= from) return
    val firstMin = from / 60
    val lastMin = (to - 1) / 60
    val minutes = (lastMin - firstMin + 1).coerceAtLeast(1)
    if (minutes > MAX_MINUTES_PER_RECORD) {
      // 異常長的 record（例如整日一筆）：只記平均，不建立過多 bucket
      val avg = count / minutes
      buckets[firstMin] = (buckets[firstMin] ?: 0L) + avg
      return
    }
    val base = count / minutes
    var remainder = count - base * minutes
    for (m in firstMin..lastMin) {
      val extra = if (remainder > 0) { remainder -= 1; 1L } else 0L
      buckets[m] = (buckets[m] ?: 0L) + base + extra
    }
  }

  private class OriginAgg(val pkg: String, val kind: String) {
    var steps: Long = 0
    var records: Int = 0
  }

  data class PermissionRequest(val permissions: List<String>) : Serializable

  /** 包裝 Health Connect 的權限請求 contract 成 Expo 的 activity-result contract */
  private class PermissionContract : AppContextActivityResultContract<PermissionRequest, Set<String>> {
    private val inner = PermissionController.createRequestPermissionResultContract()
    override fun createIntent(context: Context, input: PermissionRequest): Intent =
      inner.createIntent(context, input.permissions.toSet())
    override fun parseResult(input: PermissionRequest, resultCode: Int, intent: Intent?): Set<String> =
      inner.parseResult(resultCode, intent)
  }

  companion object {
    const val LEGACY_DEVICE_ORIGIN = "android"
    const val KIND_LEGACY = "android_legacy"
    const val KIND_DEVICE_SPN = "current_device_spn"
    const val KIND_MANUAL = "manual"
    const val KIND_THIRD_PARTY = "third_party"
    const val SPN_QUERY_MIN_EXTENSION = 11
    const val DEVICE_STEPS_MIN_EXTENSION = 20
    const val MAX_MINUTES_PER_RECORD = 24 * 60
  }
}
