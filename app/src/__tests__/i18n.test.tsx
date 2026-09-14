/** PG-A-23：兩份字典 key 一致、插值與複數、語言設定持久化、畫面以 zh-TW 渲染。 */
import { NavigationContainer } from '@react-navigation/native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import type { PropsWithChildren } from 'react';

import { en } from '@/i18n/en';
import { zhTW } from '@/i18n/zh-TW';
import { translate, useLocaleStore } from '@/i18n';
import { LandingScreen } from '@/screens/launch/LandingScreen';
import { ProfileScreen } from '@/screens/tabs/ProfileScreen';
import { useWalletStore } from '@/state/walletStore';
import { ThemeProvider } from '@/theme';

jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useNavigation: () => ({ navigate: jest.fn(), reset: jest.fn(), goBack: jest.fn() }), useIsFocused: () => true }));
jest.mock('@/services/api/ApiClient', () => ({ ...jest.requireActual('@/services/api/ApiClient'), apiClient: { hasSession: jest.fn(async () => false), signOut: jest.fn(), deleteData: jest.fn() } }));
jest.mock('@/services/health/HealthConnectService', () => ({ healthConnect: { getPermissions: jest.fn(async () => ({ state: 'granted', granted: [], missing: [], backgroundGranted: false })), openSettings: jest.fn(), clearCache: jest.fn(), disableBackgroundSync: jest.fn() } }));
jest.mock('@/services/permissions/ActivityRecognition', () => ({ activityRecognition: { check: jest.fn(async () => true) } }));

const Wrapper = ({ children }: PropsWithChildren) => (
  <ThemeProvider>
    <NavigationContainer>{children}</NavigationContainer>
  </ThemeProvider>
);

beforeEach(async () => {
  await SecureStore.deleteItemAsync('neonshift.locale.v1');
  useLocaleStore.setState({ setting: 'system', locale: 'en', loaded: true });
  useWalletStore.setState({ status: 'disconnected', session: null, error: null } as never);
});

describe('字典', () => {
  test('en 與 zh-TW 的 key 完全一致，且沒有空值', () => {
    const a = Object.keys(en).sort();
    const b = Object.keys(zhTW).sort();
    expect(b).toEqual(a);
    for (const k of a) {
      expect((zhTW as Record<string, string>)[k]?.length).toBeGreaterThan(0);
    }
  });
  test('插值、複數與未知 key 回退', () => {
    expect(translate('en', 'home.updatedAgo', { n: 3 })).toBe('Updated 3 min ago');
    expect(translate('zh-TW', 'home.updatedAgo', { n: 3 })).toBe('3 分鐘前更新');
    expect(translate('en', 'gal.matches', { n: 1, count: 1 })).toBe('1 match');
    expect(translate('en', 'gal.matches', { n: 2, count: 2 })).toBe('2 matches');
    expect(translate('en', 'mission.goalReached', { value: 9420, goal: 8000 })).toBe('Goal reached (9,420 / 8,000)');
    expect(translate('zh-TW', 'nope.missing' as never)).toBe('nope.missing');
  });
});

describe('語言切換', () => {
  test('Landing 以 zh-TW 渲染；Profile 切換語言會持久化', async () => {
    useLocaleStore.setState({ setting: 'zh-TW', locale: 'zh-TW' });
    await render(<LandingScreen />, { wrapper: Wrapper });
    expect(screen.getByText('連接錢包')).toBeTruthy();
    expect(screen.getByText('先看看 App')).toBeTruthy();

    await render(<ProfileScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText('語言')).toBeTruthy());
    fireEvent.press(screen.getByTestId('lang-en'));
    await waitFor(() => expect(screen.getByText('Language')).toBeTruthy());
    expect(await SecureStore.getItemAsync('neonshift.locale.v1')).toBe('en');
    expect(useLocaleStore.getState().locale).toBe('en');
  });
});
