import { ApprovalNotice } from '@/components/ApprovalNotice';
import { useEffect, useState } from 'react';
import { CommonActions, useNavigation, StackActions } from '@react-navigation/native';
import { workoutRecorder } from '@/services/workouts/WorkoutRecorder';
import { GameGuideScreen } from '@/screens/GameGuideScreen';
import { NavigationContainer, useNavigationContainerRef, type LinkingOptions } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { HomeHeaderButton } from '@/components/HomeHeaderButton';
import { color, motion } from '@/theme';
import { ActivityHistoryScreen } from '@/screens/ActivityHistoryScreen';
import { ExploreScreen } from '@/screens/ExploreScreen';
import { AchievementDetailScreen } from '@/screens/gallery/AchievementDetailScreen';
import { WorkoutsScreen } from '@/screens/WorkoutsScreen';
import { ActivityScreen } from '@/screens/activity/ActivityScreen';
import { ActivityDetailScreen } from '@/screens/activity/ActivityDetailScreen';
import { WorkoutRecordScreen } from '@/screens/workouts/WorkoutRecordScreen';
import { WorkoutStartScreen } from '@/screens/workouts/WorkoutStartScreen';
import { PassportScreen } from '@/screens/PassportScreen';
import { WorkoutSummaryScreen } from '@/screens/workouts/WorkoutSummaryScreen';
import { EventDetailScreen, EventsScreen } from '@/screens/events/EventScreens';
import { StaffCheckInScreen } from '@/screens/events/StaffCheckInScreen';
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
      WorkoutReturn: 'workout-return',
      DemoPreview: 'preview',
      EventDetail: { path: 'e/:idOrSlug', parse: { idOrSlug: String, source: String, tag: String } },
      ...(__DEV__ ? { DevHealth: 'dev/health' } : {}),
    },
  },
};

/** Root：Bootstrap → Landing → Onboarding → Main（SD 5.2）。頁面 transition ≤ 320ms（Style 15）。 */
export function RootNavigator() {
  const navRef = useNavigationContainerRef<RootParamList>();
  const [approvalVisible, setApprovalVisible] = useState(false);
  const updateApprovalVisibility = () => setApprovalVisible(['Main', 'Home', 'ActivityTab', 'Gear', 'Arena', 'Profile', 'Workouts', 'Events', 'EventDetail', 'Gallery', 'Activity'].includes(navRef.getCurrentRoute()?.name ?? ''));
  const { t } = useT();
  return (
    <NavigationContainer ref={navRef} onReady={updateApprovalVisibility} onStateChange={updateApprovalVisibility} theme={navigationTheme} linking={linking}>
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
        <Stack.Screen name="GameGuide" component={GameGuideScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="Landing" component={LandingScreen} />
        <Stack.Screen name="DemoPreview" component={DemoPreviewScreen} options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="Onboarding" component={OnboardingNavigator} />
        <Stack.Screen name="Main" component={MainTabs} />
        <Stack.Screen name="Explore" component={ExploreScreen} options={{ headerShown: true, title: t('nav.explore'), animation: 'slide_from_right', headerStyle: { backgroundColor: color.surface }, headerTintColor: color.textPrimary }} />
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
        <Stack.Screen name="AchievementDetail" component={AchievementDetailScreen} options={{ headerShown: true, title: t('nftd.title'), animation: 'slide_from_right', headerStyle: { backgroundColor: color.surface }, headerTintColor: color.textPrimary }} />
        <Stack.Screen name="Activity" component={ActivityScreen} options={{ headerShown: true, title: t('actv.title'), animation: 'slide_from_right', headerStyle: { backgroundColor: color.surface }, headerTintColor: color.textPrimary }} />
        <Stack.Screen name="ActivityDetail" component={ActivityDetailScreen} options={{ headerShown: true, title: t('actv.detail.title'), animation: 'slide_from_right', headerStyle: { backgroundColor: color.surface }, headerTintColor: color.textPrimary, headerRight: () => <HomeHeaderButton /> }} />
        <Stack.Screen name="Passport" component={PassportScreen} options={{ headerShown: true, title: t('pass.title'), animation: 'slide_from_right', headerStyle: { backgroundColor: color.surface }, headerTintColor: color.textPrimary }} />
        <Stack.Screen name="Workouts" component={WorkoutsScreen} options={{ headerShown: true, title: t('nav.workouts'), animation: 'slide_from_right', headerStyle: { backgroundColor: color.surface }, headerTintColor: color.textPrimary, headerRight: () => <HomeHeaderButton /> }} />
        <Stack.Screen name="WorkoutStart" component={WorkoutStartScreen} options={{ headerShown: true, title: t('rec.start.title'), animation: 'slide_from_right', headerStyle: { backgroundColor: color.surface }, headerTintColor: color.textPrimary, headerRight: () => <HomeHeaderButton /> }} />
        <Stack.Screen name="WorkoutReturn" component={WorkoutReturnScreen} />
        <Stack.Screen name="WorkoutRecord" component={WorkoutRecordScreen} options={{ headerShown: false, gestureEnabled: false, animation: 'fade' }} />
        <Stack.Screen name="WorkoutSummary" component={WorkoutSummaryScreen} options={{ headerShown: true, title: t('sum.title'), headerBackVisible: false, animation: 'slide_from_right', headerStyle: { backgroundColor: color.surface }, headerTintColor: color.textPrimary, headerRight: () => <HomeHeaderButton /> }} />
        <Stack.Screen name="Events" component={EventsScreen} options={{ headerShown: true, title: t('nav.events'), animation: 'slide_from_right', headerStyle: { backgroundColor: color.surface }, headerTintColor: color.textPrimary }} />
        <Stack.Screen name="EventDetail" component={EventDetailScreen} options={{ headerShown: true, title: t('nav.event'), animation: 'slide_from_right', headerStyle: { backgroundColor: color.surface }, headerTintColor: color.textPrimary }} />
        <Stack.Screen name="StaffCheckIn" component={StaffCheckInScreen} options={{ headerShown: true, title: t('staff.title'), animation: 'slide_from_right', headerStyle: { backgroundColor: color.surface }, headerTintColor: color.textPrimary }} />
        {__DEV__ ? <Stack.Screen name="DevHealth" component={HealthDiagnosticsScreen} options={{ headerShown: true, title: 'Health Connect (dev)', headerStyle: { backgroundColor: color.surface }, headerTintColor: color.textPrimary }} /> : null}
      </Stack.Navigator>
      <ApprovalNotice visible={approvalVisible} onOpen={item => {
        if (!navRef.isReady()) return;
        const eventId = item.kind === 'event' ? item.milestone_key?.split('|')[1] : undefined;
        if (eventId) navRef.dispatch(StackActions.push('EventDetail', { idOrSlug: eventId }));
        else navRef.dispatch(StackActions.push('Workouts'));
      }} />
    </NavigationContainer>
  );
}


// A stale notification never starts a new recording or resumes GPS automatically.
function WorkoutReturnScreen() {
  const navigation = useNavigation();
  useEffect(() => {
    const target = workoutRecorder.active() ? 'WorkoutRecord' : 'Workouts';
    // 由通知冷啟動時這頁是堆疊唯一一頁：replace 之後沒有上一頁，返回鍵會消失。改成在下面墊一層首頁。
    const alone = navigation.getState()?.routes.length === 1;
    navigation.dispatch(alone ? CommonActions.reset({ index: 1, routes: [{ name: 'Main' }, { name: target }] }) : StackActions.replace(target));
  }, [navigation]);
  return null;
}
