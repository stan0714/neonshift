import { Feather } from '@expo/vector-icons';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Surface } from '@/components/Surface';
import { useT } from '@/i18n';
import { color, space, Text } from '@/theme';

/**
 * 底部面板（Style 24.5）：scrim＋貼底 Surface；關閉走 onRequestClose（返回鍵）與 scrim 點擊。
 * - `footer`（完成／領取）固定在面板底部、永遠可見；只有 body 可捲動（Seeker 實機：按鈕曾被裁掉在畫面外）。
 * - Modal 以 edge-to-edge 繪製（statusBar／navigationBarTranslucent），否則 Android 16 的手勢列高度不在 Modal 視窗內，面板底部被切；底部再補安全區。
 * - scrim 是面板的「兄弟」而不是父層 Pressable：Android 上 Pressable 祖先成為 responder 會擋掉原生 ScrollView 捲動（實機：長內容捲不動）。
 */
export function Sheet({ visible, onClose, title, children, footer, testID }: { visible: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode; testID: string }) {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('common.close')} testID={`${testID}-scrim`} />
        <View style={styles.sheetWrap} pointerEvents="box-none">
          <Surface hero style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, space.m) + space.s }]} testID={testID}>
            <View style={styles.sheetHead}>
              <Text variant="heading2" style={styles.title} numberOfLines={1}>
                {title}
              </Text>
              <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t('common.close')} hitSlop={12} style={styles.sheetClose} testID={`${testID}-close`}>
                <Feather name="x" size={22} color={color.textSecondary} />
              </Pressable>
            </View>
            <ScrollView style={styles.sheetBody} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} testID={`${testID}-body`}>
              {children}
            </ScrollView>
            {footer ? <View style={styles.sheetActions}>{footer}</View> : null}
          </Surface>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.scrim, justifyContent: 'flex-end' },
  sheetWrap: { width: '100%', maxHeight: '88%', justifyContent: 'flex-end' },
  sheet: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, flexShrink: 1 },
  sheetBody: { flexGrow: 0, flexShrink: 1 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.xs },
  title: { flex: 1, marginRight: space.s },
  sheetClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  sheetActions: { flexDirection: 'row', gap: space.s, marginTop: space.l },
});
