import { ActivityIndicator, Pressable, StyleSheet, View, type PressableProps, type ViewStyle } from 'react-native';

import { color, glowStyle, layout, motion, radius, space, Text } from '@/theme';

type Variant = 'primary' | 'secondary' | 'danger' | 'dangerFill';

export type ButtonProps = Omit<PressableProps, 'style' | 'children'> & {
  label: string;
  variant?: Variant;
  loading?: boolean;
  /** Loading 時保留動詞，例如 `Submitting…`（7.1） */
  loadingLabel?: string;
  /** Disabled 時保留原因文字（7.1） */
  disabledReason?: string;
  style?: ViewStyle;
};

/**
 * 7.1 Buttons。高度 52dp、radius.m；一頁只放一個視覺 primary。
 * Pressed：亮度降 8%、scale ≤ 0.98；Disabled：surface 灰底、muted 文字、無 glow。
 */
export function Button({
  label,
  variant = 'primary',
  loading = false,
  loadingLabel,
  disabledReason,
  disabled,
  style,
  ...rest
}: ButtonProps) {
  const isDisabled = Boolean(disabled) || loading;
  const v = styles[variant];
  const labelTone = isDisabled ? 'muted' : variant === 'primary' ? undefined : variant === 'secondary' ? 'primary' : 'danger';

  return (
    <View style={style}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: isDisabled, busy: loading }}
        disabled={isDisabled}
        {...rest}
        style={({ pressed }) => [
          styles.base,
          v,
          !isDisabled && variant === 'primary' && glowStyle('medium', color.mint),
          isDisabled && styles.disabled,
          pressed && !isDisabled && styles.pressed,
        ]}
      >
        {loading && (
          <ActivityIndicator
            size="small"
            color={variant === 'primary' ? color.onMint : color.textSecondary}
            style={styles.spinner}
          />
        )}
        {/* 按鈕高度固定：文字換行會被切掉（2026-10-04 實機：半寬的「Health Connect settings」第三行不見）。
            一律單行，放不下就縮字，最小 0.7 倍 */}
        <Text
          variant="title"
          tone={labelTone}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
          style={[styles.label, !isDisabled && variant === 'primary' && { color: color.onMint }, variant === 'dangerFill' && !isDisabled && { color: color.textPrimary }]}
        >
          {loading ? (loadingLabel ?? label) : label}
        </Text>
      </Pressable>
      {isDisabled && !loading && disabledReason ? (
        <Text variant="caption" tone="muted" style={styles.reason}>
          {disabledReason}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    height: layout.buttonHeight,
    minWidth: layout.minTouchTarget,
    borderRadius: radius.m,
    paddingHorizontal: space.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { flexShrink: 1, textAlign: 'center' },
  primary: { backgroundColor: color.mint },
  secondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: color.violet },
  danger: { backgroundColor: 'transparent', borderWidth: 1, borderColor: color.danger },
  dangerFill: { backgroundColor: color.danger },
  disabled: { backgroundColor: color.surface, borderWidth: 1, borderColor: color.borderSubtle },
  pressed: { opacity: 0.92, transform: [{ scale: motion.pressedScale }] },
  spinner: { marginRight: space.xs },
  reason: { marginTop: space.xs, textAlign: 'center' },
});
