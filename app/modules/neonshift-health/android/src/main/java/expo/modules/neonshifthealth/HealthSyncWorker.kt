package expo.modules.neonshifthealth

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import org.json.JSONObject
import java.time.Instant

/**
 * 背景同步（PG-A-19，FR-02.3）：WorkManager 以最短 15 分鐘週期讀取「今日 UTC 任務日」的
 * 步數摘要並寫入本機快取；App 開啟／回前景仍會強制前景同步，背景只是補強。
 * 需要 READ_HEALTH_DATA_IN_BACKGROUND；未授權時工作直接成功結束（不重試轟炸）。
 */
class HealthSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  override suspend fun doWork(): Result {
    val reader = HealthReader(applicationContext)
    return try {
      val nowSec = Instant.now().epochSecond
      val taskDate = Math.floorDiv(nowSec, 86_400L)
      val start = Instant.ofEpochSecond(taskDate * 86_400L)
      val end = Instant.ofEpochSecond((taskDate + 1) * 86_400L)
      val steps = reader.readSteps(start, end)
      // Sleep is disabled in this build; retain an empty field for cache compatibility.
      val sleep = JSONObject().put("sessions", org.json.JSONArray())
      HealthCache.write(applicationContext, JSONObject()
        .put("taskDate", taskDate)
        .put("steps", steps)
        .put("sleep", sleep)
        .put("syncedAt", System.currentTimeMillis())
        .put("source", "background"))
      Result.success()
    } catch (e: SecurityException) {
      // 背景權限未授予：不重試
      Result.success()
    } catch (e: Exception) {
      if (runAttemptCount < 3) Result.retry() else Result.failure()
    }
  }
}
