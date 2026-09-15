import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { color, typography } from './tokens';

type Variant = keyof typeof typography;
type Tone = 'primary' | 'secondary' | 'muted' | 'mint' | 'cyan' | 'violet' | 'success' | 'warning' | 'danger';

const toneColor: Record<Tone, string> = {
  primary: color.textPrimary,
  secondary: color.textSecondary,
  muted: color.textMuted,
  mint: color.mint,
  cyan: color.cyan,
  violet: color.violet,
  success: color.success,
  warning: color.warning,
  danger: color.danger,
};

export type TextProps = RNTextProps & {
  variant?: Variant;
  tone?: Tone;
  /** 5.2：數值使用 tabular numerals */
  numeric?: boolean;
  /** 5.2：全大寫只用於 20 字元內的 label */
  uppercase?: boolean;
};

/**
 * 主題化文字。預設 body／primary；5.2 規定 body 不小於 14sp，並支援 130% font scale。
 */
export function Text({ variant = 'body', tone = 'primary', numeric, uppercase, style, ...rest }: TextProps) {
  return (
    <RNText
      maxFontSizeMultiplier={1.3}
      {...rest}
      style={[
        typography[variant],
        { color: toneColor[tone] },
        numeric && { fontVariant: ['tabular-nums'] },
        uppercase && { textTransform: 'uppercase' },
        style,
      ]}
    />
  );
}
