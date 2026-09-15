import { ScrollView, StyleSheet, View, type ScrollViewProps, type ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, space, useTheme } from '@/theme';

export type ScreenProps = ViewProps & {
  /** 內容超過一屏時可捲動；表單與列表頁預設開啟 */
  scroll?: boolean;
  /** 已在 tab 內時不需再補 bottom inset */
  insideTabs?: boolean;
  /** 只在 scroll 模式生效：下拉更新 */
  refreshControl?: ScrollViewProps['refreshControl'];
};

/**
 * 畫面基底：canvas 背景、6.1 水平 padding（20dp／≥600dp 32dp）、safe-area inset。
 * 主要 CTA 不得被 gesture navigation 遮擋（6.3）。
 */
export function Screen({ scroll = false, insideTabs = false, refreshControl, style, children, ...rest }: ScreenProps) {
  const { screenPaddingX } = useTheme();
  const insets = useSafeAreaInsets();
  const padding = {
    paddingHorizontal: screenPaddingX,
    paddingTop: insets.top + space.m,
    paddingBottom: (insideTabs ? 0 : insets.bottom) + space.xl,
  };

  if (scroll) {
    return (
      <ScrollView
        style={styles.root}
        contentContainerStyle={[padding, style]}
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl}
        {...rest}
      >
        {children}
      </ScrollView>
    );
  }
  return (
    <View style={[styles.root, padding, style]} {...rest}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
});
