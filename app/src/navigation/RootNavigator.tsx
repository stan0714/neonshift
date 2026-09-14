import { NavigationContainer, type LinkingOptions } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { color, motion } from '@/theme';
import { ActivityHistoryScreen } from '@/screens/ActivityHistoryScreen';
import { EventDetailScreen, EventsScreen } from '@/screens/events/EventScreens';
import { GalleryPlayerScreen, GalleryScreen } from '@/screens/gallery/GalleryScreens';
import { BootstrapScreen } from '@/screens/launch/BootstrapScreen';
import { DemoPreviewScreen } from '@/screens/launch/DemoPreviewScreen';
import { HealthDiagnosticsScreen } from '@/screens/dev/HealthDiagnosticsScreen';
import { LandingScreen } from '@/screens/launch/LandingScreen';

import { MainTabs } from './MainTabs';
import { OnboardingNavigator } from './OnboardingNavigator';
import { navigationTheme } from './theme';
import type { RootParamList } from './types';
import { useT } from '@/i18n';

const Stack = createNativeStackNavigator<RootParamList>();

/**
 * Deep link（scheme `neonshift://`，SD 8）。正式路徑之後由 MWA 回呼與 App Links（11.4）補齊；
 * `dev/*` 只在 __DEV__ 註冊，供 adb 直接開啟診斷頁做實機驗證。
 */
const linking: LinkingOptions<RootParamList> = {
  prefixes: ['neonshift://', 'https://neonshift.cc'],
  config: {
    screens: {
      Landing: 'landing',
      DemoPreview: 'preview',
      EventDetail: { path: 'e/:idOrSlug', parse: { idOrSlug: String, source: String, tag: String } },
      ...(__DEV__ ? { DevHealth: 'dev/health' } : {}),
    },
  },
};

/** Root：Bootstrap → Landing → Onboarding → Main（SD 5.2）。頁面 transition ≤ 320ms（Style 15）。 */
export function RootNavigator() {
  const { t } = useT();
  return (
    <NavigationContainer theme={navigationTheme} linking={linking}>
      <Stack.Navigator
        initialRouteName="Bootstrap"
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: color.canvas },
          animation: 'fade',
          animationDuration: motion.normal,
        }}
      >
        <Stack.Screen name="Bootstrap" component={BootstrapScreen} options={{ animation: 'none' }} />
        <Stack.Screen name="Landing" component={LandingScreen} />
        <Stack.Screen name="DemoPreview" component={DemoPreviewScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="Onboarding" component={OnboardingNavigator} />
        <Stack.Screen name="Main" component={MainTabs} />
        <Stack.Screen
          name="ActivityHistory"
          component={ActivityHistoryScreen}
          options={{
            headerShown: true,
            title: t('nav.activity'),
            animation: 'slide_from_right',
            headerStyle: { backgroundColor: color.surface },
            headerTintColor: color.textPrimary,
          }}
        />
        <Stack.Screen name="Gallery" component={GalleryScreen} options={{ headerShown: true, title: t('nav.gallery'), animation: 'slide_from_right', headerStyle: { backgroundColor: color.surface }, headerTintColor: color.textPrimary }} />
        <Stack.Screen name="GalleryPlayer" component={GalleryPlayerScreen} options={{ headerShown: true, title: t('nav.player'), animation: 'slide_from_right', headerStyle: { backgroundColor: color.surface }, headerTintColor: color.textPrimary }} />
        <Stack.Screen name="Events" component={EventsScreen} options={{ headerShown: true, title: t('nav.events'), animation: 'slide_from_right', headerStyle: { backgroundColor: color.surface }, headerTintColor: color.textPrimary }} />
        <Stack.Screen name="EventDetail" component={EventDetailScreen} options={{ headerShown: true, title: t('nav.event'), animation: 'slide_from_right', headerStyle: { backgroundColor: color.surface }, headerTintColor: color.textPrimary }} />
        {__DEV__ ? <Stack.Screen name="DevHealth" component={HealthDiagnosticsScreen} options={{ headerShown: true, title: 'Health Connect (dev)', headerStyle: { backgroundColor: color.surface }, headerTintColor: color.textPrimary }} /> : null}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
