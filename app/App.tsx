import { StatusBar } from 'expo-status-bar';

import { RootNavigator } from '@/navigation';
import { ThemeProvider } from '@/theme';

export default function App() {
  return (
    <ThemeProvider>
      <RootNavigator />
      <StatusBar style="light" />
    </ThemeProvider>
  );
}
