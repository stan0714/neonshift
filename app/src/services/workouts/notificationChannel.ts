import { WORKOUT_LOCATION_TASK } from './locationTask';

export type WorkoutChannelState = { importance: number; silenced: boolean; appNotificationsEnabled: boolean };

/**
 * 記錄中常駐通知的頻道（實機回饋：退到背景後看不出 App 還在記錄）。
 * expo-location 用任務名稱當頻道 id、以 IMPORTANCE_LOW 建立 → 落在「靜音」區、狀態列無圖示；重要性只能在建立時決定，
 * 所以開始記錄前先以 DEFAULT 建好同 id 頻道（無聲、不震動）。回傳目前狀態，畫面據此提示使用者到系統設定解除靜音。
 * 原生模組不存在（非 Android／測試）時回 null，不影響記錄。App 為 Android only，不另做平台判斷。
 */
export function ensureWorkoutChannel(labels: { name: string; description: string }): WorkoutChannelState | null {
  try {
    // 動態載入：Jest／非 Android 平台不需要原生模組
    const { NeonshiftNotify } = require('../../../modules/neonshift-notify') as typeof import('../../../modules/neonshift-notify');
    // expo-location 的頻道 id 是 `<packageName>:<taskName>`（LocationTaskService.mChannelId）
    return NeonshiftNotify.ensureChannel({ id: WORKOUT_LOCATION_TASK, scopedToPackage: true, name: labels.name, description: labels.description, importance: 'default' });
  } catch {
    return null;
  }
}
