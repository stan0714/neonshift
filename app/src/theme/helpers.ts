import type { ViewStyle } from 'react-native';

import { glow, layout, type color } from './tokens';

type GlowLevel = keyof typeof glow;
type NeonColor = (typeof color)[keyof typeof color];

/**
 * 4.3 Glow：Android 以 elevation + shadowColor 近似；不得用於 error、長文或整張 card。
 */
export function glowStyle(level: GlowLevel, tint: NeonColor): ViewStyle {
  const g = glow[level];
  return {
    shadowColor: tint,
    shadowOpacity: g.opacity,
    shadowRadius: g.radius,
    shadowOffset: { width: 0, height: 0 },
    elevation: Math.round(g.radius / 2),
  };
}

export function screenPaddingX(width: number): number {
  return width >= layout.wideBreakpoint ? layout.screenPaddingXWide : layout.screenPaddingX;
}
