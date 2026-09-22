/** XD-01 可操作任務卡：卡面欄位／狀態／下一步；「開始」帶入目標到開始頁；進行中改「回到記錄」；重複接受回同一份；離線顯示快照且不出領取鈕；開始頁套用預填。 */
import { NavigationContainer } from '@react-navigation/native';
import { PublicKey } from '@solana/web3.js';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';

import { ExploreScreen } from '@/screens/ExploreScreen';
import type { QuestEnrollmentView, QuestTemplateView } from '@/services/api/ApiClient';
import { useQuestCache } from '@/state/questCacheStore';
import { useWalletStore } from '@/state/walletStore';
import { ThemeProvider } from '@/theme';

jest.mock('expo-crypto', () => ({ randomUUID: () => '11111111-2222-4333-8444-555555555555' }));
const mockNav = { navigate: jest.fn() };
jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useNavigation: () => mockNav }));
jest.mock('@/services/api/ApiClient', () => ({ ...jest.requireActual('@/services/api/ApiClient'), apiClient: { quests: jest.fn(), acceptQuest: jest.fn(), claimQuest: jest.fn(), signIn: jest.fn() } }));
const mockActive = jest.fn<null | { sessionId: string }, []>(() => null);
jest.mock('@/services/workouts/WorkoutRecorder', () => ({ workoutRecorder: { active: () => mockActive() } }));
const api = jest.requireMock('@/services/api/ApiClient').apiClient as Record<'quests' | 'acceptQuest' | 'claimQuest' | 'signIn', jest.Mock>;
const { ApiError } = jest.requireActual('@/services/api/ApiClient');
const Wrapper = ({ children }: PropsWithChildren) => (
  <ThemeProvider>
    <NavigationContainer>{children}</NavigationContainer>
  </ThemeProvider>
);
const wallet = new PublicKey('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
const card = (over: Record<string, unknown> = {}) => ({ source: 'system', difficulty: 'easy', requirements: { min_active_minutes: 10, sports: ['run', 'walk'], gps_counts: false, needs_sync: true }, reward: { kind: 'cosmetic', cosmetic_id: 'chapter_01_timed_goal' }, start: { goal: { kind: 'time', minutes: 30 } }, ...over }) as QuestTemplateView['card'];
const templates: QuestTemplateView[] = [
  { template_id: 'three_days', version: 1, kind: 'active_days', params: { days: 3 }, cosmetic_id: 'chapter_01_three_days', card: card({ difficulty: 'medium', reward: { kind: 'cosmetic', cosmetic_id: 'chapter_01_three_days' }, start: { goal: { kind: 'free' } } }) },
  { template_id: 'timed_goal', version: 1, kind: 'goal_time', params: { minutes: [10, 20, 30] }, cosmetic_id: 'chapter_01_timed_goal', card: card({ start: { goal: { kind: 'time', minutes: null } } }) },
];
const enrollment = (o: Record<string, unknown>): QuestEnrollmentView => ({ enrollment_id: 'e2', template_id: 'timed_goal', template_version: 1, goal: { minutes: 30 }, timezone: 'Asia/Taipei', period_start: '2026-09-13T16:00:00Z', period_end: '2026-09-20T16:00:00Z', late_sync_until: '2026-09-22T16:00:00Z', accepted_at: '2026-09-16T03:00:00Z', status: 'active', card_state: 'accepted', pending_review_count: 0, card: card(), completed_at: null, progress: { current: 0, target: 1 }, contributions: [], ...o }) as QuestEnrollmentView;
const rules = { min_active_minutes: 10, late_sync_hours: 48, gps_rewards_enabled: false };

beforeEach(() => {
  jest.clearAllMocks();
  mockActive.mockReturnValue(null);
  useQuestCache.setState({ loaded: true, snapshot: null });
  useWalletStore.setState({ status: 'connected', session: { address: wallet.toBase58(), publicKey: wallet, walletUriBase: '', label: 'Seeker' }, error: null } as never);
});

test('可接受卡：來源／難度／要求／獎勵／下一步；接受後回同一份（already）不建第二份', async () => {
  api.quests.mockResolvedValue({ templates, enrollments: [], cosmetics: [], rules });
  await render(<ExploreScreen />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByTestId('explore-template-timed_goal')).toBeTruthy());
  expect(screen.getAllByText('NeonShift quest · Easy').length).toBeGreaterThan(0);
  expect(screen.getByText('Reward: “Right on Time” look (no token, no XP, not an NFT)')).toBeTruthy();
  expect(screen.getAllByText('In-app GPS sessions do not count yet (Health Connect imports do)').length).toBe(2);
  expect(screen.getByTestId('quest-next-timed_goal').props.children.props.children).toBe('Next: accept this quest. Nothing is sent onchain.');
  api.acceptQuest.mockResolvedValueOnce({ enrollment: enrollment({ enrollment_id: 'e-existing' }), already: true });
  await fireEvent.press(screen.getByTestId('explore-accept-timed_goal'));
  await waitFor(() => expect(screen.getByTestId('explore-info')).toBeTruthy());
  expect(screen.getByText('Already accepted this week')).toBeTruthy();
});

