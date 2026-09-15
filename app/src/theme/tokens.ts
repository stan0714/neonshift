/**
 * 設計 token —— 唯一的 theme 來源（Style Guide 18）。
 * 名稱沿用 docs/style.md 第 4～6、15 章；screen 內禁止直接散落 hex／radius／duration。
 * 若調整任何值，必須同步更新 docs/style.md 與視覺回歸基準圖。
 */
export const color = {
  // 4.1 Base palette
  canvas: '#050711',
  surface: '#0B1020',
  elevated: '#121A2E',
  scrim: '#02040BCC',
  borderSubtle: '#26324A',
  borderActive: '#30EBC8',
  textPrimary: '#F4F8FF',
  textSecondary: '#AAB7CC',
  textMuted: '#718099',
  mint: '#30EBC8',
  cyan: '#24C8FF',
  violet: '#9B6CFF',
  magenta: '#FF4FD8',
  success: '#4BE39A',
  warning: '#FFCB66',
  danger: '#FF6B7A',
  /** Primary button 文字（7.1） */
  onMint: '#04110E',
} as const;

// 4.2 Gradients；expo-linear-gradient 的 colors 參數
export const gradient = {
  brand: ['#30EBC8', '#24C8FF', '#9B6CFF'],
  gear: ['#9B6CFF', '#FF4FD8'],
  surface: ['#121A2E', '#090D19'],
} as const;

// 4.3 Glow：以 RN shadow 實作，不用高模糊半徑即時動畫
export const glow = {
  small: { radius: 8, opacity: 0.2 },
  medium: { radius: 16, opacity: 0.24 },
  hero: { radius: 32, opacity: 0.18 },
} as const;

// 6.1 Spacing（4dp 基準）
export const space = {
  xxs: 4,
  xs: 8,
  s: 12,
  m: 16,
  l: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  huge: 48,
  hero: 64,
} as const;

// 6.2 Radius and border
export const radius = { s: 8, m: 12, l: 20, xl: 28 } as const;
export const border = { default: 1, focus: 2 } as const;

// 6.1 版面常數
export const layout = {
  screenPaddingX: 20,
  screenPaddingXWide: 32,
  wideBreakpoint: 600,
  bottomNavHeight: 72,
  minTouchTarget: 48,
  buttonHeight: 52,
} as const;

// 5.2 Type scale（size / lineHeight / weight）
export const typography = {
  displayL: { fontSize: 40, lineHeight: 44, fontWeight: '700' },
  displayM: { fontSize: 32, lineHeight: 36, fontWeight: '700' },
  heading1: { fontSize: 24, lineHeight: 30, fontWeight: '700' },
  heading2: { fontSize: 20, lineHeight: 26, fontWeight: '600' },
  title: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  bodySmall: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
  label: { fontSize: 12, lineHeight: 16, fontWeight: '600', letterSpacing: 0.8 },
  caption: { fontSize: 11, lineHeight: 16, fontWeight: '500' },
} as const;

// 15. Motion & Haptics
export const motion = {
  fast: 120,
  normal: 220,
  slow: 320,
  celebration: 800,
  /** cubic-bezier(0.2, 0.8, 0.2, 1) */
  easing: [0.2, 0.8, 0.2, 1] as const,
  /** 7.1 Pressed：scale 最多 0.98 */
  pressedScale: 0.98,
} as const;

export const theme = { color, gradient, glow, space, radius, border, layout, typography, motion } as const;
export type Theme = typeof theme;
