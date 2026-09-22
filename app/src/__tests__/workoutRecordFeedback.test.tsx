/** 2026-09-19 第二輪 review：記錄頁把儲存狀態、配速過期、finish 失敗接到畫面；精簡／詳細模式；常亮遵守偏好。 */
import { NavigationContainer } from '@react-navigation/native';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { WorkoutRecordScreen } from '@/screens/workouts/WorkoutRecordScreen';
import { useRecorder } from '@/screens/workouts/useRecorder';
import { workoutRecorder, type RecorderSnapshot } from '@/services/workouts/WorkoutRecorder';
import { useWorkoutPrefs } from '@/state/workoutPrefsStore';
import * as notifications from '@/services/workouts/notificationChannel';
import { ThemeProvider } from '@/theme';

jest.mock('@/screens/workouts/useRecorder', () => ({ useRecorder: jest.fn() }));
jest.mock('expo-keep-awake', () => ({ activateKeepAwakeAsync: jest.fn(async () => {}), deactivateKeepAwake: jest.fn(async () => {}) }));
const keepAwake = jest.requireMock('expo-keep-awake') as { activateKeepAwakeAsync: jest.Mock; deactivateKeepAwake: jest.Mock };
const mockSnapshot = useRecorder as jest.MockedFunction<typeof useRecorder>;

const base = (): RecorderSnapshot => ({ ...workoutRecorder.snapshot(), state: 'recording', sessionId: 's1', sport: 'run', intent: 'run', gps: 'ok', distanceMm: 1_200_000, movingMs: 400_000, elapsedMs: 400_000, currentPaceSPerKm: 333, accepted: 400, fixes: 400, lastAccuracyM: 8, path: [{ seq: 0, monotonicMs: 0, utcMs: 0, lat: 25, lon: 121.5, accuracyM: 5 }, { seq: 1, monotonicMs: 1000, utcMs: 1000, lat: 25.001, lon: 121.5, accuracyM: 5 }], splits: [{ kind: 'split', index: 1, startElapsedMs: 0, endElapsedMs: 333_000, distanceMm: 1_000_000, durationMs: 333_000, paceSPerKm: 333, isPartial: false, uncertain: false }] });
const show = async (overrides: Partial<RecorderSnapshot> = {}) => {
  mockSnapshot.mockReturnValue({ ...base(), ...overrides });
  return render(<ThemeProvider><NavigationContainer><WorkoutRecordScreen /></NavigationContainer></ThemeProvider>);
};

beforeEach(() => {
  jest.clearAllMocks();
  useWorkoutPrefs.setState({ detailView: false, keepAwake: true, haptic: false });
});

test('review 9：預設精簡——主數字、四格、控制列都在；分段表、軌跡、速度曲線、配速比較與定位診斷不顯示；切到詳細後出現', async () => {
  await show();
  expect(screen.getByTestId('record-primary')).toBeTruthy();
  expect(screen.getByTestId('record-distance')).toBeTruthy();
  expect(screen.getByTestId('record-time')).toBeTruthy();
  expect(screen.getByTestId('record-avg')).toBeTruthy();
  expect(screen.getByTestId('record-pause')).toBeTruthy();
  expect(screen.getByTestId('record-lap')).toBeTruthy();
  expect(screen.queryByTestId('record-splits')).toBeNull();
  expect(screen.queryByTestId('record-trace')).toBeNull();
  expect(screen.queryByTestId('record-gps-diag')).toBeNull();
  expect(screen.queryByTestId('record-vs-avg')).toBeNull();
  expect(screen.getByTestId('record-total-time')).toBeTruthy(); // 精簡模式仍看得到總時間
  await fireEvent.press(screen.getByTestId('record-detail-toggle'));
  expect(useWorkoutPrefs.getState().detailView).toBe(true);
  await waitFor(() => expect(screen.getByTestId('record-splits')).toBeTruthy());
  expect(screen.getByTestId('record-trace')).toBeTruthy();
  expect(screen.getByTestId('record-gps-diag')).toBeTruthy();
});

test('review 9：精簡模式下 GPS 有狀況時診斷列自動出現', async () => {
  await show({ gps: 'poor', lastAccuracyM: 35 });
  expect(screen.getByTestId('record-gps-diag').props.children).toContain('35');
});

test('實機：看門狗重啟／備援定位時診斷列自動出現並標示', async () => {
  await show({ gps: 'searching', fixes: 0, accepted: 0, lastAccuracyM: null, gpsRestarts: 1, gpsFallback: true });
  const text = screen.getByTestId('record-gps-diag').props.children as string;
  expect(text).toContain('GPS auto-restarted ×1');
  expect(text).toContain('fallback GPS on');
});

