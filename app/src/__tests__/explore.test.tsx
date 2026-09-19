/** PG-U-04 App：探索冊——未登入提示；格子點亮／未開啟；本週任務進度與狀態；接受（timed_goal 選分鐘、idempotency key、時區）；可開啟 → claim → 已收藏；GPS 未開放註記；分開計算說明。 */
import { NavigationContainer } from '@react-navigation/native';
import { PublicKey } from '@solana/web3.js';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';

import { ExploreScreen } from '@/screens/ExploreScreen';
import { useWalletStore } from '@/state/walletStore';
import { ThemeProvider } from '@/theme';

jest.mock('expo-crypto', () => ({ randomUUID: () => '11111111-2222-4333-8444-555555555555' }));
const mockNav = { navigate: jest.fn() };
jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useNavigation: () => mockNav }));
jest.mock('@/services/api/ApiClient', () => ({ ...jest.requireActual('@/services/api/ApiClient'), apiClient: { quests: jest.fn(), acceptQuest: jest.fn(), claimQuest: jest.fn(), signIn: jest.fn() } }));
const api = jest.requireMock('@/services/api/ApiClient').apiClient as Record<'quests' | 'acceptQuest' | 'claimQuest' | 'signIn', jest.Mock>;
const { ApiError } = jest.requireActual('@/services/api/ApiClient');
const Wrapper = ({ children }: PropsWithChildren) => (
  <ThemeProvider>
    <NavigationContainer>{children}</NavigationContainer>
  </ThemeProvider>
);
const wallet = new PublicKey('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
const templates = [{ template_id: 'three_days', version: 1, kind: 'active_days', params: { days: 3 }, cosmetic_id: 'chapter_01_three_days' }, { template_id: 'timed_goal', version: 1, kind: 'goal_time', params: { minutes: [10, 20, 30] }, cosmetic_id: 'chapter_01_timed_goal' }];
const enrollment = (o: Record<string, unknown>) => ({ enrollment_id: 'e1', template_id: 'three_days', template_version: 1, goal: {}, timezone: 'Asia/Taipei', period_start: '2026-09-13T16:00:00Z', period_end: '2026-09-20T16:00:00Z', late_sync_until: '2026-09-22T16:00:00Z', accepted_at: '2026-09-16T03:00:00Z', status: 'active', completed_at: null, progress: { current: 1, target: 3 }, contributions: [], ...o });
const rules = { min_active_minutes: 10, late_sync_hours: 48, gps_rewards_enabled: false };

beforeEach(() => {
  jest.clearAllMocks();
  useWalletStore.setState({ status: 'connected', session: { address: wallet.toBase58(), publicKey: wallet, walletUriBase: '', label: 'Phantom' }, error: null } as never);
});

test('未登入提示', async () => {
  useWalletStore.setState({ status: 'disconnected', session: null, error: null } as never);
  await render(<ExploreScreen />, { wrapper: Wrapper });
  await act(async () => {});
  expect(screen.getByTestId('explore-signin')).toBeTruthy();
});

test('實機：登入時連不上伺服器 → 顯示離線說明（不是「確認錢包 App 已開啟」），登入卡仍在可再按', async () => {
  api.quests.mockRejectedValueOnce(new ApiError(401, 'NO_SESSION', 'Sign in required'));
  api.signIn.mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'fetch failed: java.net.UnknownHostException: Unable to resolve host api.neonshift.cc'));
  await render(<ExploreScreen />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByTestId('explore-signin')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('explore-signin-btn'));
  await waitFor(() => expect(screen.getByText(/Cannot reach the server/)).toBeTruthy());
  expect(screen.queryByText(/wallet app is open/)).toBeNull();
  expect(screen.getByTestId('explore-signin-btn')).toBeTruthy();
});

