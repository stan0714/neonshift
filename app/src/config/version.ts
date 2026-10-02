/**
 * App 版本字串（給畫面與送往後端的 client 資訊共用）。
 *
 * 2026-10-02：實機測試時沒有任何地方看得到版本，裝了哪一包只能靠 `adb shell dumpsys package`；
 * 而送給後端的 `app_version` 一直是寫死的 '0.1.0'，伺服器那邊也分不出 v13 與 v14。
 * 兩者都改成從原生 build 讀：versionName 來自 `nativeApplicationVersion`，
 * versionCode 來自 `nativeBuildVersion`（Android 回的是字串）。
 */
import * as Application from 'expo-application';

/** versionName，例如 `0.1.0`。讀不到時退回 build.gradle 的值，不顯示空字串 */
export const APP_VERSION = Application.nativeApplicationVersion ?? '0.1.0';

/** versionCode，例如 `14`。讀不到時為 null —— 顯示端要自己處理，不要印 "null" */
export const APP_BUILD = Application.nativeBuildVersion ?? null;

/** 給人看的一行：`0.1.0 (14)`；拿不到 build 就只給版號 */
export const APP_VERSION_DISPLAY = APP_BUILD ? `${APP_VERSION} (${APP_BUILD})` : APP_VERSION;
