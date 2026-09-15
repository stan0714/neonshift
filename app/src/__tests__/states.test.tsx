/** PG-A-16（Style 14）：離線橫幅、Home inline 狀態（健康權限關閉／健康錯誤／devnet 錯誤）、generic error reference ID。 */
import { NavigationContainer } from '@react-navigation/native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { PublicKey } from '@solana/web3.js';
import { useNetworkState } from 'expo-network';
import type { PropsWithChildren } from 'react';

import { InlineState, OfflineBanner } from '@/components';
import { HomeScreen } from '@/screens/tabs/HomeScreen';
import { useDashboardStore } from '@/state/dashboardStore';
import { useWalletStore } from '@/state/walletStore';
import { ThemeProvider } from '@/theme';

jest.mock('@/config/app', () => ({ APP_CONFIG: { ...jest.requireActual('@/config/app').APP_CONFIG, programId: '6MhVoQHdEpY2hqkaNJMkT2vHWakfnGfEYDgCtJzh6ENA', chainConfigured: true, backendConfigured: true } }));
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useNavigation: () => ({ navigate: mockNavigate }) }));
jest.mock('@/services/health/HealthConnectService', () => ({
  healthConnect: { getPermissions: jest.fn(async () => ({ state: 'denied', granted: [], missing: ['steps'], backgroundGranted: false })), readCachedSummary: jest.fn(async () => null), readStepsForTaskDate: jest.fn(async () => ({ total: 0, dataOrigins: [], stepRateSummary: { bucketMinutes: 1, buckets: [], observedMinutes: 0, maxStepsPerMinute: 0 }, deviceSpn: null })), readSleepForTaskDate: jest.fn(async () => ({ sessions: [] })), cacheSummary: jest.fn(async () => {}) },
}));
jest.mock('@/services/chain/ClaimSubmitter', () => ({ claimSubmitter: { receiptExists: jest.fn(async () => false) } }));
jest.mock('@/services/chain/ChainClient', () => ({ getConnection: () => ({ getTokenAccountBalance: jest.fn() }) }));
jest.mock('@/chain/accounts', () => ({ ...jest.requireActual('@/chain/accounts'), fetchAccount: jest.fn(async () => { throw new Error('rpc down'); }) }));

const wallet = new PublicKey('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
const Wrapper = ({ children }: PropsWithChildren) => (
  <ThemeProvider>
    <NavigationContainer>{children}</NavigationContainer>
  </ThemeProvider>
);

beforeEach(() => {
  jest.clearAllMocks();
  useWalletStore.setState({ status: 'connected', session: { address: wallet.toBase58(), publicKey: wallet, walletUriBase: '', label: 'Phantom' }, error: null } as never);
  useDashboardStore.setState({ profile: null, config: null, chainError: null, health: null });
});

describe('OfflineBanner', () => {
  test('離線時顯示、在線時不顯示', async () => {
    (useNetworkState as jest.Mock).mockReturnValue({ isConnected: false, isInternetReachable: false });
    await render(<OfflineBanner />, { wrapper: Wrapper });
    expect(screen.getByTestId('offline-banner')).toBeTruthy();
    (useNetworkState as jest.Mock).mockReturnValue({ isConnected: true, isInternetReachable: true });
    await render(<OfflineBanner />, { wrapper: Wrapper });
    expect(screen.queryByTestId('offline-banner')).toBeNull();
  });
});

describe('Home inline states（Style 14）', () => {
  test('健康權限關閉 → Health access is off + Review access；devnet 讀取失敗 → Devnet is taking a break + Retry', async () => {
    await render(<HomeScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('state-health-off')).toBeTruthy());
    await fireEvent.press(screen.getByText('Review access'));
    expect(mockNavigate).toHaveBeenCalledWith('Onboarding', { screen: 'HealthAccess' });
    await waitFor(() => expect(screen.getByTestId('state-chain-error')).toBeTruthy());
    expect(screen.getByText(/safe onchain; showing cached values/)).toBeTruthy();
    expect(screen.getByText('Retry')).toBeTruthy();
  });
});

describe('InlineState reference ID', () => {
  test('顯示 Ref 與行動按鈕', async () => {
    const onPress = jest.fn();
    await render(<InlineState kind="error" title="Something interrupted your shift" body="x" referenceId="req-1234" action={{ label: 'Try again', onPress }} />, { wrapper: Wrapper });
    expect(screen.getByText('Ref req-1234')).toBeTruthy();
    await fireEvent.press(screen.getByText('Try again'));
    expect(onPress).toHaveBeenCalled();
  });
});