test('已接受：「以這個目標開始」→ WorkoutStart 帶 preset（time 30 分、run、questId）；待驗證顯示 n 筆待審', async () => {
  api.quests.mockResolvedValue({ templates, enrollments: [enrollment({}), enrollment({ enrollment_id: 'e1', template_id: 'three_days', goal: {}, card_state: 'pending_verification', pending_review_count: 2, card: card({ start: { goal: { kind: 'free' } } }), progress: { current: 1, target: 3 } })], cosmetics: [], rules });
  await render(<ExploreScreen />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByTestId('quest-start-timed_goal')).toBeTruthy());
  expect(screen.getByText('Accepted')).toBeTruthy();
  expect(screen.getByText('Awaiting verification')).toBeTruthy();
  expect(screen.getByText('2 session(s) are under review and not counted yet. Nothing to do; this updates on its own.')).toBeTruthy();
  expect(screen.getAllByText(/^Ends /).length).toBe(2); // 兩張已接受卡都有截止（本地時間格式視環境）
  await fireEvent.press(screen.getByTestId('quest-start-timed_goal'));
  expect(mockNav.navigate).toHaveBeenCalledWith('WorkoutStart', { preset: { goal: { kind: 'time', minutes: 30 }, mode: 'run', questId: 'e2' } });
  await fireEvent.press(screen.getByTestId('quest-start-three_days'));
  expect(mockNav.navigate).toHaveBeenCalledWith('WorkoutStart', { preset: { goal: { kind: 'free' }, questId: 'e1' } });
  await act(async () => {});
});

test('進行中的運動：卡片改「回到記錄」，不再開第二場', async () => {
  mockActive.mockReturnValue({ sessionId: 's1' });
  api.quests.mockResolvedValue({ templates, enrollments: [enrollment({})], cosmetics: [], rules });
  await render(<ExploreScreen />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByTestId('quest-return-timed_goal')).toBeTruthy());
  expect(screen.queryByTestId('quest-start-timed_goal')).toBeNull();
  expect(screen.getByText('A workout is in progress. Return to it — starting another would not replace it.')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('quest-return-timed_goal'));
  expect(mockNav.navigate).toHaveBeenCalledWith('WorkoutRecord');
  await act(async () => {});
});

test('離線：顯示上次快照（as of）、可領卡不出領取鈕、接受鈕停用；重新連上後恢復', async () => {
  useQuestCache.setState({ loaded: true, snapshot: { wallet: wallet.toBase58(), asOf: '2026-09-20T01:00:00Z', data: { templates, enrollments: [enrollment({ status: 'completed', card_state: 'claimable', progress: { current: 1, target: 1 } })], cosmetics: [], rules } } });
  api.quests.mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'timeout after 15000 ms', undefined, undefined, undefined, 'timeout'));
  await render(<ExploreScreen />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByTestId('explore-offline')).toBeTruthy());
  expect(screen.queryByTestId('explore-error')).toBeNull();
  expect(screen.getByText('Ready to open — reconnect to open the cell.')).toBeTruthy();
  expect(screen.queryByTestId('explore-claim-timed_goal')).toBeNull();
  expect(screen.getByTestId('explore-accept-three_days').props.accessibilityState?.disabled).toBe(true);
  api.quests.mockResolvedValue({ templates, enrollments: [enrollment({ status: 'completed', card_state: 'claimable', progress: { current: 1, target: 1 } })], cosmetics: [], rules });
  await fireEvent.press(screen.getByText('Try again'));
  await waitFor(() => expect(screen.getByTestId('explore-claim-timed_goal')).toBeTruthy());
  expect(screen.queryByTestId('explore-offline')).toBeNull();
});

test('離線且沒有快照 → 一般錯誤卡（人話訊息）', async () => {
  api.quests.mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'timeout after 15000 ms', undefined, undefined, undefined, 'timeout'));
  await render(<ExploreScreen />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByTestId('explore-error')).toBeTruthy());
  expect(screen.getByText('The server did not respond within 15 seconds.')).toBeTruthy();
});
