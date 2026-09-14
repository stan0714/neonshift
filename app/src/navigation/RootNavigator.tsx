import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { color, motion } from '@/theme';
import { ActivityHistoryScreen } from '@/screens/ActivityHistoryScreen';
import { BootstrapScreen } from '@/screens/launch/BootstrapScreen';
import { DemoPreviewScreen } from '@/screens/launch/DemoPreviewScreen';
import { LandingScreen } from '@/screens/launch/LandingScreen';

import { MainTabs } from './MainTabs';
import { OnboardingNavigator } from './OnboardingNavigator';
import { navigationTheme } from './theme';
import type { RootParamList } from './types';

const Stack = createNativeStackNavigator<RootParamList>();

/** Root：Bootstrap → Landing → Onboarding → Main（SD 5.2）。頁面 transition ≤ 320ms（Style 15）。 */
export function RootNavigator() {
  return (
    <NavigationContainer theme={navigationTheme}>
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
            title: 'Activity',
            animation: 'slide_from_right',
            headerStyle: { backgroundColor: color.surface },
            headerTintColor: color.textPrimary,
          }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
