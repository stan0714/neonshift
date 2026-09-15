import { DarkTheme, type Theme as NavTheme } from '@react-navigation/native';

import { color } from '@/theme';

/** React Navigation 的顏色統一取自 design token，避免預設灰色閃現。 */
export const navigationTheme: NavTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: color.mint,
    background: color.canvas,
    card: color.surface,
    text: color.textPrimary,
    border: color.borderSubtle,
    notification: color.magenta,
  },
};
