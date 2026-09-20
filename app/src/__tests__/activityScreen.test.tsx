/** PG-LINK-04：我的運動畫面——本機＋伺服器合併去重、由舊到新預設可切換並記住、月份切換、篩選、月曆、空狀態、離線／訪客、詳情導向。 */
import { NavigationContainer } from '@react-navigation/native';
import { PublicKey } from '@solana/web3.js';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';
import { Alert } from 'react-native';

import { ActivityScreen } from '@/screens/activity/ActivityScreen';
import { ActivityDetailScreen } from '@/screens/activity/ActivityDetailScreen';
import { ApiError } from '@/services/api/ApiClient';
import { workoutRecorder } from '@/services/workouts/WorkoutRecorder';
import { workoutOutbox } from '@/services/workouts/WorkoutOutbox';
import { useWalletStore } from '@/state/walletStore';
import { useWorkoutPrefs } from '@/state/workoutPrefsStore';
import { ThemeProvider } from '@/theme';

const mockNav = { navigate: jest.fn(), goBack: jest.fn() };
let mockRoute: { params: Record<string, string> | undefined } = { params: { month: '2026-09' } };
jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useNavigation: () => mockNav, useRoute: () => mockRoute }));
jest.mock('@/services/api/ApiClient', () => ({ ...jest.requireActual('@/services/api/ApiClient'), apiClient: { myWorkouts: jest.fn(), workout: jest.fn(), signIn: jest.fn() } }));
const api = jest.requireMock('@/services/api/ApiClient').apiClient as Record<'myWorkouts' | 'workout' | 'signIn', jest.Mock>;
const fsMock = jest.requireMock('expo-file-system') as { __reset: () => void };
const Wrapper = ({ children }: PropsWithChildren) => (<ThemeProvider><NavigationContainer>{children}</NavigationContainer></ThemeProvider>);
const owner = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const remote = (id: string, startedAt: string, extra: Record<string, unknown> = {}) => ({ session_id: id, sport: 'walk', environment: 'unknown', intent: 'brisk', goal: null, source: { origin: 'health_connect', source_id: 'hc', external_record_id: `x-${id}`, source_revision: 1 }, started_at: startedAt, ended_at: new Date(Date.parse(startedAt) + 1_500_000).toISOString(), elapsed_ms: '1500000', paused_ms: '0', status: 'saved', quality: 'complete', rules_version: 1, review_reasons: [], possible_duplicate_of: null, metrics: { distance: { value_mm: '2400000', method: 'device' }, steps: 3000, active_energy: null, total_energy: null, avg_pace_s_per_km: null, avg_speed_kmh: 5.76, step_length_mm: null }, pb_eligible: false, extras: {}, revision: 1, imported_at: startedAt, updated_at: startedAt, ...extra });

async function seedLocal() {
  const store = workoutRecorder.localStore();
  const mk = async (id: string, day: number, o: Record<string, unknown> = {}) => {
    const m = await store.create({ sessionId: id, sport: 'run', intent: 'run', goal: null, environment: 'outdoor', autoLapMm: null, splitLengthMm: 1_000_000, status: 'saved', startedAtUtc: Date.UTC(2026, 8, day, 1), startedMonoMs: 0, processId: 'p', owner, recordedTimeZone: 'Asia/Taipei', shoeSnapshot: { shoeId: 'wild-guardians-v1:2', level: 2, variant: 'dawn' }, ...o } as never);
    m.endedAtUtc = m.startedAtUtc + 1_800_000;
    m.summary = { distanceMm: 5_000_000, elapsedMs: 1_800_000, movingMs: 1_700_000, movingAvgPaceSPerKm: 340, avgPaceSPerKm: 360, movingAvgSpeedKmh: null, avgSpeedKmh: null, splits: [], laps: [] } as never;
    Object.assign(m, o); // create() 會把 syncedSessionId 等欄位重設
    await store.writeMeta(m);
  };
  await mk('l19', 19);
  await mk('l17', 17);
  await mk('l18', 18, { syncedSessionId: 'srv-18' });
}

