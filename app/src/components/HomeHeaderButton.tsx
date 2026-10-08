import Feather from '@expo/vector-icons/Feather';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Pressable, StyleSheet } from 'react-native';

import { useT } from '@/i18n';
import type { RootParamList } from '@/navigation/types';
import { color, Text } from '@/theme';

/**
 * 疊在 Main 之上的頁面看不到底部分頁列，離開只能靠返回鍵——而返回去哪要看是從哪裡進來的。
 * 標題列右側給一個固定的回首頁出口，位置與 Activity 頁右上角一致。
 */
export function HomeHeaderButton() {
  const navigation = useNavigation<NativeStackNavigationProp<RootParamList>>();
  const { t } = useT();
  return (
    <Pressable onPress={() => navigation.navigate('Main', { screen: 'Home' })} accessibilityRole="button" accessibilityLabel={t('actv.home')} hitSlop={8} style={styles.btn} testID="header-home">
      <Feather name="home" size={16} color={color.mint} />
      <Text variant="label" tone="mint">{t('actv.home')}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({ btn: { flexDirection: 'row', alignItems: 'center', gap: 4 } });