test('後端 NO_SESSION：顯示就地登入卡（不是錯誤＋Try again）；簽完重新載入', async () => {
  api.quests.mockRejectedValueOnce(new ApiError(401, 'NO_SESSION', 'Sign in required'));
  api.quests.mockResolvedValueOnce({ templates, enrollments: [], cosmetics: [], rules });
  api.signIn.mockResolvedValueOnce({});
  await render(<ExploreScreen />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByTestId('explore-signin')).toBeTruthy());
  expect(screen.queryByTestId('explore-error')).toBeNull();
  await fireEvent.press(screen.getByTestId('explore-signin-btn'));
  await waitFor(() => expect(screen.queryByTestId('explore-signin')).toBeNull());
  expect(api.signIn).toHaveBeenCalledWith(wallet.toBase58());
  expect(screen.getByTestId('explore-book')).toBeTruthy();
});

test('格子、進度、接受 timed_goal（選 30 分、時區、冪等 key）、可開啟 → claim → 已收藏；GPS 未開放註記', async () => {
  api.quests.mockResolvedValue({ templates, enrollments: [enrollment({})], cosmetics: [], rules });
  await render(<ExploreScreen />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByTestId('explore-book')).toBeTruthy());
  expect(screen.getByTestId('explore-cell-chapter_01_three_days-dark')).toBeTruthy();
  expect(screen.getByTestId('explore-quest-three_days-active')).toBeTruthy();
  expect(screen.getByTestId('explore-progress-three_days').props.children).toBe('Progress 1 / 3');
  expect(screen.getByTestId('explore-gps-note')).toBeTruthy();
  expect(screen.queryByTestId('explore-template-three_days')).toBeNull(); // 已接受不再列
  // 接受 timed_goal（30 分）
  await fireEvent.press(screen.getByTestId('explore-minutes-30'));
  api.acceptQuest.mockResolvedValueOnce({ enrollment: enrollment({ enrollment_id: 'e2', template_id: 'timed_goal', goal: { minutes: 30 }, progress: { current: 0, target: 1 } }), already: false });
  api.quests.mockResolvedValue({ templates, enrollments: [enrollment({ status: 'completed', progress: { current: 3, target: 3 } }), enrollment({ enrollment_id: 'e2', template_id: 'timed_goal', goal: { minutes: 30 }, progress: { current: 0, target: 1 } })], cosmetics: [], rules });
  await fireEvent.press(screen.getByTestId('explore-accept-timed_goal'));
  await waitFor(() => expect(screen.getByTestId('explore-success')).toBeTruthy());
  expect(api.acceptQuest).toHaveBeenCalledWith(expect.objectContaining({ template_id: 'timed_goal', goal: { minutes: 30 }, idempotency_key: '11111111-2222-4333-8444-555555555555', timezone: expect.any(String) }));
  await waitFor(() => expect(screen.getByTestId('explore-quest-three_days-completed')).toBeTruthy());
  expect(screen.getByText('Finish one 30-minute time goal')).toBeTruthy();
  // 開啟一格
  api.claimQuest.mockResolvedValueOnce({ receipt: { receipt_id: 'r1', cosmetic_id: 'chapter_01_three_days', issued_at: '2026-09-18T00:00:00Z' }, already: false, enrollment: enrollment({ status: 'claimed' }) });
  api.quests.mockResolvedValue({ templates, enrollments: [enrollment({ status: 'claimed', progress: { current: 3, target: 3 } })], cosmetics: [{ cosmetic_id: 'chapter_01_three_days', receipt_id: 'r1', status: 'active', granted_at: '2026-09-18T00:00:00Z' }], rules: { ...rules, gps_rewards_enabled: true } });
  await fireEvent.press(screen.getByTestId('explore-claim-three_days'));
  await waitFor(() => expect(screen.getByText('“Three-Day Path” look added to your explore book.')).toBeTruthy());
  await waitFor(() => expect(screen.getByTestId('explore-cell-chapter_01_three_days-lit')).toBeTruthy());
  expect(screen.getByTestId('explore-quest-three_days-claimed')).toBeTruthy();
  expect(screen.queryByTestId('explore-gps-note')).toBeNull();
  await fireEvent.press(screen.getByTestId('explore-record'));
  expect(mockNav.navigate).toHaveBeenCalledWith('WorkoutStart');
  await act(async () => {});
});