beforeEach(async () => {
  jest.clearAllMocks();
  fsMock.__reset();
  mockRoute = { params: { month: '2026-09' } };
  useWorkoutPrefs.setState({ activityOrder: 'asc', activityView: 'list' });
  useWalletStore.setState({ status: 'connected', session: { address: owner, publicKey: new PublicKey(owner), walletUriBase: '', label: 'Phantom' }, error: null } as never);
  await seedLocal();
  api.myWorkouts.mockResolvedValue({ items: [remote('srv-18', '2026-09-18T01:00:00Z', { sport: 'run', intent: 'run', source: { origin: 'gps', source_id: 'cc.neonshift.app/gps', external_record_id: 'l18', source_revision: 1 } }), remote('srv-hc', '2026-09-20T02:00:00Z')], rules_version: 1, next_cursor: null });
});

test('合併本機＋伺服器、去重、預設由舊到新；月總覽；狀態文字；點本機列 → 摘要頁、伺服器列 → 詳情頁；排序切換記住', async () => {
  await render(<ActivityScreen />, { wrapper: Wrapper });
  await waitFor(() => expect(api.myWorkouts).toHaveBeenCalled());
  expect(api.myWorkouts.mock.calls[0]![0]).toMatchObject({ order: 'asc', from: expect.stringMatching(/^2026-08-31/), to: expect.stringMatching(/^2026-10-02/) });
  await waitFor(() => expect(screen.getByTestId('activity-item-srv-hc')).toBeTruthy());
  const ids = screen.getAllByTestId(/^activity-item-(l17|srv-18|l19|srv-hc)$/).map((n) => n.props.testID);
  expect(ids).toEqual(['activity-item-l17', 'activity-item-srv-18', 'activity-item-l19', 'activity-item-srv-hc']); // 已同步 l18＝srv-18 只有一列
  // 儀表板（PG-LINK-06）：大數字公里、次數、平均配速＝總時間／總距離、時間；月檢視長條每天一桶
  expect(screen.getByTestId('activity-hero-km').props.children).toBe('17.4');
  expect(screen.getByTestId('activity-hero-count').props.children).toBe(4);
  expect(screen.getByTestId('activity-hero-time').props.children).toBe('1:55:00');
  expect(screen.getByTestId('activity-hero-pace').props.children).toBe('6:37 /km'); // 6900 s ÷ 17.4 km
  expect(screen.getByTestId('activity-month').props.children).toBe('September 2026');
  // 自動命名（週幾＋時段＋模式，依 session 時區）與路線縮圖（本機有點 → 折線；伺服器摘要 → 只有底圖）
  expect(screen.getByTestId('activity-item-title-l17').props.children).toBe('Thursday Morning Run'); // 2026-09-17 01:00Z ＝ 台北 09:00
  expect(screen.getByTestId('activity-item-title-srv-hc').props.children).toBe('Sunday Morning Brisk walk');
  expect(screen.getByTestId('activity-thumb-srv-hc-blank', { includeHiddenElements: true })).toBeTruthy();
  expect(screen.getByTestId('activity-item-status-l17').props.children).toMatch(/Asian Elephant · Recorded here · Queued/);
  expect(screen.getByTestId('activity-item-status-srv-18').props.children).toMatch(/Synced/);
  expect(screen.getByTestId('activity-item-status-srv-hc').props.children).toMatch(/^Imported · Server summary$/);
  await fireEvent.press(screen.getByTestId('activity-item-l17'));
  expect(mockNav.navigate).toHaveBeenCalledWith('WorkoutSummary', { sessionId: 'l17' });
  await fireEvent.press(screen.getByTestId('activity-item-srv-hc'));
  expect(mockNav.navigate).toHaveBeenCalledWith('ActivityDetail', { serverId: 'srv-hc' });
  await fireEvent.press(screen.getByTestId('activity-order'));
  await waitFor(() => expect(useWorkoutPrefs.getState().activityOrder).toBe('desc'));
  const ids2 = screen.getAllByTestId(/^activity-item-(l17|srv-18|l19|srv-hc)$/).map((n) => n.props.testID);
  expect(ids2[0]).toBe('activity-item-srv-hc');
  await act(async () => {});
});