test('review 3：配速過期 → 主數字 —、顯示「定位恢復中」、距離照常', async () => {
  await show({ paceStale: true, currentPaceSPerKm: null, currentSpeedMs: null, gps: 'poor', lastAccuracyM: 90 });
  expect(screen.getByTestId('record-primary').props.children).toBe('—');
  expect(screen.getByTestId('record-pace-stale')).toBeTruthy();
  expect(screen.getByTestId('record-distance').props.children).toBe('1.20');
});

test('review 5：storage.failing → 顯示「正在重試（N 點待存）」', async () => {
  await show({ storage: { pendingPoints: 37, failing: true, lastError: 'disk full' } });
  expect(screen.getByTestId('record-storage-failing').props.children).toMatch(/37/);
  const view = await show({ storage: { pendingPoints: 0, failing: false, lastError: null } });
  expect(view.queryByTestId('record-storage-failing')).toBeNull();
});

test('review 5：finish 寫入失敗 → 留在本頁顯示錯誤與「重試保存」；重試成功 → 導向摘要', async () => {
  jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, b) => b?.find((x) => x.style === 'destructive')?.onPress?.());
  const finish = jest.spyOn(workoutRecorder, 'finish').mockRejectedValueOnce(new Error('ENOSPC'));
  const retry = jest.spyOn(workoutRecorder, 'retryFinish').mockResolvedValueOnce({ meta: { sessionId: 's1' } as never, summary: {} as never, sync: Promise.resolve({ ok: true }) });
  await show({ state: 'paused' });
  await fireEvent.press(screen.getByTestId('record-finish'));
  await waitFor(() => expect(screen.getByTestId('record-finish-failed')).toBeTruthy());
  expect(screen.getByText(/ENOSPC/)).toBeTruthy();
  expect(finish).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByText('Retry save'));
  await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
});

test('review 5：recorder 自己回報 finishError（例如畫面重開）也會顯示重試卡', async () => {
  await show({ state: 'finishing', finishError: 'EIO' });
  expect(screen.getByTestId('record-finish-failed')).toBeTruthy();
  expect(screen.getByText(/EIO/)).toBeTruthy();
});

test('review 10：螢幕常亮遵守偏好；recording 時啟用、暫停時解除；偏好關閉不啟用', async () => {
  const view = await show({ state: 'recording' });
  expect(keepAwake.activateKeepAwakeAsync).toHaveBeenCalledWith('workout-record');
  // 同一個畫面從 recording 進入 paused：解除常亮（省電）
  mockSnapshot.mockReturnValue({ ...base(), state: 'paused' });
  await act(async () => { view.rerender(<ThemeProvider><NavigationContainer><WorkoutRecordScreen /></NavigationContainer></ThemeProvider>); });
  expect(keepAwake.deactivateKeepAwake).toHaveBeenCalledWith('workout-record');
  await act(async () => { cleanup(); });
  keepAwake.activateKeepAwakeAsync.mockClear();
  useWorkoutPrefs.setState({ keepAwake: false });
  await show({ state: 'recording' });
  expect(keepAwake.activateKeepAwakeAsync).not.toHaveBeenCalled();
});

test('review 2：時間目標進度與達標以運動時間計；文案標示 moving', async () => {
  await show({ goal: { kind: 'time', target: 600, unit: 's', version: 2 }, goalReached: false, movingMs: 300_000, elapsedMs: 900_000, pausedMs: 600_000 });
  expect(screen.getByTestId('record-goal-bar').props.accessibilityValue.now).toBe(50);
  expect(screen.getByTestId('record-goal').props.children).toBe('Goal 10 min moving');
});


test('通知被關閉時，未鎖定的記錄畫面也顯示設定入口並設定返回目標', async () => {
  const channel = jest.spyOn(notifications, 'ensureWorkoutChannel').mockReturnValue({ importance: 0, silenced: true, appNotificationsEnabled: false });
  const target = jest.spyOn(notifications, 'setWorkoutReturnTarget').mockImplementation(() => {});
  try {
    await show();
    expect(screen.getByTestId('record-notification-warning')).toBeTruthy();
    expect(screen.queryByTestId('record-lock-overlay')).toBeNull();
    expect(target).toHaveBeenCalled();
    expect(screen.getByTestId('record-control-hint').props.children).toBe('To finish, tap Pause first.');
  } finally {
    await cleanup();
    channel.mockRestore();
    target.mockRestore();
  }
});
