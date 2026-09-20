import { NavigationContainer } from '@react-navigation/native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';

import { ActivityRecognitionScreen } from '@/screens/onboarding/ActivityRecognitionScreen';
import { HealthAccessScreen } from '@/screens/onboarding/HealthAccessScreen';
import { StarterShoeScreen } from '@/screens/onboarding/StarterShoeScreen';
import { WalletConnectScreen } from '@/screens/onboarding/WalletConnectScreen';
import { WalletError } from '@/services/wallet/WalletService';
import { useOnboardingStore } from '@/state/onboardingStore';
import { useWalletStore } from '@/state/walletStore';
import { ThemeProvider } from '@/theme';

const mockNavigate = jest.fn();
const mockReset = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn(), reset: mockReset }),
}));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() }));
jest.mock('@solana-mobile/mobile-wallet-adapter-protocol-web3js', () => ({ transact: jest.fn() }));
jest.mock('@/services/health/HealthConnectService', () => ({
  ...jest.requireActual('@/services/health/HealthConnectService'),
  healthConnect: { assertUsable: jest.fn(), getPermissions: jest.fn(), requestRequiredPermissions: jest.fn(), openSettings: jest.fn() },
}));
jest.mock('@/services/permissions/ActivityRecognition', () => ({ activityRecognition: { check: jest.fn(async () => false), request: jest.fn() } }));

import { healthConnect } from '@/services/health/HealthConnectService';
import { activityRecognition } from '@/services/permissions/ActivityRecognition';

const hc = healthConnect as jest.Mocked<typeof healthConnect>;
const ar = activityRecognition as jest.Mocked<typeof activityRecognition>;

const Wrapper = ({ children }: PropsWithChildren) => (
  <ThemeProvider>
    <NavigationContainer>{children}</NavigationContainer>
  </ThemeProvider>
);

beforeEach(() => {
  mockNavigate.mockClear();
  mockReset.mockClear();
  useWalletStore.setState({ status: 'idle', session: null, error: null });
  useOnboardingStore.setState({ healthGranted: false, activityGranted: false, healthDeferred: false, activityDeferred: false, shoeMinted: false });
});

