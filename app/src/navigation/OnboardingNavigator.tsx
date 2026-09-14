import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { color, motion } from '@/theme';
import { ActivityRecognitionScreen } from '@/screens/onboarding/ActivityRecognitionScreen';
import { HealthAccessScreen } from '@/screens/onboarding/HealthAccessScreen';
import { StarterShoeScreen } from '@/screens/onboarding/StarterShoeScreen';
import { WalletConnectScreen } from '@/screens/onboarding/WalletConnectScreen';

import type { OnboardingParamList } from './types';

const Stack = createNativeStackNavigator<OnboardingParamList>();

/** Onboarding 四頁權限流程（Style 10）；畫面內容由 PG-A-11 實作。 */
export function OnboardingNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: color.canvas },
        animation: 'slide_from_right',
        animationDuration: motion.normal,
      }}
    >
      <Stack.Screen name="WalletConnect" component={WalletConnectScreen} />
      <Stack.Screen name="HealthAccess" component={HealthAccessScreen} />
      <Stack.Screen name="ActivityRecognition" component={ActivityRecognitionScreen} />
      <Stack.Screen name="StarterShoe" component={StarterShoeScreen} />
    </Stack.Navigator>
  );
}
