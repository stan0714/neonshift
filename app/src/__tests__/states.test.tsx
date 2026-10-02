/** PG-A-16（Style 14）：離線橫幅、Home inline 狀態（健康權限關閉／健康錯誤／devnet 錯誤）、generic error reference ID。 */
import { NavigationContainer } from '@react-navigation/native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { PublicKey } from '@solana/web3.js';
import { getNetworkStateAsync, useNetworkState } from 'expo-network';
import type { PropsWithChildren } from 'react';

import { fetchAccountsInfo } from '@/services/chain/ChainClient';
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
// 實機那筆：公用 devnet 端點對帳號讀取沒有回應，gateway 回 504（2026-09-27）
const RPC_504 = 'failed to get info about account GuS38ZFpuvvqfpWiKZ1gGWtu8RujynuNZmbVjqik6Axc: Error: 504 : {"jsonrpc":"2.0","error":{"code":504,"message":"Gateway Time-out"}, "id": null}';
jest.mock('@/services/chain/ChainClient', () => {
  const actual = jest.requireActual('@/services/chain/ChainClient');
  return {
    ...actual,
    getConnection: () => ({ getTokenAccountBalance: jest.fn() }),
    fetchAccountsInfo: jest.fn(async () => { throw new actual.RpcReadError({ reason: 'server', label: 'getMultipleAccounts', status: 504, detail: RPC_504 }); }),
  };
});

const wallet = new PublicKey('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
const Wrapper = ({ children }: PropsWithChildren) => (
  <ThemeProvider>
    <NavigationContainer>{children}</NavigationContainer>
  </ThemeProvider>
);

beforeEach(() => {
  jest.clearAllMocks();
  useWalletStore.setState({ status: 'connected', session: { address: wallet.toBase58(), publicKey: wallet, walletUriBase: '', label: 'Phantom' }, error: null } as never);
  useDashboardStore.setState({ profile: null, config: null, chainError: null, health: null, chainSyncing: false });
});

describe('OfflineBanner', () => {
  test('離線時顯示、在線時不顯示', async () => {
    (useNetworkState as jest.Mock).mockReturnValue({ isConnected: false, isInternetReachable: false });
    (getNetworkStateAsync as jest.Mock).mockResolvedValue({ isConnected: false, isInternetReachable: false });
    await render(<OfflineBanner />, { wrapper: Wrapper });
    expect(screen.getByTestId('offline-banner')).toBeTruthy();
    (useNetworkState as jest.Mock).mockReturnValue({ isConnected: true, isInternetReachable: true });
    await render(<OfflineBanner />, { wrapper: Wrapper });
    expect(screen.queryByTestId('offline-banner')).toBeNull();
  });
  test('監聽仍說離線但主動探測已連上（Wi-Fi 回來監聽沒更新）→ 回前景後 banner 消失', async () => {
    (useNetworkState as jest.Mock).mockReturnValue({ isConnected: false, isInternetReachable: false });
    (getNetworkStateAsync as jest.Mock).mockResolvedValue({ isConnected: true, isInternetReachable: true });
    await render(<OfflineBanner />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.queryByTestId('offline-banner')).toBeNull());
  });
});

describe('Home inline states（Style 14）', () => {
  /**
   * 2026-10-02 實機：「UI 反應比較慢，要有東西告知還在處理」。
   * 公用 devnet 的 getMultipleAccounts 實測 1～3 秒，餘額還是第二個請求——
   * 這幾秒內畫面原本完全沒有提示，使用者只看到不動的舊餘額。
   */
  test('鏈上讀取在途時，首頁要說自己正在讀，而不是讓人對著舊數字乾等', async () => {
    // 讓這次讀取掛著不回：不能只 setState，HomeScreen 掛載就會自己 refresh 一次並把旗標歸零
    (fetchAccountsInfo as jest.Mock).mockReturnValueOnce(new Promise(() => {}));
    await render(<HomeScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('home-chain-syncing')).toBeTruthy());
    expect(screen.getByText('Reading onchain data…')).toBeTruthy();
  });

  test('健康權限關閉 → Health access is off + Review access；devnet 讀取失敗 → Devnet is taking a break + Retry', async () => {
    await render(<HomeScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('state-health-off')).toBeTruthy());
    await fireEvent.press(screen.getByText('Review access'));
    expect(mockNavigate).toHaveBeenCalledWith('Onboarding', { screen: 'HealthAccess' });
    await waitFor(() => expect(screen.getByTestId('state-chain-error')).toBeTruthy());
    // Style 14：正文是人話，技術細節只到 Ref——**原始 JSON-RPC payload 不得出現在畫面上**
    expect(screen.getByText(/the public devnet node is having trouble/)).toBeTruthy();
    expect(screen.getByText(/safe onchain/)).toBeTruthy();
    expect(screen.getByText('Ref 504 · getMultipleAccounts')).toBeTruthy();
    expect(screen.queryByText(/jsonrpc|GuS38/)).toBeNull();
    expect(screen.getByText('Retry')).toBeTruthy();
    // PG-U-01：固定「開始運動」入口帶最近模式 → WorkoutStart
    expect(screen.getByText(/Recent: Run/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('home-start-workout'));
    expect(mockNavigate).toHaveBeenCalledWith('WorkoutStart');
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
