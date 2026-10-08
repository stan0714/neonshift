/**
 * 2026-10-02 RC v15 驗收（A-4 ⑤＋⑨）：新手流程連上 0 SOL 的帳戶後領不到起始鞋，
 * 退回連接頁只剩「Continue as …」——斷開只在 Profile，而 Profile 要先完成新手流程，
 * 使用者被關在那個帳戶裡出不來。連接頁要能換帳戶。
 */
import { NavigationContainer } from '@react-navigation/native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { PublicKey } from '@solana/web3.js';
import type { PropsWithChildren } from 'react';

jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useNavigation: () => ({ navigate: jest.fn(), reset: jest.fn() }) }));
const mockSignOut = jest.fn(async (_o?: unknown) => {});
jest.mock('@/services/api/ApiClient', () => ({ ...jest.requireActual('@/services/api/ApiClient'), apiClient: { signOut: (o?: unknown) => mockSignOut(o) } }));
const mockClearCache = jest.fn(async () => {});
jest.mock('@/services/health/HealthConnectService', () => ({ ...jest.requireActual('@/services/health/HealthConnectService'), healthConnect: { clearCache: () => mockClearCache() } }));

import { WalletConnectScreen } from '@/screens/onboarding/WalletConnectScreen';
import { SIGN_OUT_TIMEOUT_MS } from '@/services/session/disconnect';
import { useWalletStore } from '@/state/walletStore';
import { ThemeProvider } from '@/theme';

const Wrapper = ({ children }: PropsWithChildren) => (
  <ThemeProvider>
    <NavigationContainer>{children}</NavigationContainer>
  </ThemeProvider>
);
const pk = new PublicKey('9esSq2MAyLuMcAmGQTy5iDKEbK1n4XrUTuZm5Mz8NYRh');

beforeEach(() => jest.clearAllMocks());

test('已連上（例如 0 SOL、過不了起始鞋）→ 連接頁可以「改用其他錢包」，斷開後回到 Connect wallet', async () => {
  const disconnect = jest.fn(async () => useWalletStore.setState({ status: 'disconnected', session: null } as never));
  // loginIncomplete：讓畫面停在這一頁（不自動往下一步走），與實機退回連接頁的狀態相同
  useWalletStore.setState({ status: 'connected', session: { address: pk.toBase58(), publicKey: pk, walletUriBase: '', label: 'neonshift' }, error: null, phase: null, loginIncomplete: true, disconnect } as never);
  await render(<WalletConnectScreen />, { wrapper: Wrapper });
  expect(screen.getByText(/Continue as 9esS/)).toBeTruthy();
  await fireEvent.press(screen.getByTestId('wallet-use-different'));
  await waitFor(() => expect(disconnect).toHaveBeenCalledTimes(1));
  // 後端登出只是盡力而為：等待上限要短，不能讓錢包晚 13 秒才開
  expect(mockSignOut).toHaveBeenCalledWith({ timeoutMs: SIGN_OUT_TIMEOUT_MS });
  expect(SIGN_OUT_TIMEOUT_MS).toBeLessThanOrEqual(3_000);
  expect(mockClearCache).toHaveBeenCalled();
  await waitFor(() => expect(screen.getByText('Connect wallet')).toBeTruthy());
  expect(screen.queryByTestId('wallet-use-different')).toBeNull();
});

test('還沒連上 → 不顯示「改用其他錢包」', async () => {
  useWalletStore.setState({ status: 'idle', session: null, error: null, phase: null, loginIncomplete: false } as never);
  await render(<WalletConnectScreen />, { wrapper: Wrapper });
  expect(screen.queryByTestId('wallet-use-different')).toBeNull();
});
