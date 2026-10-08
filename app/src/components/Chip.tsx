import { StyleSheet, View, type ViewStyle } from 'react-native';

import { color, radius, space, Text } from '@/theme';

type Kind = 'devnet' | 'synced' | 'offline' | 'level' | 'neutral';

const kindStyle: Record<Kind, { border: string; text: 'warning' | 'success' | 'muted' | 'violet' | 'secondary' }> = {
  devnet: { border: color.warning, text: 'warning' },
  synced: { border: color.success, text: 'success' },
  offline: { border: color.textMuted, text: 'muted' },
  level: { border: color.violet, text: 'violet' },
  neutral: { border: color.borderSubtle, text: 'secondary' },
};

export type ChipProps = {
  label: string;
  kind?: Kind;
  style?: ViewStyle;
  accessibilityLabel?: string;
};

/**
 * 7.6 Chips and badges。`DEVNET` warning outline、`SYNCED` 需附時間、`LV. 3` violet。
 * 不得只靠顏色區分，label 文字本身必須表達狀態。
 */
export function Chip({ label, kind = 'neutral', style, accessibilityLabel }: ChipProps) {
  const k = kindStyle[kind];
  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel ?? label}
      style={[styles.chip, { borderColor: k.border }, style]}
    >
      {/* 徽章一律單行：Android highQuality 斷行與量測差一點就會換行，第二行被圓角裁掉（10/2 Workouts 篩選實機） */}
      <Text variant="label" tone={k.text} uppercase numberOfLines={1} textBreakStrategy="simple">
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: radius.s,
    paddingHorizontal: space.xs,
    paddingVertical: space.xxs,
  },
});
