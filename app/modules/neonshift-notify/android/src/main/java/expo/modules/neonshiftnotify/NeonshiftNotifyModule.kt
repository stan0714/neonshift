package expo.modules.neonshiftnotify

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/**
 * 通知頻道（PG-R-03 記錄中常駐通知）。
 * expo-location 的前景服務會用「任務名稱」當頻道 id、且以 IMPORTANCE_LOW 建立 → 通知落在「靜音」區、狀態列沒有圖示，
 * 使用者退到背景後看不出 App 還在記錄。頻道的重要性只能在建立當下決定，所以 App 在開始定位前先以 DEFAULT 建好同 id 的頻道
 * （無聲、不震動；已存在就不動，尊重使用者在系統設定裡的調整）。
 */
class NeonshiftNotifyModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  class ChannelOptions : Record {
    @Field val id: String = ""
    @Field val name: String = ""
    @Field val description: String = ""
    /** "default"｜"low"｜"high" */
    @Field val importance: String = "default"
    /** expo-location 的頻道 id 是 `<packageName>:<taskName>`；true 時自動加上套件名前綴 */
    @Field val scopedToPackage: Boolean = false
  }

  override fun definition() = ModuleDefinition {
    Name("NeonshiftNotify")

    /** 回傳頻道目前的重要性（建立後由系統／使用者決定），供畫面提示「通知已被靜音」 */
    Function("ensureChannel") { options: ChannelOptions ->
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      val id = if (options.scopedToPackage) "${context.packageName}:${options.id}" else options.id
      val existing = manager.getNotificationChannel(id)
      if (existing == null) {
        val importance = when (options.importance) {
          "low" -> NotificationManager.IMPORTANCE_LOW
          "high" -> NotificationManager.IMPORTANCE_HIGH
          else -> NotificationManager.IMPORTANCE_DEFAULT
        }
        val channel = NotificationChannel(id, options.name, importance).apply {
          description = options.description
          setSound(null, null)
          enableVibration(false)
          setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
      }
      val current = manager.getNotificationChannel(id)?.importance ?: NotificationManager.IMPORTANCE_UNSPECIFIED
      mapOf(
        "importance" to current,
        "silenced" to (current < NotificationManager.IMPORTANCE_DEFAULT),
        "appNotificationsEnabled" to manager.areNotificationsEnabled(),
      )
    }
  }
}
