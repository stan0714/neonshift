import { NavigationContainer } from '@react-navigation/native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { PublicKey } from '@solana/web3.js';
import type { PropsWithChildren } from 'react';
import { Alert } from 'react-native';

import { ArenaScreen } from '@/screens/tabs/ArenaScreen';
import type { LeaderboardResponse, TournamentCurrentResponse, TournamentView } from '@/services/api/ApiClient';
import { useArenaStore } from '@/state/arenaStore';
import { useDashboardStore } from '@/state/dashboardStore';
import { useWalletStore } from '@/state/walletStore';
import { ThemeProvider } from '@/theme';

jest.mock('@/config/app', () => ({ APP_CONFIG: { ...jest.requireActual('@/config/app').APP_CONFIG, programId: '6MhVoQHdEpY2hqkaNJMkT2vHWakfnGfEYDgCtJzh6ENA', chainConfigured: true, backendConfigured: true, apiUrl: 'http://test/v1' } }));
jest.mock('@/services/api/ApiClient', () => ({ ...jest.requireActual('@/services/api/ApiClient'), apiClient: { tournamentCurrent: jest.fn(), tournamentLeaderboard: jest.fn(), tournamentSteps: jest.fn(), authorizeClaim: jest.fn(), signIn: jest.fn() } }));
jest.mock('@/services/tournament/TournamentService', () => ({ tournamentService: { entry: jest.fn(), join: jest.fn(), claim: jest.fn(), submitSteps: jest.fn() } }));
const mockApi = jest.requireMock('@/services/api/ApiClient').apiClient as Record<'tournamentCurrent' | 'tournamentLeaderboard' | 'tournamentSteps' | 'authorizeClaim' | 'signIn', jest.Mock>;
const mockSvc = jest.requireMock('@/services/tournament/TournamentService').tournamentService as Record<'entry' | 'join' | 'claim' | 'submitSteps', jest.Mock>;

const wallet = new PublicKey('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
const mint = PublicKey.unique();
const NOW = Math.floor(Date.now() / 1000);
const tournament = (over: Partial<TournamentView> = {}): TournamentView => ({
  week_id: 202638, address: 'T', status: 'registration', stake_amount: '50000000', treasury_injection_cap: '0', treasury_injection: '0', entrant_count: 4, valid_entrant_count: 0, forfeited_count: 0, min_entrants: 10, group_a_size: 1, group_b_size: 2, prize_a_bps: 6000, prize_b_bps: 4000, loser_refund_bps: 5000,
  registration_ends_at: NOW + 3600, starts_at: NOW + 7200, ends_at: NOW + 7200 + 172_800, rules_version: 3, registration_open: true, settlement: null, ...over,
});
const current = (t: TournamentView | null, player: TournamentCurrentResponse['player'] = { joined: false, verified_steps: 0, rank: null }): TournamentCurrentResponse => ({ tournament: t, player, server_time: NOW });
const leaderboard = (you: number | null): LeaderboardResponse => ({ week_id: 202638, status: 'running', generated_at: new Date().toISOString(), total_players: 3, entries: [{ rank: 1, wallet: 'AAAA1111AAAA1111AAAA1111AAAA1111AAAA1111AAAA', verified_steps: 15_000, first_reached_at: null, updated_at: '' }, { rank: 2, wallet: wallet.toBase58(), verified_steps: 12_345, first_reached_at: null, updated_at: '' }], you: { rank: you, verified_steps: 12_345 } });

const Wrapper = ({ children }: PropsWithChildren) => (
  <ThemeProvider>
    <NavigationContainer>{children}</NavigationContainer>
  </ThemeProvider>
);

beforeEach(() => {
  jest.clearAllMocks();
  mockSvc.entry.mockResolvedValue(null);
  mockSvc.join.mockResolvedValue({ signature: 'sigJoin111', alreadyJoined: false });
  mockSvc.claim.mockResolvedValue({ signature: 'sigClaim11', alreadySettled: false });
  mockSvc.submitSteps.mockResolvedValue({ week_id: 202638, verified_steps: 12_345, submitted_steps: 12_345, accepted: true, first_reached_at: null, rank: 2 });
  useWalletStore.setState({ status: 'connected', session: { address: wallet.toBase58(), publicKey: wallet, walletUriBase: '', label: 'Phantom' }, error: null } as never);
  useDashboardStore.setState({ config: { mint, paused: false, coreMultiplierBps: [10_000], shoeXpThresholds: [] } } as never);
  useArenaStore.setState({ current: null, leaderboard: null, entry: null, loading: false, error: null, errorInfo: null, needsSignIn: false, busy: null, outcome: null, syncedAt: null });
  jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons?.find((b) => b.text !== 'Cancel')?.onPress?.());
});

