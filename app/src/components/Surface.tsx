import { StyleSheet, View, type ViewProps } from 'react-native';

import { border, color, radius, space } from '@/theme';

export type SurfaceProps = ViewProps & {
  /** `elevated` 用於浮層與選中區塊 */
  level?: 'surface' | 'elevated';
  /** 7.3 Ready 狀態的 mint border */
  active?: boolean;
  /** 7.4 Hero card 使用 radius.xl */
  hero?: boolean;
};

/** Card／sheet 基底：6.2 radius.l、1dp subtle border、16–20dp 內距。 */
export function Surface({ level = 'surface', active, hero, style, ...rest }: SurfaceProps) {
  return (
    <View
      {...rest}
      style={[
        styles.base,
        { backgroundColor: color[level] },
        hero && styles.hero,
        active && styles.active,
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.l,
    borderWidth: border.default,
    borderColor: color.borderSubtle,
    padding: space.m,
  },
  hero: { borderRadius: radius.xl, padding: space.l },
  active: { borderColor: color.borderActive },
});
