import { NavigationContainer } from '@react-navigation/native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';
import { Alert } from 'react-native';

import { ProfileScreen } from '@/screens/tabs/ProfileScreen';
import { ApiError, apiClient } from '@/services/api/ApiClient';
import { t } from '@/i18n';
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
jest.mock('expo-application', () => ({ nativeApplicationVersion: '0.1.0', nativeBuildVersion: '14' }));

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
  /**
   * 2026-10-02：實機測試時沒辦法確認手機上裝的是哪一包。About 原本寫死 `NeonShift 0.1.0`——
   * 那比沒有更糟，看起來權威卻每一包都一樣。改成讀原生 build 的 versionName／versionCode。
   */
  test('About 顯示的是實際 build 的版本與 versionCode，不是寫死的字串', async () => {
    await render(<ProfileScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('profile-version')).toBeTruthy());
    expect(screen.getByText('NeonShift 0.1.0 (14)')).toBeTruthy();
  });

  /**
   * 2026-10-02 實機回報「點了 Disconnect 會停住」。其實有在跑——signOut 是網路請求
   * （最長 15 秒），之後 MWA deauthorize 還要開錢包選擇器——但這段期間畫面毫無變化，
   * 使用者只能判斷成當掉。動作必須說出自己正在發生。
   */
  test('斷開連接要顯示進行中並擋掉重複觸發', async () => {
    let release: (() => void) | undefined;
    (apiClient.signOut as jest.Mock).mockImplementationOnce(() => new Promise<void>((r) => { release = r as () => void; }));
    const walletDisconnect = jest.fn(async () => {});
    useWalletStore.setState({ disconnect: walletDisconnect } as never);
    await render(<ProfileScreen />, { wrapper: Wrapper });
    expect(screen.getByTestId('profile-disconnect').props.accessibilityState.disabled).toBe(false);

    await act(async () => { fireEvent.press(screen.getByTestId('profile-disconnect')); });
    // signOut 還沒回來：按鈕進入進行中並停用
    await waitFor(() => expect(screen.getByTestId('profile-disconnect').props.accessibilityState.busy).toBe(true));
    expect(screen.getByText('Disconnecting…')).toBeTruthy();
    expect(walletDisconnect).not.toHaveBeenCalled(); // 還沒走到錢包那一步

    // 這段期間再按不會再跑一次
    await act(async () => { fireEvent.press(screen.getByTestId('profile-disconnect')); });
    expect(apiClient.signOut).toHaveBeenCalledTimes(1);

    await act(async () => { release!(); });
    await waitFor(() => expect(walletDisconnect).toHaveBeenCalledTimes(1));
  });

  test('顯示錢包、權限狀態、隱私說明與 tSKR 免責', async () => {
    await render(<ProfileScreen />, { wrapper: Wrapper });
    expect(screen.getByText('7xKXtg…osgAsU')).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/^Steps · background/)).toBeTruthy());
    expect(screen.getByText('Allowed')).toBeTruthy();
    expect(screen.getByText(/at most 30 days/)).toBeTruthy();
    expect(screen.getByText(/not the official SKR/)).toBeTruthy();
    expect(screen.getByText(/neonshift\.cc\/privacy/)).toBeTruthy();
  });

  test('權限區兩個設定按鈕上下排滿寬（並排時「Health Connect settings」會換行被切）', async () => {
    await render(<ProfileScreen />, { wrapper: Wrapper });
    const flat = (st: unknown): Record<string, unknown> => Object.assign({}, ...([st].flat(Infinity) as Record<string, unknown>[]).filter(Boolean));
    for (const id of ['profile-hc-settings', 'profile-app-settings']) {
      const wrapper = screen.getByTestId(id).parent?.parent;
      expect(flat(screen.getByTestId(id).props.style).flex).toBeUndefined();
      expect(flat(wrapper?.props.style).flexDirection).not.toBe('row');
    }
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

/**
 * APK-05：評審指南寫的是「沒有合格 Health Connect 紀錄就用公開預覽」，但唯讀預覽原本
 * 只掛在登入前的 LandingScreen 上——連了錢包就再也回不去，那句話對已登入的評審是死路。
 * 這一項釘住「已連錢包時，Profile 仍找得到預覽入口」。
 */
test('已連錢包時 Profile 仍有唯讀預覽入口，且說明它不會建立任何資料', async () => {
  await render(<ProfileScreen />, { wrapper: Wrapper });
  const entry = await screen.findByTestId('profile-demo-preview');
  expect(entry).toBeTruthy();
  // 文案必須講清楚預覽不留下東西——否則評審會以為自己在操作真的帳號
  expect(screen.getByText(/saves nothing and creates no wallet, NFT or health data/i)).toBeTruthy();
  await fireEvent.press(entry);
  expect(mockNavigate).toHaveBeenCalledWith('DemoPreview');
});

/**
 * 刪除資料失敗時，畫面上不該出現 `VALIDATION: body/x must be string` 這種東西。
 * 錯誤碼對支援有用，但它屬於可回報的參考碼，不屬於句子——同 home.chainErr／home.healthErr。
 */
test('刪除資料失敗：正文是人話，錯誤碼只出現在參考碼', async () => {
  const api = jest.requireMock('@/services/api/ApiClient').apiClient as { deleteData: jest.Mock };
  api.deleteData.mockRejectedValueOnce(new ApiError(422, 'VALIDATION', 'body/wallet must be string', undefined, undefined, 'req-9'));
  jest.spyOn(Alert, 'alert').mockImplementation((_t, _b, buttons) => {
    const ok = (buttons ?? []).find((x) => x.style === 'destructive') ?? (buttons ?? [])[1];
    void ok?.onPress?.();
  });
  await render(<ProfileScreen />, { wrapper: Wrapper });
  await fireEvent.press(await screen.findByText(t('profile.deleteData')));
  const card = await screen.findByTestId('deletion-error');
  expect(card).toBeTruthy();
  // 錯誤碼不得出現在正文裡（它在 referenceId）
  expect(screen.queryByText(/VALIDATION: /)).toBeNull();
  expect(screen.getByText(/VALIDATION · req-9/)).toBeTruthy();
});