describe('PG-A-15 Arena', () => {
  test('13.1 未報名：UTC／當地時段、質押、人數、規則；確認框顯示最差損失後報名', async () => {
    mockApi.tournamentCurrent.mockResolvedValue(current(tournament()));
    await render(<ArenaScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('arena-tournament')).toBeTruthy());
    expect(screen.getAllByText(/UTC/).length).toBeGreaterThan(0);
    expect(screen.getByText('50 tSKR')).toBeTruthy();
    expect(screen.getByText(/4 · min 10/)).toBeTruthy();
    expect(screen.getByText(/Worst case you lose 25 tSKR/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('arena-join'));
    await waitFor(() => expect(mockSvc.join).toHaveBeenCalledWith(wallet, 202638, mint));
    expect((Alert.alert as jest.Mock).mock.calls[0][1]).toMatch(/the most you can lose is 25 tSKR/);
    await waitFor(() => expect(screen.getByTestId('arena-success')).toBeTruthy());
    expect(screen.getByText(/Entered · Tx sigJoin1…/)).toBeTruthy();
  });

  test('報名截止後 CTA 停用並說明', async () => {
    mockApi.tournamentCurrent.mockResolvedValue(current(tournament({ registration_open: false })));
    await render(<ArenaScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText('Registration closed')).toBeTruthy());
  });

  test('13.2 進行中：名次、步數、回報按鈕；排行榜本人 row 強調、其他地址遮罩', async () => {
    mockApi.tournamentCurrent.mockResolvedValue(current(tournament({ status: 'running', starts_at: NOW - 3600, ends_at: NOW + 3600 }), { joined: true, verified_steps: 12_345, rank: 2 }));
    mockApi.tournamentLeaderboard.mockResolvedValue(leaderboard(2));
    await render(<ArenaScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('arena-running')).toBeTruthy());
    expect(screen.getAllByText('#2').length).toBeGreaterThan(0);
    expect(screen.getAllByText('12,345').length).toBeGreaterThan(0);
    expect(screen.getByTestId('leaderboard-you')).toBeTruthy();
    expect(screen.getByText('AAAA…AAAA')).toBeTruthy();
    expect(screen.getByText('You')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('arena-steps'));
    await waitFor(() => expect(mockSvc.submitSteps).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/12,345 verified steps · rank #2/)).toBeTruthy());
  });

  test('13.3 結算：final rank／group／領取；沒收顯示規則版本與申訴管道', async () => {
    mockApi.tournamentCurrent.mockResolvedValue(current(tournament({ status: 'settled', starts_at: NOW - 200_000, ends_at: NOW - 10_000, settlement: { distributable_pool: '775000000', total_refund: '0', total_prize: '0', treasury_remainder: '0', results_submitted: 10 } }), { joined: true, verified_steps: 12_345, rank: 2 }));
    mockApi.tournamentLeaderboard.mockResolvedValue(leaderboard(2));
    mockSvc.entry.mockResolvedValue({ stake: BigInt(0), finalSteps: BigInt(0), rank: 2, group: 2, forfeited: false, settled: false, joinedAt: 0 } as never);
    await render(<ArenaScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('arena-settled')).toBeTruthy());
    expect(screen.getByText('B')).toBeTruthy();
    expect(screen.getByText(/share of the B pool/)).toBeTruthy();
    expect(screen.getByText(/Pool 775 tSKR/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('arena-claim'));
    await waitFor(() => expect(mockSvc.claim).toHaveBeenCalledWith(wallet, 202638, mint, 'prize'));

    mockSvc.entry.mockResolvedValue({ stake: BigInt(0), finalSteps: BigInt(0), rank: 0, group: 0, forfeited: true, settled: false, joinedAt: 0 } as never);
    useArenaStore.setState({ current: null, entry: null, outcome: null });
    await render(<ArenaScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('arena-forfeited')).toBeTruthy());
    expect(screen.getAllByText(/rules v3/).length).toBeGreaterThan(0);
    expect(screen.getByText(/support@neonshift.cc/)).toBeTruthy();
  });

  test('Cancelled：退款按鈕；無賽事：空狀態；後端錯誤：錯誤狀態', async () => {
    mockApi.tournamentCurrent.mockResolvedValue(current(tournament({ status: 'cancelled' }), { joined: true, verified_steps: 0, rank: null }));
    await render(<ArenaScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('arena-refund')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('arena-refund'));
    await waitFor(() => expect(mockSvc.claim).toHaveBeenCalledWith(wallet, 202638, mint, 'refund'));

    mockApi.tournamentCurrent.mockResolvedValue(current(null, null));
    useArenaStore.setState({ current: null, outcome: null });
    await render(<ArenaScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('arena-empty')).toBeTruthy());

    mockApi.tournamentCurrent.mockRejectedValue(new Error('boom'));
    useArenaStore.setState({ current: null });
    await render(<ArenaScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('arena-error')).toBeTruthy());
  });

  /** 2026-10-03 實機（離線）：卡片印出 `fetch failed: java.net.UnknownHostException: Unable to resolve host…` */
  test('載入失敗：離線／逾時／伺服器各給白話說明與 Ref，不印原始例外；再試一次會重抓', async () => {
    const { ApiError } = jest.requireActual('@/services/api/ApiClient');
    const raw = 'fetch failed: java.net.UnknownHostException: Unable to resolve host "api.neonshift.cc": No address associated with hostname';
    mockApi.tournamentCurrent.mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', raw, undefined, undefined, undefined, 'unreachable'));
    await render(<ArenaScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('arena-error')).toBeTruthy());
    expect(screen.getByText("You're offline")).toBeTruthy();
    expect(screen.getByText(/can't load without a connection/)).toBeTruthy();
    expect(screen.getByText('Ref OFFLINE')).toBeTruthy();
    expect(screen.queryByText(/UnknownHostException|fetch failed|api\.neonshift\.cc/)).toBeNull();

    mockApi.tournamentCurrent.mockClear().mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'timeout after 15000 ms', undefined, undefined, undefined, 'timeout'));
    await fireEvent.press(screen.getByTestId('arena-error-retry'));
    await waitFor(() => expect(screen.getByText('Arena is taking too long')).toBeTruthy());
    expect(mockApi.tournamentCurrent).toHaveBeenCalledTimes(1);

    mockApi.tournamentCurrent.mockRejectedValue(new ApiError(503, 'SERVER_ERROR', 'upstream connect error or disconnect/reset before headers', undefined, undefined, 'req-42'));
    await fireEvent.press(screen.getByTestId('arena-error-retry'));
    await waitFor(() => expect(screen.getByText('Arena is temporarily unavailable')).toBeTruthy());
    expect(screen.getByText('Ref SERVER_ERROR · req-42')).toBeTruthy();
    expect(screen.queryByText(/upstream connect/)).toBeNull();
  });

  test('無後端 session：顯示登入而非錯誤；登入後重新載入', async () => {
    const { ApiError } = jest.requireActual('@/services/api/ApiClient');
    mockApi.tournamentCurrent.mockRejectedValueOnce(new ApiError(401, 'NO_SESSION', 'Sign in required')).mockResolvedValue(current(tournament()));
    mockApi.signIn.mockResolvedValue({});
    await render(<ArenaScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('arena-signin')).toBeTruthy());
    expect(screen.queryByTestId('arena-error')).toBeNull();
    useArenaStore.setState({ outcome: { kind: 'error', action: 'join', code: 'FAILED', message: 'java.util.concurrent.CancellationException' } }); // 先前錢包不回覆留下的失敗卡
    await fireEvent.press(screen.getByTestId('arena-signin-btn'));
    await waitFor(() => expect(screen.getByTestId('arena-tournament')).toBeTruthy());
    expect(mockApi.signIn).toHaveBeenCalledWith(wallet.toBase58());
    expect(screen.queryByTestId('arena-error')).toBeNull(); // 登入成功後不再顯示舊的「Could not enter」
  });

  test('Phantom（Seeker 已知簽完不回覆）：登入卡事前提醒；簽了沒回覆 → 改用 Seeker Wallet 的步驟', async () => {
    const { ApiError } = jest.requireActual('@/services/api/ApiClient');
    const { WalletError } = jest.requireActual('@/services/wallet/WalletService');
    useWalletStore.setState({ session: { ...useWalletStore.getState().session!, label: 'Phantom' } } as never);
    mockApi.tournamentCurrent.mockRejectedValue(new ApiError(401, 'NO_SESSION', 'Sign in required'));
    mockApi.signIn.mockRejectedValue(new WalletError('WALLET_NO_REPLY', 'java.util.concurrent.CancellationException'));
    await render(<ArenaScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('arena-signin')).toBeTruthy());
    expect(screen.getByText(/Phantom on Seeker currently does not return signed messages/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('arena-signin-btn'));
    await waitFor(() => expect(screen.getByText(/Phantom approved the message but never sent the signature back/)).toBeTruthy());
    expect(screen.getByText(/Disconnect wallet → Connect wallet → choose “Wallet”/)).toBeTruthy();
  });
});
