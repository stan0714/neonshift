package expo.modules.neonshifthealth

import android.content.Context
import org.json.JSONObject

/**
 * 健康摘要快取（SD 5.3：只保存 UI 所需的最近摘要與同步時間）。
 * 使用 app 私有 SharedPreferences（受 Android 沙箱保護）；登出／刪除資料時由 JS 呼叫 clear。
 */
object HealthCache {
  private const val PREFS = "neonshift_health_cache"
  private const val KEY = "latest"

  fun write(context: Context, json: JSONObject) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, json.toString()).apply()
  }

  fun read(context: Context): String? = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null)

  fun clear(context: Context) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
  }
}
