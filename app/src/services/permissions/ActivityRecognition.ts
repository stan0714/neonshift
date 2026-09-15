import { PermissionsAndroid, Platform } from 'react-native';

/** ACTIVITY_RECOGNITION（Style 10.3）：TYPE_STEP_COUNTER 於 Android 10+ 需要此 runtime 權限 */
const PERMISSION = 'android.permission.ACTIVITY_RECOGNITION' as const;

export type ActivityPermissionResult = 'granted' | 'denied' | 'never_ask_again';

export const activityRecognition = {
  async check(): Promise<boolean> {
    if (Platform.OS !== 'android') return false;
    return PermissionsAndroid.check(PERMISSION);
  },
  async request(): Promise<ActivityPermissionResult> {
    if (Platform.OS !== 'android') return 'denied';
    const r = await PermissionsAndroid.request(PERMISSION);
    if (r === PermissionsAndroid.RESULTS.GRANTED) return 'granted';
    if (r === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) return 'never_ask_again';
    return 'denied';
  },
};
