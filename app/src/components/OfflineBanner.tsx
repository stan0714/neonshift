import { Feather } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useOnline } from '@/hooks/useOnline';
import { color, space, Text } from '@/theme';
import { useT } from '@/i18n';

/** Style 14：離線時固定在頂部的低干擾提示；資料顯示快取值，打卡等動作由各畫面停用並說明。 */
export function OfflineBanner() {
  const { t } = useT();
  const online = useOnline();
  const insets = useSafeAreaInsets();
  if (online) return null;
  return (
    <View style={[styles.banner, { paddingTop: insets.top + space.xxs }]} accessibilityRole="alert" accessibilityLiveRegion="polite" testID="offline-banner">
      <Feather name="wifi-off" size={14} color={color.warning} />
      <Text variant="label" tone="warning" style={styles.text}>
        {t('common.offlineBanner')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: color.surface, paddingBottom: space.xxs, borderBottomWidth: 1, borderBottomColor: color.borderSubtle },
  text: { marginLeft: space.xs },
});
