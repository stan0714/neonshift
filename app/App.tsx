import { StatusBar } from 'expo-status-bar';

import { useEffect } from 'react';

import { useLocaleStore } from '@/i18n';
import { RootNavigator } from '@/navigation';
import { ThemeProvider } from '@/theme';

export default function App() {
  // PG-A-23：啟動時讀取語言設定（system／en／zh-TW）
  useEffect(() => {
    void useLocaleStore.getState().load();
  }, []);
  return (
    <ThemeProvider>
      <RootNavigator />
      <StatusBar style="light" />
    </ThemeProvider>
  );
}
