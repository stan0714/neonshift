import { NativeModule, requireNativeModule } from 'expo';

export type ChannelOptions = { id: string; name: string; description: string; importance?: 'default' | 'low' | 'high'; /** expo-location 的頻道 id 為 `<packageName>:<taskName>` */ scopedToPackage?: boolean };
/** importance：Android NotificationManager.IMPORTANCE_*（0 none、1 min、2 low、3 default、4 high） */
export type ChannelState = { importance: number; silenced: boolean; appNotificationsEnabled: boolean };

declare class NeonshiftNotifyModule extends NativeModule {
  ensureChannel(options: ChannelOptions): ChannelState;
}

export default requireNativeModule<NeonshiftNotifyModule>('NeonshiftNotify');