test('篩選：預設收合、展開後跑步／健走、來源、狀態；作用中數量與清除；月曆檢視點日期只看該日；換月份重新查詢；空狀態引導', async () => {
  await render(<ActivityScreen />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByTestId('activity-item-srv-hc')).toBeTruthy());
  expect(screen.queryByTestId('activity-mode-brisk')).toBeNull();
  await fireEvent.press(screen.getByTestId('activity-filters-toggle'));
  await fireEvent.press(screen.getByTestId('activity-mode-brisk'));
  expect(screen.getByText('Filters · 1 active')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('activity-filters-clear'));
  expect(screen.getByText('Filters')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('activity-mode-brisk'));
  expect(screen.queryByTestId('activity-item-l17')).toBeNull();
  expect(screen.getByTestId('activity-item-srv-hc')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('activity-mode-all'));
  await fireEvent.press(screen.getByTestId('activity-status-local'));
  expect(screen.getAllByTestId(/^activity-item-(l17|srv-18|l19|srv-hc)$/).map((n) => n.props.testID)).toEqual(['activity-item-l17', 'activity-item-l19']);
  await fireEvent.press(screen.getByTestId('activity-status-local')); // 再點取消
  await fireEvent.press(screen.getByTestId('activity-view-calendar'));
  await waitFor(() => expect(screen.getByTestId('activity-calendar')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('activity-day-2026-09-19'));
  expect(screen.getAllByTestId(/^activity-item-(l17|srv-18|l19|srv-hc)$/).map((n) => n.props.testID)).toEqual(['activity-item-l19']);
  await fireEvent.press(screen.getByTestId('activity-next-month'));
  await waitFor(() => expect(api.myWorkouts).toHaveBeenLastCalledWith(expect.objectContaining({ from: expect.stringMatching(/^2026-09-30/) })));
  api.myWorkouts.mockResolvedValue({ items: [], rules_version: 1, next_cursor: null });
  await waitFor(() => expect(screen.getByTestId('activity-empty')).toBeTruthy());
  expect(useWorkoutPrefs.getState().activityView).toBe('calendar');
  await act(async () => {});
});

test('離線／未登入：伺服器失敗仍列本機紀錄並說明；訪客只看訪客紀錄', async () => {
  api.myWorkouts.mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'offline'));
  await render(<ActivityScreen />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByTestId('activity-remote-offline')).toBeTruthy());
  expect(screen.getAllByTestId(/^activity-item-(l17|srv-18|l19)$/)).toHaveLength(3);
  useWalletStore.setState({ status: 'disconnected', session: null, error: null } as never);
  await waitFor(() => expect(screen.getByText(/No wallet connected/)).toBeTruthy());
  expect(screen.queryByTestId('activity-item-l17')).toBeNull();
  await act(async () => {});
});

test('伺服器摘要詳情：欄位、無分段說明、無路線說明；404 → 找不到', async () => {
  mockRoute = { params: { serverId: 'srv-hc' } };
  api.workout.mockResolvedValueOnce(remote('srv-hc', '2026-09-20T02:00:00Z', { extras: { recorded_time_zone: 'Asia/Taipei' } }));
  await render(<ActivityDetailScreen />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByTestId('activity-detail-distance').props.children).toBe('2.40 km'));
  expect(screen.getByText('3000')).toBeTruthy();
  expect(screen.getByTestId('activity-detail-no-splits')).toBeTruthy();
  expect(screen.getByText(/Server summaries carry no route/)).toBeTruthy();
  api.workout.mockRejectedValueOnce(new ApiError(404, 'NOT_FOUND', 'workout not found'));
  mockRoute = { params: { serverId: 'gone' } };
  await render(<ActivityDetailScreen />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByTestId('activity-detail-error')).toBeTruthy());
  expect(screen.getByText(/Workout not found/)).toBeTruthy();
  await act(async () => {});
});

test('訪客／升版前紀錄（無 owner）：列出並標待審核；連錢包時可一鍵歸屬 → 進佇列', async () => {
  const store = workoutRecorder.localStore();
  const m = await store.create({ sessionId: 'g16', sport: 'run', intent: 'run', goal: null, environment: 'outdoor', autoLapMm: null, splitLengthMm: 1_000_000, status: 'needs_review', startedAtUtc: Date.UTC(2026, 8, 16, 1), startedMonoMs: 0, processId: 'p', recordedTimeZone: 'Asia/Taipei' } as never);
  m.endedAtUtc = m.startedAtUtc + 600_000;
  m.summary = { distanceMm: 0, elapsedMs: 600_000, movingMs: 0, movingAvgPaceSPerKm: null, avgPaceSPerKm: null, movingAvgSpeedKmh: null, avgSpeedKmh: null, splits: [], laps: [] } as never;
  m.status = 'needs_review';
  await store.writeMeta(m);
  await render(<ActivityScreen />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByTestId('activity-item-g16')).toBeTruthy());
  expect(screen.getByTestId('activity-item-status-g16').props.children).toBe('Recorded here · Local only · Under review'); // 無鞋款快照不顯示「未設定」；待審核明說
  const spy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => { (buttons as { onPress?: () => void }[])[1]!.onPress?.(); });
  await fireEvent.press(screen.getByTestId('activity-sync-assign'));
  await waitFor(() => expect(screen.queryByTestId('activity-sync-assign')).toBeNull());
  expect(store.readMeta('g16')?.owner).toBe(owner);
  spy.mockRestore();
});

