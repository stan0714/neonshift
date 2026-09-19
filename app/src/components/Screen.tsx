import { ScrollView, StyleSheet, View, type ScrollViewProps, type ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HabitatScene } from './HabitatScene';
import type { HabitatSceneKind } from '@/domain/appearance';
import { color, space, useTheme } from '@/theme';

export type ScreenProps = ViewProps & {
  /** 內容超過一屏時可捲動；表單與列表頁預設開啟 */
  scroll?: boolean;
  /** 已在 tab 內時不需再補 bottom inset */
  insideTabs?: boolean;
  /** 只在 scroll 模式生效：下拉更新 */
  refreshControl?: ScrollViewProps['refreshControl'];
  /** 跑鞋連動棲地背景（PG-LINK-01）：鋪在頁首／留白之下、不隨內容捲動；null＝基本背景 */
  scene?: HabitatSceneKind | null;
};

/**
 * 畫面基底：canvas 背景、6.1 水平 padding（20dp／≥600dp 32dp）、safe-area inset。
 * 主要 CTA 不得被 gesture navigation 遮擋（6.3）。
 */
export function Screen({ scroll = false, insideTabs = false, refreshControl, scene = null, style, children, ...rest }: ScreenProps) {
  const { screenPaddingX } = useTheme();
  const insets = useSafeAreaInsets();
  const padding = {
    paddingHorizontal: screenPaddingX,
    paddingTop: insets.top + space.m,
    paddingBottom: (insideTabs ? 0 : insets.bottom) + space.xl,
  };

  if (scroll) {
    const list = (
      <ScrollView
        style={scene ? styles.overScene : styles.root}
        contentContainerStyle={[padding, style]}
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl}
        {...rest}
      >
        {children}
      </ScrollView>
    );
    if (!scene) return list;
    return (
      <View style={styles.root}>
        <HabitatScene kind={scene} />
        {list}
      </View>
    );
  }
  return (
    <View style={[styles.root, padding, style]} {...rest}>
      {scene ? <HabitatScene kind={scene} /> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
  overScene: { flex: 1, backgroundColor: 'transparent' },
});