describe('10.1 Wallet Connection', () => {
  test('顯示網路與 seed phrase 說明；錯誤四分類其中之一', async () => {
    useWalletStore.setState({ status: 'error', error: new WalletError('WALLET_UNAVAILABLE', 'x') });
    await render(<WalletConnectScreen />, { wrapper: Wrapper });
    expect(screen.getByText('Connect your mission wallet')).toBeTruthy();
    expect(screen.getByText(/Solana Devnet/)).toBeTruthy();
    expect(screen.getByText(/seed phrase never leaves/)).toBeTruthy();
    expect(screen.getByText('No compatible wallet found')).toBeTruthy();
  });

  test('連線成功後前往 Health', async () => {
    await render(<WalletConnectScreen />, { wrapper: Wrapper });
    await act(async () => {
      useWalletStore.setState({ status: 'connected', session: { address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', publicKey: {} as never, walletUriBase: '' } });
    });
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('Onboarding', { screen: 'HealthAccess' }));
  });
});

describe('10.2 Health Access', () => {
  test('進入時只檢查不彈框；CTA 才請求；拒絕後顯示設定入口與 Not now', async () => {
    hc.assertUsable.mockResolvedValue({ availability: 'available', osApi: 36, sdkExtension: 22, spnQuerySupported: false, deviceStepsSupported: true, deviceSpn: null, deviceModel: 'Seeker' });
    hc.getPermissions.mockResolvedValue({ state: 'denied', granted: [], missing: ['a', 'b'], backgroundGranted: false });
    hc.requestRequiredPermissions.mockResolvedValue({ state: 'partial', granted: ['a'], missing: ['b'], backgroundGranted: false });
    await render(<HealthAccessScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText('Allow health access')).toBeTruthy());
    expect(hc.requestRequiredPermissions).not.toHaveBeenCalled();
    expect(screen.getByText(/at most 30 days/)).toBeTruthy();
    expect(screen.getByText(/Manage later in Settings/)).toBeTruthy();

    await act(async () => await fireEvent.press(screen.getByText('Allow health access')));
    await waitFor(() => expect(screen.getByTestId('health-denied')).toBeTruthy());
    expect(screen.getByText(/Some required access is missing/)).toBeTruthy();
    expect(screen.getByText('Open Health Connect settings')).toBeTruthy();
    expect(screen.getByText('Not now')).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('授予後記錄旗標並前往 Activity', async () => {
    hc.assertUsable.mockResolvedValue({ availability: 'available', osApi: 36, sdkExtension: 22, spnQuerySupported: false, deviceStepsSupported: true, deviceSpn: null, deviceModel: 'Seeker' });
    hc.getPermissions.mockResolvedValue({ state: 'denied', granted: [], missing: ['a', 'b'], backgroundGranted: false });
    hc.requestRequiredPermissions.mockResolvedValue({ state: 'granted', granted: ['a', 'b'], missing: [], backgroundGranted: false });
    await render(<HealthAccessScreen />, { wrapper: Wrapper });
    await waitFor(() => screen.getByText('Allow health access'));
    await act(async () => await fireEvent.press(screen.getByText('Allow health access')));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('Onboarding', { screen: 'ActivityRecognition' }));
    expect(useOnboardingStore.getState().healthGranted).toBe(true);
  });

  test('Health Connect 不可用時提供不帶健康資料繼續', async () => {
    const { HealthError } = jest.requireActual('@/services/health/HealthConnectService');
    hc.assertUsable.mockRejectedValue(new HealthError('HC_UNAVAILABLE', 'x'));
    await render(<HealthAccessScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText('Health Connect is unavailable')).toBeTruthy());
    expect(screen.getByText('Continue without health data')).toBeTruthy();
  });
});

describe('10.3 Activity Recognition', () => {
  test('不宣稱可證明真人步行；拒絕時顯示狀態', async () => {
    ar.request.mockResolvedValue('denied');
    await render(<ActivityRecognitionScreen />, { wrapper: Wrapper });
    expect(screen.getByText(/not proof of a real walk/)).toBeTruthy();
    expect(screen.queryByText(/prove|cheat-proof/i)).toBeNull();
    await act(async () => await fireEvent.press(screen.getByText('Allow activity recognition')));
    await waitFor(() => expect(screen.getByTestId('activity-denied')).toBeTruthy());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('授予後前往 Starter Shoe', async () => {
    ar.request.mockResolvedValue('granted');
    await render(<ActivityRecognitionScreen />, { wrapper: Wrapper });
    await act(async () => await fireEvent.press(screen.getByText('Allow activity recognition')));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('Onboarding', { screen: 'StarterShoe' }));
  });
});

describe('10.4 Starter Shoe Claim（免費贈與，不鑄 NFT）', () => {
  test('依序顯示 Action／Asset／Network／Owner／Expected result／Fee；未連線時 disabled 並說明原因；不出現 Mint', async () => {
    await render(<StarterShoeScreen />, { wrapper: Wrapper });
    for (const label of ['Action', 'Asset', 'Network', 'Owner', 'Expected result', 'Network fee']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    await waitFor(() => expect(screen.getByText(/Starter Shoe/)).toBeTruthy());
    expect(screen.getByText(/account rent \+ fee/)).toBeTruthy();
    expect(screen.getByText('Connect a wallet first')).toBeTruthy();
    expect(screen.getByText(/No monetary value/)).toBeTruthy();
    expect(screen.queryByText(/mint/i)).toBeNull();
  });

  test('本版未設定 program id：顯示資訊狀態、不建立資產、不前往 Main', async () => {
    useWalletStore.setState({ status: 'connected', session: { address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', publicKey: {} as never, walletUriBase: '' } });
    await render(<StarterShoeScreen />, { wrapper: Wrapper });
    expect(screen.getByText('7xKX…gAsU')).toBeTruthy();
    await act(async () => await fireEvent.press(screen.getByText('Claim starter shoe')));
    await waitFor(() => expect(screen.getByTestId('claim-error')).toBeTruthy());
    expect(screen.getByText('Onchain claim not enabled in this build')).toBeTruthy();
    expect(useOnboardingStore.getState().shoeMinted).toBe(false);
    expect(mockReset).not.toHaveBeenCalled();
  });
});