test('儀表板期間：週／年／全部切換並記住、‹ › 換期間重新查詢、長條點一桶只看該桶；全部期間不帶日期範圍', async () => {
  await render(<ActivityScreen />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByTestId('activity-item-srv-hc')).toBeTruthy());
  await fireEvent(screen.getByTestId('activity-chart'), 'layout', { nativeEvent: { layout: { width: 360, height: 180 } } });
  await waitFor(() => expect(screen.getByTestId('activity-bar-2026-09-17')).toBeTruthy());
  expect(screen.getByTestId('activity-chart-avg').props.children).toBe('4.3'); // 有紀錄的 4 天平均 17.4／4
  await fireEvent.press(screen.getByTestId('activity-bar-2026-09-17'));
  expect(screen.getAllByTestId(/^activity-item-(l17|srv-18|l19|srv-hc)$/).map((n) => n.props.testID)).toEqual(['activity-item-l17']);
  await fireEvent.press(screen.getByTestId('activity-bar-2026-09-17'));
  expect(screen.getAllByTestId(/^activity-item-(l17|srv-18|l19|srv-hc)$/).length).toBe(4);
  // 年：12 桶、標籤為年；上一年重新查詢
  api.myWorkouts.mockClear();
  await fireEvent.press(screen.getByTestId('activity-period-year'));
  await waitFor(() => expect(useWorkoutPrefs.getState().activityPeriod).toBe('year'));
  await waitFor(() => expect(api.myWorkouts).toHaveBeenCalled());
  expect(api.myWorkouts.mock.calls.at(-1)![0]).toMatchObject({ from: expect.stringMatching(/^2025-12-31/), to: expect.stringMatching(/^2027-01-02/) });
  await fireEvent(screen.getByTestId('activity-chart'), 'layout', { nativeEvent: { layout: { width: 360, height: 180 } } });
  await waitFor(() => expect(screen.getByTestId('activity-bar-2026-09')).toBeTruthy());
  expect(screen.getByTestId('activity-month').props.children).toBe('2026');
  await fireEvent.press(screen.getByTestId('activity-prev-month'));
  await waitFor(() => expect(screen.getByTestId('activity-month').props.children).toBe('2025'));
  expect(api.myWorkouts.mock.calls.at(-1)![0]).toMatchObject({ from: expect.stringMatching(/^2024-12-31/) });
  // 全部：不帶範圍、沒有 ‹ ›
  await fireEvent.press(screen.getByTestId('activity-period-all'));
  await waitFor(() => expect(api.myWorkouts.mock.calls.at(-1)![0]).toEqual({ order: 'asc', limit: 100, cursor: undefined }));
  expect(screen.queryByTestId('activity-prev-month')).toBeNull();
  expect(screen.getByTestId('activity-month').props.children).toBe('All time');
  await act(async () => {});
});

test('回首頁：有待同步且在線 → 先問；「不同步」直接回首頁、「先同步」啟動佇列再回首頁；沒有待同步 → 直接回', async () => {
  const runSpy = jest.spyOn(workoutOutbox, 'run').mockResolvedValue({ code: 'DISABLED' } as never);
  await render(<ActivityScreen />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByTestId('activity-item-l17')).toBeTruthy());
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await fireEvent.press(screen.getByTestId('activity-home'));
  expect(alert).toHaveBeenCalledTimes(1);
  expect(alert.mock.calls[0]![0]).toBe('2 workouts not synced yet');
  const buttons = alert.mock.calls[0]![2] as { text: string; onPress?: () => void }[];
  expect(buttons.map((b) => b.text)).toEqual(['Cancel', 'Go home without syncing', 'Sync, then go home']);
  buttons[1]!.onPress?.();
  expect(mockNav.navigate).toHaveBeenLastCalledWith('Main', { screen: 'Home' });
  expect(runSpy).not.toHaveBeenCalled();
  buttons[2]!.onPress?.();
  expect(runSpy).toHaveBeenCalledWith(owner, { manual: true });
  alert.mockRestore();
  runSpy.mockRestore();
});
