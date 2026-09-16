package expo.modules.neonshifthealth

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.activity.result.contract.ActivityResultContracts.RequestMultiplePermissions
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
import androidx.health.connect.client.records.StepsRecord
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import org.json.JSONArray
import org.json.JSONObject
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.time.Instant
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

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

  /** Health Connect 權限請求 contract（只用來建 Intent／解析結果；啟動與回傳自己處理，見 requestPermissions） */
  private val permissionContract = PermissionController.createRequestPermissionResultContract()

  /** 進行中的權限請求；系統對話框回來（onActivityResult）或 App 回到前景時擇先完成 */
  private var pendingPermission: CompletableDeferred<Set<String>?>? = null

  override fun definition() = ModuleDefinition {
    Name("NeonshiftHealth")

    Constants(
      "PERMISSION_READ_STEPS" to HealthPermission.getReadPermission(StepsRecord::class),
      "PERMISSION_READ_SLEEP" to HealthPermission.getReadPermission(SleepSessionRecord::class),
      "PERMISSION_READ_BACKGROUND" to HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND,
      // PG-R-02：運動 session 匯入（唯讀）
      "PERMISSION_READ_EXERCISE" to HealthPermission.getReadPermission(ExerciseSessionRecord::class),
      "PERMISSION_READ_DISTANCE" to HealthPermission.getReadPermission(DistanceRecord::class),
      "PERMISSION_READ_ACTIVE_CALORIES" to HealthPermission.getReadPermission(ActiveCaloriesBurnedRecord::class),
      "PERMISSION_READ_TOTAL_CALORIES" to HealthPermission.getReadPermission(TotalCaloriesBurnedRecord::class),
      "LEGACY_DEVICE_ORIGIN" to LEGACY_DEVICE_ORIGIN
    )

    /**
     * 權限對話框回傳（Activity 結果路徑；只用在 contract 給的不是執行期權限 Intent 時）。
     * Android 14+ 的 Health Connect 權限是執行期權限：contract 產生的是 REQUEST_PERMISSIONS Intent，結果從
     * onRequestPermissionsResult 回來，Expo 的 registerForActivityResult 在 release 包不會把它送回 launcher，
     * JS Promise 永不 resolve（2026-09-16 Seeker 實機）；requestPermissions 改依 Intent 種類分流，
     * 並以 OnActivityEntersForeground 作保底。
     */
    OnActivityResult { _, payload ->
      if (payload.requestCode != HC_PERMISSION_REQUEST_CODE) return@OnActivityResult
      val granted = runCatching { permissionContract.parseResult(payload.resultCode, payload.data) }.getOrNull()
      Log.i(TAG, "permission result: code=${payload.resultCode} granted=${granted?.size}")
      pendingPermission?.complete(granted)
    }

    OnActivityEntersForeground {
      val pending = pendingPermission ?: return@OnActivityEntersForeground
      // 正常路徑的結果緊接在 resume 之後送達（實機量測 ~2 ms），保底延後半秒讓真正的結果先到
      Handler(Looper.getMainLooper()).postDelayed({
        if (!pending.isCompleted) {
          Log.i(TAG, "permission dialog closed without result; resolving from granted set on resume")
          pending.complete(null)
        }
      }, FOREGROUND_FALLBACK_MS)
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
      val activity = appContext.currentActivity ?: throw CodedException("ERR_HC_LAUNCHER", "no current activity", null)
      pendingPermission?.complete(null)
      val deferred = CompletableDeferred<Set<String>?>()
      pendingPermission = deferred
      val intent = permissionContract.createIntent(activity, permissions.toSet())
      withContext(Dispatchers.Main) {
        val runtime = intent.getStringArrayExtra(RequestMultiplePermissions.EXTRA_PERMISSIONS)
        if (intent.action == RequestMultiplePermissions.ACTION_REQUEST_PERMISSIONS && runtime != null && activity is PermissionAwareActivity) {
          val listener = PermissionListener { code, names, results ->
            if (code != HC_PERMISSION_REQUEST_CODE) return@PermissionListener false
            val granted = names.filterIndexed { i, _ -> results.getOrNull(i) == PackageManager.PERMISSION_GRANTED }.toSet()
            Log.i(TAG, "runtime permission result: granted=${granted.size}/${names.size}")
            deferred.complete(granted)
            true
          }
          activity.requestPermissions(runtime, HC_PERMISSION_REQUEST_CODE, listener)
        } else {
          activity.startActivityForResult(intent, HC_PERMISSION_REQUEST_CODE)
        }
      }
      val granted = deferred.await()
      if (pendingPermission === deferred) pendingPermission = null
      // 使用者關閉對話框、或結果未回到 App 時，以 Health Connect 的實際授權狀態為準
      if (granted.isNullOrEmpty()) client.permissionController.getGrantedPermissions().toList() else granted.toList()
    }

    AsyncFunction("openSettings") {
      val intent = Intent(HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }

    /** 讀取 [startUnix, endUnix) 的步數；來源歸因與分鐘桶見 HealthReader（BR-07／08／10） */
    AsyncFunction("readSteps") Coroutine { startUnix: Double, endUnix: Double ->
      jsonToMap(reader.readSteps(Instant.ofEpochSecond(startUnix.toLong()), Instant.ofEpochSecond(endUnix.toLong())))
    }

    /** 結束時間落在 [startUnix, endUnix) 的睡眠 session（BR-05） */
    AsyncFunction("readSleepSessions") Coroutine { startUnix: Double, endUnix: Double ->
      jsonToMap(reader.readSleepSessions(Instant.ofEpochSecond(startUnix.toLong()), Instant.ofEpochSecond(endUnix.toLong())))
    }

    /** PG-R-02：結束時間落在 [startUnix, endUnix) 的跑步／健走 session 摘要（同來源 aggregate；無路線） */
    AsyncFunction("readExerciseSessions") Coroutine { startUnix: Double, endUnix: Double ->
      jsonToMap(reader.readExerciseSessions(Instant.ofEpochSecond(startUnix.toLong()), Instant.ofEpochSecond(endUnix.toLong())))
    }

    // ---- PG-A-19：背景同步（WorkManager）與快取 ----

    /** 排程週期背景同步；最短 15 分鐘（WorkManager 下限），不承諾準點 */
    AsyncFunction("scheduleBackgroundSync") { intervalMinutes: Int ->
      val minutes = intervalMinutes.coerceAtLeast(15).toLong()
      val request = PeriodicWorkRequestBuilder<HealthSyncWorker>(minutes, TimeUnit.MINUTES)
        .setConstraints(Constraints.Builder().setRequiresBatteryNotLow(true).build())
        .build()
      WorkManager.getInstance(context).enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.UPDATE, request)
      mapOf("scheduled" to true, "intervalMinutes" to minutes)
    }

    AsyncFunction("cancelBackgroundSync") {
      WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
    }

    /** 立即在背景執行一次（測試與回前景補同步用） */
    AsyncFunction("runBackgroundSyncNow") {
      WorkManager.getInstance(context).enqueue(OneTimeWorkRequestBuilder<HealthSyncWorker>().build())
    }

    /** 最近一次同步快取（前景或背景寫入）；無則 null */
    AsyncFunction("getCachedSummary") {
      HealthCache.read(context)?.let { jsonToMap(JSONObject(it)) }
    }

    /** 前景同步後由 JS 寫入，讓背景與前景共用同一份快取 */
    AsyncFunction("setCachedSummary") { json: String ->
      HealthCache.write(context, JSONObject(json))
    }

    AsyncFunction("clearCache") {
      HealthCache.clear(context)
    }
  }

  // ---------------------------------------------------------------- helpers

  private val reader: HealthReader by lazy { HealthReader(context) }

  private fun sdkExtension(): Int = reader.sdkExtension()
  private fun currentDeviceDataSource(): String? = reader.currentDeviceDataSource()

  /** org.json → Expo 可序列化的 Map／List */
  private fun jsonToMap(obj: JSONObject): Map<String, Any?> = obj.keys().asSequence().associateWith { k -> jsonValue(obj.get(k)) }
  private fun jsonValue(v: Any?): Any? = when (v) {
    JSONObject.NULL, null -> null
    is JSONObject -> jsonToMap(v)
    is JSONArray -> (0 until v.length()).map { jsonValue(v.get(it)) }
    else -> v
  }

  companion object {
    private const val TAG = "NeonshiftHealth"
    /** Health Connect 權限對話框的 request code（OnActivityResult／PermissionListener 依此過濾） */
    const val HC_PERMISSION_REQUEST_CODE = 0x4E53
    private const val FOREGROUND_FALLBACK_MS = 500L
    const val LEGACY_DEVICE_ORIGIN = HealthReader.LEGACY_DEVICE_ORIGIN
    const val SPN_QUERY_MIN_EXTENSION = HealthReader.SPN_QUERY_MIN_EXTENSION
    const val DEVICE_STEPS_MIN_EXTENSION = HealthReader.DEVICE_STEPS_MIN_EXTENSION
    const val WORK_NAME = "neonshift-health-sync"
  }
}
