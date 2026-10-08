import { StatusBar } from 'expo-status-bar';

import { useEffect } from 'react';

import { useLocaleStore } from '@/i18n';
import { installWorkoutCues } from '@/services/workouts/cueController';
import { RootNavigator } from '@/navigation';
import { ThemeProvider } from '@/theme';

export default function App() {
  // PG-A-23：啟動時讀取語言設定（system／en／zh-TW）
  useEffect(() => {
    void useLocaleStore.getState().load();
  }, []);
  // 2026-09-19 review 7：運動提示以 session 驅動，與記錄頁生命週期無關
  useEffect(() => installWorkoutCues(), []);
  return (
    <ThemeProvider>
      <RootNavigator />
      <StatusBar style="light" />
    </ThemeProvider>
  );
}
