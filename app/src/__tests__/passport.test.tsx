/** XD-03 成就護照畫面：未登入提示；計數、篩選、項目（來源分類／有效狀態／原因／NFT 連結）、信任邊界；NO_SESSION 就地登入；網路錯誤人話。 */
import { NavigationContainer } from '@react-navigation/native';
import { PublicKey } from '@solana/web3.js';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';

import { PassportScreen } from '@/screens/PassportScreen';
import type { PassportEntry } from '@/services/api/ApiClient';
import { useWalletStore } from '@/state/walletStore';
import { ThemeProvider } from '@/theme';

const mockNav = { navigate: jest.fn() };
jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useNavigation: () => mockNav }));
jest.mock('@/services/api/ApiClient', () => ({ ...jest.requireActual('@/services/api/ApiClient'), apiClient: { passport: jest.fn(), signIn: jest.fn() } }));
const api = jest.requireMock('@/services/api/ApiClient').apiClient as Record<'passport' | 'signIn', jest.Mock>;
const { ApiError } = jest.requireActual('@/services/api/ApiClient');
const Wrapper = ({ children }: PropsWithChildren) => (<ThemeProvider><NavigationContainer>{children}</NavigationContainer></ThemeProvider>);
const wallet = new PublicKey('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
const entry = (o: Partial<PassportEntry>): PassportEntry => ({ id: 'pb:1', kind: 'pb', category: 'fastest_5k', title_key: 'pb.cat.fastest_5k', source_class: 'device', source: { kind: 'workout', id: 'w1', revision: 1 }, rules_version: 'pb/1', achieved_at: '2026-09-10T00:30:00Z', validity: 'valid', reason: null, public: false, nft: null, original_holder: 'you', ...o });
const data = {
  entries: [
    entry({}),
    entry({ id: 'milestone:first_5k', kind: 'milestone', category: 'first_5k', title_key: 'ms.cat.first_5k', public: true, nft: { status: 'minted', asset: 'AsSeT111', achievement_id: 'a1' } }),
    entry({ id: 'milestone:first_10k', kind: 'milestone', category: 'first_10k', title_key: 'ms.cat.first_10k', source_class: 'pending', validity: 'pending', reason: 'needs_review', achieved_at: null }),
    entry({ id: 'quest:e1', kind: 'quest', category: 'three_days', title_key: 'explore.cosmetic.chapter_01_three_days', validity: 'revoked', reason: 'source_removed_or_corrected' }),
  ],
  counts: { valid: 2, pending: 1, revoked: 1, locked: 0 },
  trust_note: 'x',
};

beforeEach(() => {
  jest.clearAllMocks();
  useWalletStore.setState({ status: 'connected', session: { address: wallet.toBase58(), publicKey: wallet, walletUriBase: '', label: 'Seeker' }, error: null } as never);
});

test('未登入提示', async () => {
  useWalletStore.setState({ status: 'disconnected', session: null, error: null } as never);
  await render(<PassportScreen />, { wrapper: Wrapper });
  expect(screen.getByTestId('passport-signin')).toBeTruthy();
});

test('計數、項目、來源分類／原因／NFT 連結、篩選、信任邊界', async () => {
  api.passport.mockResolvedValue(data);
  await render(<PassportScreen />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByTestId('passport-entry-pb-fastest_5k-valid')).toBeTruthy());
  expect(screen.getByTestId('passport-counts')).toBeTruthy();
  expect(screen.getByText('First 5K')).toBeTruthy();
  expect(screen.getByText('Awaiting verification')).toBeTruthy();
  expect(screen.getByText('The source workout is under review, so this is not counted yet.')).toBeTruthy();
  expect(screen.getByText('Three-Day Path')).toBeTruthy();
  expect(screen.getByText(/Public · NFT minted/)).toBeTruthy();
  expect(screen.getByTestId('passport-trust')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('passport-nft-first_5k'));
  expect(mockNav.navigate).toHaveBeenCalledWith('AchievementDetail', { asset: 'AsSeT111' });
  await fireEvent.press(screen.getByTestId('passport-filter-revoked'));
  expect(screen.queryByTestId('passport-entry-pb-fastest_5k-valid')).toBeNull();
  expect(screen.getByTestId('passport-entry-quest-three_days-revoked')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('passport-filter-pending'));
  expect(screen.getByTestId('passport-entry-milestone-first_10k-pending')).toBeTruthy();
});

test('NO_SESSION → 就地登入卡；NETWORK_ERROR → 人話', async () => {
  api.passport.mockRejectedValueOnce(new ApiError(401, 'NO_SESSION', 'Sign in required'));
  await render(<PassportScreen />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByTestId('passport-signin')).toBeTruthy());
});

test('NETWORK_ERROR → 人話錯誤', async () => {
  api.passport.mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'timeout after 15000 ms', undefined, undefined, undefined, 'timeout'));
  await render(<PassportScreen />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByTestId('passport-error')).toBeTruthy());
  expect(screen.getByText('The server did not respond within 15 seconds.')).toBeTruthy();
});
