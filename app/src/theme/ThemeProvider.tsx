import { createContext, useContext, type PropsWithChildren } from 'react';
import { useWindowDimensions } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { theme, type Theme } from './tokens';

type ThemeContextValue = Theme & {
  /** 目前視窗寬度對應的螢幕水平 padding（6.1：20dp，≥600dp 為 32dp） */
  screenPaddingX: number;
  isWide: boolean;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** App 固定深色主題（BRD FR-08.4）；不跟隨系統 light mode。 */
export function ThemeProvider({ children }: PropsWithChildren) {
  const { width } = useWindowDimensions();
  const isWide = width >= theme.layout.wideBreakpoint;
  const value: ThemeContextValue = {
    ...theme,
    isWide,
    screenPaddingX: isWide ? theme.layout.screenPaddingXWide : theme.layout.screenPaddingX,
  };
  return (
    <SafeAreaProvider>
      <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
    </SafeAreaProvider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme 必須在 ThemeProvider 內使用');
  return ctx;
}
