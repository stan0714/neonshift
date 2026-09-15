/** PG-R-06：開始頁（室內不啟用 GPS、權限拒絕引導）、記錄頁（跑步配速／走路速度、Lap／Pause／Resume／Finish 確認）、摘要頁（分段／圈數／品質、同步狀態）。 */
import { NavigationContainer } from '@react-navigation/native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';
import { Alert } from 'react-native';

import type { RawPoint } from '@/domain/gps/engine';
import { WorkoutRecordScreen } from '@/screens/workouts/WorkoutRecordScreen';
import { WorkoutStartScreen } from '@/screens/workouts/WorkoutStartScreen';
import { WorkoutSummaryScreen } from '@/screens/workouts/WorkoutSummaryScreen';
import { workoutRecorder } from '@/services/workouts/WorkoutRecorder';
import { ThemeProvider } from '@/theme';

jest.mock('expo-crypto', () => { let n = 0; return { randomUUID: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` }; });
const mockNav = { navigate: jest.fn(), dispatch: jest.fn() };
let mockRoute: { params: Record<string, string> } = { params: {} };
jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useNavigation: () => mockNav, useRoute: () => mockRoute }));
jest.mock('@/services/api/ApiClient', () => ({ ...jest.requireActual('@/services/api/ApiClient'), apiClient: { importWorkouts: jest.fn(async (sessions: { external_record_id: string }[]) => ({ imported: 1, results: sessions.map((s) => ({ external_record_id: s.external_record_id, outcome: 'created', session: { session_id: 'server-9' } })) })) } }));
const sync = (jest.requireMock('@/services/api/ApiClient') as { apiClient: { importWorkouts: jest.Mock } }).apiClient.importWorkouts;
let clock = 1_000_000;
jest.spyOn(Date, 'now').mockImplementation(() => clock);
const recorder = workoutRecorder;
const loc = jest.requireMock('expo-location') as Record<string, jest.Mock>;
const fsMock = jest.requireMock('expo-file-system') as { __reset: () => void };

const Wrapper = ({ children }: PropsWithChildren) => (
  <ThemeProvider>
    <NavigationContainer>{children}</NavigationContainer>
  </ThemeProvider>
);
const M_PER_DEG_LAT = 111_195;
const pts = (n: number, startMs: number, seqStart = 0, speed = 3): RawPoint[] => Array.from({ length: n }, (_, i) => ({ seq: seqStart + i, monotonicMs: startMs + i * 1000, utcMs: startMs + i * 1000, lat: 25 + (speed * (seqStart + i)) / M_PER_DEG_LAT, lon: 121.5, accuracyM: 5 }));

beforeEach(() => {
  jest.clearAllMocks();
  loc.getForegroundPermissionsAsync.mockResolvedValue({ granted: true });
});

test('開始頁：室內停用開始並導向匯入；權限拒絕顯示引導；戶外跑步 → recorder.start（400 m 自動圈、英里分段）→ 記錄頁', async () => {
  fsMock.__reset();
  await render(<WorkoutStartScreen />, { wrapper: Wrapper });
  await fireEvent.press(screen.getByTestId('start-env-indoor'));
  expect(screen.getByTestId('start-indoor')).toBeTruthy();
  expect(screen.getByTestId('start-go').props.accessibilityState.disabled).toBe(true);
  await fireEvent.press(screen.getByTestId('start-env-outdoor'));
  loc.getForegroundPermissionsAsync.mockResolvedValueOnce({ granted: false });
  loc.requestForegroundPermissionsAsync.mockResolvedValueOnce({ granted: false });
  await fireEvent.press(screen.getByTestId('start-go'));
  await waitFor(() => expect(screen.getByTestId('start-permission')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('start-autolap-400'));
  await fireEvent.press(screen.getByTestId('start-units-mi'));
  await fireEvent.press(screen.getByTestId('start-go'));
  await waitFor(() => expect(mockNav.navigate).toHaveBeenCalledWith('WorkoutRecord'));
  expect(recorder.snapshot()).toMatchObject({ state: 'recording', sport: 'run' });
  expect(loc.startLocationUpdatesAsync).toHaveBeenCalled();
  await act(async () => {});
});

test('記錄頁：跑步顯示配速、時間／距離；Lap；Pause 後顯示 Resume／Finish；Finish 需確認 → 摘要頁', async () => {
  jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, b) => b?.find((x) => x.style === 'destructive')?.onPress?.());
  await render(<WorkoutRecordScreen />, { wrapper: Wrapper });
  expect(screen.getByTestId('record-primary').props.children).toBe('—'); // 不足 5 秒窗
  await act(async () => {
    recorder.ingest(pts(120, clock));
    clock += 120_000;
  });
  await waitFor(() => expect(screen.getByTestId('record-distance').props.children).toBe('0.36'));
  expect(screen.getByTestId('record-primary').props.children).toBe('5:33');
  await waitFor(() => expect(screen.getByText('GPS · searching')).toBeTruthy(), { timeout: 3000 }); // 時鐘已推進 120 s、最後一點在 120 s 前（每秒刷新）
  await fireEvent.press(screen.getByTestId('record-lap'));
  await waitFor(() => expect(screen.getByText('Lap 1')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('record-pause'));
  await waitFor(() => expect(screen.getByTestId('record-resume')).toBeTruthy());
  expect(screen.getByText('Paused')).toBeTruthy();
  clock += 5_000;
  await fireEvent.press(screen.getByTestId('record-finish'));
  await waitFor(() => expect(mockNav.dispatch).toHaveBeenCalled());
  const summaryId = recorder.snapshot().state === 'idle' ? (sync.mock.calls[0]![0] as { external_record_id: string }[])[0]!.external_record_id : '';
  expect(summaryId).toBeTruthy();
  mockRoute = { params: { sessionId: summaryId } };
  await act(async () => {});
});

test('摘要頁：距離／時間／平均配速／最高 5 秒／kcal —；分段含末段 Partial；圈數含手動圈與 400 m 自動圈；品質；已同步', async () => {
  await render(<WorkoutSummaryScreen />, { wrapper: Wrapper });
  expect(screen.getByTestId('sum-distance').props.children).toBe('0.36 km');
  expect(screen.getByText('—')).toBeTruthy(); // kcal 無裝置值
  expect(screen.getByTestId('sum-sync').props.children).toBe('Synced to your account');
  expect(screen.getByTestId('sum-split-1')).toBeTruthy();
  expect(screen.getByText('Partial')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('sum-tab-laps'));
  expect(screen.getByTestId('sum-manual-1')).toBeTruthy();
  expect(screen.getByTestId('sum-auto_distance-1')).toBeTruthy(); // 357 m < 400 m：只有末段 partial 自動圈
  expect(screen.getAllByText('Partial').length).toBeGreaterThan(0);
  await fireEvent.press(screen.getByTestId('sum-tab-quality'));
  expect(screen.getByText('120 points accepted')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('sum-done'));
  expect(mockNav.navigate).toHaveBeenCalledWith('Workouts');
});
