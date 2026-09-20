import { NavigationContainer } from '@react-navigation/native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';
import { Alert } from 'react-native';

import { ProfileScreen } from '@/screens/tabs/ProfileScreen';
import { apiClient } from '@/services/api/ApiClient';
import { useWalletStore } from '@/state/walletStore';
import { ThemeProvider } from '@/theme';

const mockReset = jest.fn();
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useNavigation: () => ({ navigate: mockNavigate, reset: mockReset, goBack: jest.fn() }) }));
jest.mock('@/services/api/ApiClient', () => ({
  ...jest.requireActual('@/services/api/ApiClient'),
  apiClient: { hasSession: jest.fn(async () => true), galleryPrivacy: jest.fn(async () => ({ hidden: false })), setGalleryPrivacy: jest.fn(async (hidden: boolean) => ({ hidden })), signOut: jest.fn(async () => {}), deleteData: jest.fn(async () => ({ status: 204, body: null })) },
}));
jest.mock('@/services/health/HealthConnectService', () => ({
  healthConnect: { getPermissions: jest.fn(async () => ({ state: 'granted', granted: [], missing: [], backgroundGranted: true })), openSettings: jest.fn(), clearCache: jest.fn(async () => {}), disableBackgroundSync: jest.fn(async () => {}) },
}));
jest.mock('@/services/permissions/ActivityRecognition', () => ({ activityRecognition: { check: jest.fn(async () => true) } }));

const Wrapper = ({ children }: PropsWithChildren) => (
  <ThemeProvider>
    <NavigationContainer>{children}</NavigationContainer>
  </ThemeProvider>
);

beforeEach(() => {
  useWalletStore.setState({ status: 'connected', session: { address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', publicKey: {} as never, walletUriBase: '', label: 'Phantom' }, error: null, disconnect: jest.fn(async () => useWalletStore.setState({ session: null, status: 'disconnected' })) } as never);
  jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
    const confirm = buttons?.find((b) => b.style === 'destructive');
    confirm?.onPress?.();
  });
});

describe('PG-A-21 Profile', () => {
  test('顯示錢包、權限狀態、隱私說明與 tSKR 免責', async () => {
    await render(<ProfileScreen />, { wrapper: Wrapper });
    expect(screen.getByText('7xKXtg…osgAsU')).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/^Steps · background/)).toBeTruthy());
    expect(screen.getByText('Allowed')).toBeTruthy();
    expect(screen.getByText(/at most 30 days/)).toBeTruthy();
    expect(screen.getByText(/not the official SKR/)).toBeTruthy();
    expect(screen.getByText(/neonshift\.cc\/privacy/)).toBeTruthy();
  });

  test('PG-R-09：藝廊開關與跑步歷程入口', async () => {
    const api = jest.requireMock('@/services/api/ApiClient').apiClient as Record<string, jest.Mock>;
    await render(<ProfileScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('profile-gallery-switch')).toBeTruthy());
    expect(screen.getByTestId('profile-gallery-switch').props.value).toBe(true);
    await fireEvent(screen.getByTestId('profile-gallery-switch'), 'valueChange', false);
    await waitFor(() => expect(api.setGalleryPrivacy).toHaveBeenCalledWith(true));
    await waitFor(() => expect(screen.getByTestId('profile-gallery-switch').props.value).toBe(false));
    expect(screen.getByTestId('profile-running-history')).toBeTruthy();
    await act(async () => {});
  });
  test('PG-LINK-02：資料與同步——自動同步預設關閉、開啟後依錢包保存並觸發佇列；待傳筆數與「立即同步」；外觀設定區塊', async () => {
    const { useSyncPrefs } = jest.requireActual('@/state/syncPrefsStore') as typeof import('@/state/syncPrefsStore');
    const { workoutOutbox } = jest.requireActual('@/services/workouts/WorkoutOutbox') as typeof import('@/services/workouts/WorkoutOutbox');
    const kick = jest.spyOn(workoutOutbox, 'kick').mockResolvedValue(null);
    useSyncPrefs.setState({ owner: null, loaded: false, autoSyncWorkouts: false, lastSuccessAt: null });
    await render(<ProfileScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(useSyncPrefs.getState().loaded).toBe(true));
    expect(screen.getByTestId('profile-autosync-switch').props.value).toBe(false);
    expect(screen.getByText('0 pending')).toBeTruthy();
    expect(screen.getByTestId('profile-sync-now').props.accessibilityState.disabled).toBe(true);
    await fireEvent(screen.getByTestId('profile-autosync-switch'), 'valueChange', true);
    await waitFor(() => expect(screen.getByTestId('profile-autosync-switch').props.value).toBe(true));
    expect(kick).toHaveBeenCalledWith('toggle');
    const SecureStore = jest.requireMock('expo-secure-store') as { getItemAsync: (k: string) => Promise<string | null> };
    expect(JSON.parse((await SecureStore.getItemAsync('neonshift.sync.v1.7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'))!)).toMatchObject({ autoSyncWorkouts: true });
    expect(screen.getByTestId('profile-bg-switch')).toBeTruthy();
    expect(screen.getByTestId('profile-open-gear')).toBeTruthy();
    kick.mockRestore();
    await act(async () => {});
  });

  test('刪除資料：確認後呼叫 API、清快取、停背景同步、顯示完成（204）', async () => {
    await render(<ProfileScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText('Signed in')).toBeTruthy());
    await fireEvent.press(screen.getByText('Delete my backend data'));
    await waitFor(() => expect(screen.getByTestId('deletion-done')).toBeTruthy());
    expect(apiClient.deleteData).toHaveBeenCalled();
    const { healthConnect } = jest.requireMock('@/services/health/HealthConnectService');
    expect(healthConnect.clearCache).toHaveBeenCalled();
    expect(healthConnect.disableBackgroundSync).toHaveBeenCalled();
  });

  test('刪除延後（202）顯示 deletion_due_at', async () => {
    (apiClient.deleteData as jest.Mock).mockResolvedValueOnce({ status: 202, body: { deletion_due_at: '2026-10-14T00:00:00Z' } });
    await render(<ProfileScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText('Signed in')).toBeTruthy());
    await fireEvent.press(screen.getByText('Delete my backend data'));
    await waitFor(() => expect(screen.getByTestId('deletion-scheduled')).toBeTruthy());
  });

  test('「我的運動」切到 Activity 分頁（2026-09-20 改為底部分頁）', async () => {
    await render(<ProfileScreen />, { wrapper: Wrapper });
    await fireEvent.press(screen.getByTestId('profile-activity'));
    expect(mockNavigate).toHaveBeenCalledWith('Main', { screen: 'ActivityTab' });
  });
  test('斷開錢包：登出後端、撤銷授權、回 Landing（FR-01.4）', async () => {
    await render(<ProfileScreen />, { wrapper: Wrapper });
    await fireEvent.press(screen.getByText('Disconnect wallet'));
    await waitFor(() => expect(mockReset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'Landing' }] }));
    expect(apiClient.signOut).toHaveBeenCalled();
  });
});
