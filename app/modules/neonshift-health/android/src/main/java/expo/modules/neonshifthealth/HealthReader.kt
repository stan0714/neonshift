package expo.modules.neonshifthealth

import android.content.Context
import android.os.Build
import android.os.ext.SdkExtensions
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.metadata.DataOrigin
import androidx.health.connect.client.records.metadata.Metadata
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import kotlin.math.max

/**
 * Health Connect 讀取與來源歸因（PG-A-04／A-19 共用）。
 * 前景 module 與背景 WorkManager worker 都用這一份，避免兩套規則。回傳 JSON（可直接寫快取）。
 */
class HealthReader(private val context: Context) {
  private val client: HealthConnectClient by lazy { HealthConnectClient.getOrCreate(context) }

  fun sdkExtension(): Int =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) SdkExtensions.getExtensionVersion(Build.VERSION_CODES.UPSIDE_DOWN_CAKE) else 0

  /** 以反射偵測 framework `getCurrentDeviceDataSource`（BR-08：不硬編碼 SPN） */
  fun currentDeviceDataSource(): String? {
    if (sdkExtension() < SPN_QUERY_MIN_EXTENSION) return null
    return try {
      val manager = context.getSystemService("healthconnect") ?: return null
      val method = manager.javaClass.methods.firstOrNull { it.name == "getCurrentDeviceDataSource" && it.parameterCount == 0 } ?: return null
      when (val result = method.invoke(manager)) {
        is String -> result.takeIf { it.isNotBlank() }
        null -> null
        else -> (result.javaClass.methods.firstOrNull { it.name == "getPackageName" && it.parameterCount == 0 }?.invoke(result) as? String)?.takeIf { it.isNotBlank() }
      }
    } catch (_: Throwable) { null }
  }

  suspend fun readSteps(start: Instant, end: Instant): JSONObject {
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
        if (kind == KIND_LEGACY || kind == KIND_DEVICE_SPN) spreadIntoMinutes(minuteBuckets, r.startTime, r.endTime, r.count, start, end)
      }
      pageToken = page.pageToken
    } while (pageToken != null)
    // records 用完即丟

    val allowed = origins.values.filter { it.kind == KIND_LEGACY || it.kind == KIND_DEVICE_SPN }.map { DataOrigin(it.pkg) }.toSet()
    val total: Long = if (allowed.isEmpty()) 0L else {
      client.aggregate(AggregateRequest(setOf(StepsRecord.COUNT_TOTAL), range, dataOriginFilter = allowed))[StepsRecord.COUNT_TOTAL] ?: 0L
    }
    val dayStartMinute = start.epochSecond / 60
    val buckets = JSONArray()
    minuteBuckets.entries
      .map { (absMinute, steps) -> Pair((absMinute - dayStartMinute).toInt(), steps) }
      .filter { it.first in 0..1439 && it.second > 0 }
      .sortedBy { it.first }
      .forEach { buckets.put(JSONArray().put(it.first).put(it.second)) }
    val originsJson = JSONArray()
    origins.values.forEach { originsJson.put(JSONObject().put("package", it.pkg).put("sourceKind", it.kind).put("steps", it.steps).put("records", it.records)) }
    return JSONObject()
      .put("total", total)
      .put("dataOrigins", originsJson)
      .put("stepRateSummary", JSONObject()
        .put("bucketMinutes", 1)
        .put("buckets", buckets)
        .put("observedMinutes", minuteBuckets.count { it.value > 0 })
        .put("maxStepsPerMinute", minuteBuckets.values.maxOrNull() ?: 0L))
      .put("deviceSpn", spn ?: JSONObject.NULL)
  }

  suspend fun readSleepSessions(start: Instant, end: Instant): JSONObject {
    val range = TimeRangeFilter.between(start.minusSeconds(24 * 3600), end)
    val sessions = JSONArray()
    var pageToken: String? = null
    do {
      val page = client.readRecords(ReadRecordsRequest(SleepSessionRecord::class, range, pageToken = pageToken))
      for (s in page.records) {
        if (s.endTime.isBefore(start) || !s.endTime.isBefore(end)) continue
        sessions.put(JSONObject()
          .put("startUnix", s.startTime.epochSecond)
          .put("endUnix", s.endTime.epochSecond)
          .put("minutes", max(0L, (s.endTime.epochSecond - s.startTime.epochSecond) / 60))
          .put("package", s.metadata.dataOrigin.packageName)
          .put("recordingMethod", recordingMethodName(s.metadata.recordingMethod)))
      }
      pageToken = page.pageToken
    } while (pageToken != null)
    return JSONObject().put("sessions", sessions)
  }

  /**
   * PG-R-02：結束時間落在 [start, end) 的跑步／健走 ExerciseSession，每筆附同來源、同時段的距離／步數／熱量 aggregate。
   * 只回摘要（無路線）；缺權限的欄位回 null 並標 partialPermissions；Active 與 Total 熱量分開，不相加。
   * 手機與手錶同場紀錄各自一筆（去重／可能重複由後端 R-01 規則判定，這裡不合併）。
   */
  suspend fun readExerciseSessions(start: Instant, end: Instant): JSONObject {
    val granted = client.permissionController.getGrantedPermissions()
    val canDistance = granted.contains(HealthPermission.getReadPermission(DistanceRecord::class))
    val canSteps = granted.contains(HealthPermission.getReadPermission(StepsRecord::class))
    val canActive = granted.contains(HealthPermission.getReadPermission(ActiveCaloriesBurnedRecord::class))
    val canTotal = granted.contains(HealthPermission.getReadPermission(TotalCaloriesBurnedRecord::class))
    val range = TimeRangeFilter.between(start.minusSeconds(24 * 3600), end)
    val sessions = JSONArray()
    var pageToken: String? = null
    do {
      val page = client.readRecords(ReadRecordsRequest(ExerciseSessionRecord::class, range, pageToken = pageToken))
      for (s in page.records) {
        if (s.endTime.isBefore(start) || !s.endTime.isBefore(end)) continue
        if (s.exerciseType !in SUPPORTED_EXERCISE_TYPES) continue // 僅跑步／健走（專案範圍）
        val origin = setOf(s.metadata.dataOrigin)
        val window = TimeRangeFilter.between(s.startTime, s.endTime)
        val metrics = HashSet<androidx.health.connect.client.aggregate.AggregateMetric<*>>()
        if (canDistance) metrics.add(DistanceRecord.DISTANCE_TOTAL)
        if (canSteps) metrics.add(StepsRecord.COUNT_TOTAL)
        if (canActive) metrics.add(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL)
        if (canTotal) metrics.add(TotalCaloriesBurnedRecord.ENERGY_TOTAL)
        val agg = if (metrics.isEmpty()) null else client.aggregate(AggregateRequest(metrics, window, dataOriginFilter = origin))
        val distance = if (canDistance) agg?.get(DistanceRecord.DISTANCE_TOTAL)?.inMeters else null
        val steps = if (canSteps) agg?.get(StepsRecord.COUNT_TOTAL) else null
        val active = if (canActive) agg?.get(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL)?.inKilocalories else null
        val total = if (canTotal) agg?.get(TotalCaloriesBurnedRecord.ENERGY_TOTAL)?.inKilocalories else null
        val version = if (s.metadata.clientRecordVersion > 0) s.metadata.clientRecordVersion else s.metadata.lastModifiedTime.epochSecond
        sessions.put(JSONObject()
          .put("recordId", s.metadata.id)
          .put("dataOrigin", s.metadata.dataOrigin.packageName)
          .put("exerciseType", s.exerciseType)
          .put("startUnixMs", s.startTime.toEpochMilli())
          .put("endUnixMs", s.endTime.toEpochMilli())
          .put("version", version)
          .put("title", s.title ?: JSONObject.NULL)
          .put("recordingMethod", recordingMethodName(s.metadata.recordingMethod))
          .put("distanceMeters", distance ?: JSONObject.NULL)
          .put("steps", steps ?: JSONObject.NULL)
          .put("activeKcal", active ?: JSONObject.NULL)
          .put("totalKcal", total ?: JSONObject.NULL)
          .put("partialPermissions", !(canDistance && canSteps && canActive)))
      }
      pageToken = page.pageToken
    } while (pageToken != null)
    return JSONObject()
      .put("sessions", sessions)
      .put("permissions", JSONObject().put("distance", canDistance).put("steps", canSteps).put("activeCalories", canActive).put("totalCalories", canTotal))
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

  /** 把一筆 record 的步數均勻攤到涵蓋的每一分鐘（裁到查詢範圍內），供每分鐘速率規則使用（BR-10） */
  private fun spreadIntoMinutes(buckets: HashMap<Long, Long>, s: Instant, e: Instant, count: Long, lo: Instant, hi: Instant) {
    val from = max(s.epochSecond, lo.epochSecond)
    val to = minOf(e.epochSecond, hi.epochSecond)
    if (to <= from) return
    val firstMin = from / 60
    val lastMin = (to - 1) / 60
    val minutes = (lastMin - firstMin + 1).coerceAtLeast(1)
    if (minutes > MAX_MINUTES_PER_RECORD) {
      buckets[firstMin] = (buckets[firstMin] ?: 0L) + count / minutes
      return
    }
    val base = count / minutes
    var remainder = count - base * minutes
    for (m in firstMin..lastMin) {
      val extra = if (remainder > 0) { remainder -= 1; 1L } else 0L
      buckets[m] = (buckets[m] ?: 0L) + base + extra
    }
  }

  private class OriginAgg(val pkg: String, val kind: String) { var steps: Long = 0; var records: Int = 0 }

  companion object {
    const val LEGACY_DEVICE_ORIGIN = "android"
    const val KIND_LEGACY = "android_legacy"
    const val KIND_DEVICE_SPN = "current_device_spn"
    const val KIND_MANUAL = "manual"
    const val KIND_THIRD_PARTY = "third_party"
    const val SPN_QUERY_MIN_EXTENSION = 11
    const val DEVICE_STEPS_MIN_EXTENSION = 20
    const val MAX_MINUTES_PER_RECORD = 24 * 60
    /** ExerciseSessionRecord.EXERCISE_TYPE_RUNNING／RUNNING_TREADMILL／WALKING */
    val SUPPORTED_EXERCISE_TYPES = setOf(ExerciseSessionRecord.EXERCISE_TYPE_RUNNING, ExerciseSessionRecord.EXERCISE_TYPE_RUNNING_TREADMILL, ExerciseSessionRecord.EXERCISE_TYPE_WALKING)
  }
}
