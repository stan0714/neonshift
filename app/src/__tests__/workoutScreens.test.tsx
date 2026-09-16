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
import { useWorkoutPrefs } from '@/state/workoutPrefsStore';
import { ThemeProvider } from '@/theme';

jest.mock('expo-crypto', () => { let n = 0; return { randomUUID: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` }; });
const mockNav = { navigate: jest.fn(), dispatch: jest.fn() };
let mockRoute: { params: Record<string, string> } = { params: {} };
jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useNavigation: () => mockNav, useRoute: () => mockRoute }));
jest.mock('@/services/api/ApiClient', () => ({ ...jest.requireActual('@/services/api/ApiClient'), apiClient: { myWorkouts: jest.fn(async () => ({ items: [], rules_version: 1 })), importWorkouts: jest.fn(async (sessions: { external_record_id: string }[]) => ({ imported: 1, results: sessions.map((s) => ({ external_record_id: s.external_record_id, outcome: 'created', session: { session_id: 'server-9' } })) })) } }));
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

test('開始頁（NRC 版面）：GPS chip 切室內停用 START 並導向匯入；權限拒絕顯示引導；設定面板（自動圈／英里／跑道）；目標面板；戶外健走 → recorder.start → 記錄頁', async () => {
  fsMock.__reset();
  await render(<WorkoutStartScreen />, { wrapper: Wrapper });
  // 預設：跑步、自由目標、GPS 開
  expect(screen.getByTestId('start-goal-value').props.children).toBe('Free');
  expect(screen.getByTestId('start-env-label').props.children).toBe('GPS on');
  await fireEvent.press(screen.getByTestId('start-env'));
  expect(screen.getByTestId('start-indoor')).toBeTruthy();
  expect(screen.getByTestId('start-go').props.accessibilityState.disabled).toBe(true);
  await fireEvent.press(screen.getByTestId('start-env'));
  expect(screen.queryByTestId('start-indoor')).toBeNull();
  loc.getForegroundPermissionsAsync.mockResolvedValueOnce({ granted: false });
  loc.requestForegroundPermissionsAsync.mockResolvedValueOnce({ granted: false });
  await fireEvent.press(screen.getByTestId('start-go'));
  await waitFor(() => expect(screen.getByTestId('start-permission')).toBeTruthy());
  // PG-U-01：預設模式跑步；改健走（開始後固定於 session）
  // 模式樣態（Style 24.6）：跑步主指標配速；改健走 → 主指標時速、健走區間、自動圈預設 1 km、目標預設對齊（10/20/30 分、2/3/5 km）
  expect(screen.getByText('Main: pace /km')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('start-mode-brisk'));
  expect(screen.getByText('Main: km/h')).toBeTruthy();
  expect(screen.getByText(/brisk zone 5\.5–7\.5 km\/h/)).toBeTruthy();
  expect(screen.getByText(/Brisk walk is a mode you choose/)).toBeTruthy();
  // 目標面板：距離 3 km → 大數字 3.00 Kilometers；改時間 10 分 → 10:00 Minutes；Clear → Free
  await fireEvent.press(screen.getByTestId('start-goal-pill'));
  await fireEvent.press(screen.getByTestId('start-goal-distance'));
  await fireEvent.press(screen.getByTestId('start-goal-dist-3'));
  expect(screen.getByTestId('start-goal-value').props.children).toBe('3.00');
  expect(screen.getByTestId('start-goal-unit').props.children).toBe('Kilometers');
  await fireEvent.press(screen.getByTestId('start-goal-time'));
  await fireEvent.press(screen.getByTestId('start-goal-time-10'));
  expect(screen.getByTestId('start-goal-value').props.children).toBe('10:00');
  expect(screen.getByTestId('start-goal-unit').props.children).toBe('Minutes');
  expect(screen.getAllByText(/one reminder when the goal is reached/).length).toBeGreaterThan(0);
  await fireEvent.press(screen.getByTestId('start-goal-clear'));
  expect(screen.getByTestId('start-goal-value').props.children).toBe('Free');
  await fireEvent.press(screen.getByTestId('start-goal-time'));
  await fireEvent.press(screen.getByTestId('start-goal-done'));
  expect(screen.queryByTestId('start-goal-sheet')).toBeNull();
  expect(screen.getByTestId('start-goal-value').props.children).toBe('10:00');
  // 設定面板：400 m 自動圈、英里分段；PG-R-12 跑道模式需核對圈長才可開始；自訂值超範圍擋下
  await fireEvent.press(screen.getByTestId('start-settings'));
  await fireEvent.press(screen.getByTestId('start-autolap-400'));
  await fireEvent.press(screen.getByTestId('start-units-mi'));
  await fireEvent.press(screen.getByTestId('start-track-custom'));
  await fireEvent.changeText(screen.getByTestId('start-track-custom-input'), '5000');
  expect(screen.getByText('Lap length must be a whole number between 100 and 2,000 m.')).toBeTruthy();
  expect(screen.getByTestId('start-track-confirm').props.disabled).toBe(true);
  await fireEvent.press(screen.getByTestId('start-track-400'));
  expect(screen.getByText(/not physical line crossings/)).toBeTruthy();
  await fireEvent.press(screen.getByTestId('start-settings-done'));
  expect(screen.getByTestId('start-go').props.accessibilityState.disabled).toBe(true);
  expect(screen.getByTestId('start-disabled-reason').props.children).toBe('Set and confirm the track lap length first');
  await fireEvent.press(screen.getByTestId('start-settings'));
  await fireEvent(screen.getByTestId('start-track-confirm'), 'valueChange', true);
  await fireEvent.press(screen.getByTestId('start-settings-done'));
  expect(screen.getByTestId('start-go').props.accessibilityState.disabled).toBe(false);
  // 語音提示開關（圓鍵）
  await fireEvent.press(screen.getByTestId('start-cue-voice'));
  expect(useWorkoutPrefs.getState().voice).toBe(true);
  await fireEvent.press(screen.getByTestId('start-cue-voice'));
  // 3–2–1 倒數：按 START 先進倒數（顯示 3、尚未開始記錄）；點一下倒數畫面略過 → 立即開始
  await fireEvent.press(screen.getByTestId('start-go'));
  await waitFor(() => expect(screen.getByTestId('start-countdown-number').props.children).toBe(3));
  expect(recorder.snapshot().state).toBe('idle');
  await fireEvent.press(screen.getByTestId('start-go'));
  await fireEvent.press(screen.getByTestId('start-countdown'));
  await waitFor(() => expect(mockNav.navigate).toHaveBeenCalledWith('WorkoutRecord'));
  expect(screen.queryByTestId('start-countdown')).toBeNull();
  expect(recorder.snapshot()).toMatchObject({ state: 'recording', sport: 'walk', intent: 'brisk', goal: { kind: 'time', target: 600, unit: 's', version: 1 }, goalReached: false, trackEquivalent: { laps: 0, remainderMm: 0, lapMm: 400_000 } });
  expect(useWorkoutPrefs.getState().mode).toBe('brisk'); // 最近模式保存
  expect(loc.startLocationUpdatesAsync).toHaveBeenCalled();
  await act(async () => {});
});

test('記錄頁：距離 0 時按「計圈」有回應（說明還沒有距離）', async () => {
  await render(<WorkoutRecordScreen />, { wrapper: Wrapper });
  expect(recorder.snapshot().distanceMm).toBe(0);
  await fireEvent.press(screen.getByTestId('record-lap'));
  await waitFor(() => expect(screen.getByTestId('record-lap-note').props.children).toBe('No distance yet — a lap needs some movement first.'));
  expect(recorder.snapshot().laps).toHaveLength(0);
  await act(async () => {});
});

test('記錄頁：健走顯示速度、時間／距離；目標進度 → 達標提醒一次不自動停止；Lap；Pause 後顯示 Resume／Finish；Finish 需確認 → 摘要頁', async () => {
  jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, b) => b?.find((x) => x.style === 'destructive')?.onPress?.());
  await render(<WorkoutRecordScreen />, { wrapper: Wrapper });
  expect(screen.getByTestId('record-primary').props.children).toBe('—'); // 不足 5 秒窗
  expect(screen.getByTestId('record-goal').props.children).toBe('Goal 10 min');
  await act(async () => {
    recorder.ingest(pts(120, clock));
    clock += 120_000;
  });
  await waitFor(() => expect(screen.getByTestId('record-distance').props.children).toBe('0.36'));
  expect(screen.getByTestId('record-primary').props.children).toBe('10.8'); // 健走：km/h（3 m/s）
  expect(screen.getByTestId('record-mode').props.children).toBe('Brisk walk');
  expect(screen.getByText(/^Brisk walk · started /)).toBeTruthy(); // 分段卡標題列用模式名，不是 intent 代碼
  expect(screen.getByTestId('record-zone').props.children.props.children).toMatch(/^Above brisk zone/); // 10.8 km/h > 7.5
  // 10 分鐘目標：120 s 未達；時鐘推到 600 s 後達標提醒（含暫停時間），狀態仍 recording
  clock += 480_000;
  await act(async () => {});
  await waitFor(() => expect(screen.getByTestId('record-goal').props.children).toBe('Goal reached — nice! Keep going, or pause and finish.'), { timeout: 3000 });
  expect(recorder.snapshot().state).toBe('recording');
  expect(screen.getByTestId('record-track-laps').props.children).toBe('Lap 0 + 357 m'); // 跑道模式：依距離估算
  expect(screen.getByText('400 m per lap · estimated by distance')).toBeTruthy();
  await waitFor(() => expect(screen.getByText('GPS · searching')).toBeTruthy(), { timeout: 3000 }); // 時鐘已推進 120 s、最後一點在 120 s 前（每秒刷新）
  // PG-U-02：定位失效 → 不展示舊速度、顯示缺口提示；讀屏標籤含單位與狀態；操作鎖：鎖定後控制列只剩長按解鎖、不阻擋返回
  expect(screen.getByTestId('record-primary').props.children).toBe('—');
  expect(screen.getByTestId('record-gps-gap')).toBeTruthy();
  expect(screen.getByTestId('record-status').props.accessibilityLabel).toBe('GPS · searching, Recording');
  expect(screen.getByLabelText(/^Distance 0\.36 kilometers$/)).toBeTruthy();
  await fireEvent.press(screen.getByTestId('record-lock'));
  expect(screen.getByTestId('record-locked')).toBeTruthy();
  expect(screen.queryByTestId('record-pause')).toBeNull();
  await fireEvent(screen.getByTestId('record-locked'), 'longPress');
  expect(screen.getByTestId('record-pause')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('record-lap'));
  await waitFor(() => expect(screen.getByTestId('record-lap-note').props.children).toMatch(/^Lap 1 · 0\.36 km · /)); // 計圈有回應：第 N 圈＋距離＋速度
  // 即時軌跡（記憶體內最近點）與速度曲線存在
  expect(screen.getByTestId('record-trace')).toBeTruthy();
  expect(screen.getByTestId('speed-sparkline')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('record-pause'));
  await waitFor(() => expect(screen.getByTestId('record-resume')).toBeTruthy());
  expect(screen.getAllByText('Paused').length).toBeGreaterThan(0);
  // 暫停：運動時間停住（不含暫停）、顯示已暫停時間、主數字 —；健走平均時速依運動時間（0.36 km／600 s ≈ 2.1 km/h）；最近一段＝手動圈 1
  const movingAtPause = screen.getByTestId('record-time').props.children;
  clock += 5_000;
  await act(async () => {});
  await waitFor(() => expect(screen.getByTestId('record-paused').props.children).toBe('paused 0:05'));
  expect(screen.getByTestId('record-time').props.children).toBe(movingAtPause);
  expect(screen.getByTestId('record-primary').props.children).toBe('—');
  expect(screen.getByTestId('record-avg').props.children).toBe('2.1');
  expect(screen.getByText('avg km/h')).toBeTruthy();
  expect(screen.getAllByText('lap 1').length).toBe(2); // 最近一段格 ＋ 分段列表
  expect(screen.getByTestId('record-goal-bar').props.accessibilityValue.now).toBe(100);
  await fireEvent.press(screen.getByTestId('record-finish'));
  await waitFor(() => expect(mockNav.dispatch).toHaveBeenCalled());
  const summaryId = recorder.snapshot().state === 'idle' ? (sync.mock.calls[0]![0] as { external_record_id: string }[])[0]!.external_record_id : '';
  expect(summaryId).toBeTruthy();
  expect((sync.mock.calls[0]![0] as { intent: string; goal: { kind: string; target: number } }[])[0]).toMatchObject({ sport: 'walk', intent: 'brisk', goal: { kind: 'time', target: 600 } }); // PG-U-01 同步 payload
  mockRoute = { params: { sessionId: summaryId } };
  await act(async () => {});
});

test('摘要頁：距離／時間／平均配速／最高 5 秒／kcal —；分段含末段 Partial；圈數含手動圈與 400 m 自動圈；品質；已同步', async () => {
  await render(<WorkoutSummaryScreen />, { wrapper: Wrapper });
  expect(screen.getByTestId('sum-distance').props.children).toBe('0.36 km');
  // PG-U-01：模式標籤、目標結果、同步 payload 帶 intent／goal
  expect(screen.getAllByText(/^Brisk walk · /).length).toBeGreaterThan(0);
  expect(screen.getByTestId('sum-goal-met').props.children).toBe('Goal 10 min reached');
  // PG-U-03：同類不足 3 筆不比較；分享預覽預設不含日期／配速，勾選後加入
  await waitFor(() => expect(screen.getByTestId('sum-compare-none')).toBeTruthy());
  expect(screen.getByTestId('sum-share-preview').props.children).toMatch(/^Brisk walk · 0\.36 km · \d+:\d\d · #NeonShift$/);
  await fireEvent(screen.getByTestId('sum-share-date'), 'valueChange', true);
  expect(screen.getByTestId('sum-share-preview').props.children).toMatch(/· \d{4}-\d{2}-\d{2} · #NeonShift$/);
  expect(screen.getByText('—')).toBeTruthy(); // kcal 無裝置值
  expect(screen.getByTestId('sum-sync').props.children).toBe('Synced to your account');
  expect(screen.getByTestId('sum-split-1')).toBeTruthy();
  expect(screen.getByText('Partial')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('sum-tab-laps'));
  expect(screen.getByTestId('sum-manual-1')).toBeTruthy();
  expect(screen.getByTestId('sum-auto_distance-1')).toBeTruthy(); // 357 m < 400 m：只有末段 partial 自動圈
  expect(screen.getAllByText('Partial').length).toBeGreaterThan(0);
  expect(screen.getByText('Track equivalent: 0 laps × 400 m + 357 m')).toBeTruthy();
  expect(screen.getByText('Estimated from GPS distance, not physical line crossings')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('sum-tab-quality'));
  expect(screen.getByText('120 points accepted')).toBeTruthy();
  // GPS 品質說明：完整量測判定＋各項含意；軌跡卡預設開啟、可關閉並記住
  expect(screen.getByTestId('sum-quality-verdict').props.children).toMatch(/^Not fully measured/); // 時鐘跳 480 s 造成缺口
  expect(screen.getByText(/^Accepted: GPS fixes within 20 m/)).toBeTruthy();
  expect(screen.getByTestId('sum-route')).toBeTruthy();
  await waitFor(() => expect(screen.getByTestId('route-trace')).toBeTruthy());
  expect(useWorkoutPrefs.getState().showRoute).toBe(true);
  await fireEvent(screen.getByTestId('sum-route-toggle'), 'valueChange', false);
  expect(screen.queryByTestId('route-trace')).toBeNull();
  expect(useWorkoutPrefs.getState().showRoute).toBe(false);
  await fireEvent(screen.getByTestId('sum-route-toggle'), 'valueChange', true);
  // 底圖圖層：預設格線；切火星並記住；真實地圖顯示尚未啟用；完整性檢查無旗標
  await fireEvent(screen.getByTestId('route-trace'), 'layout', { nativeEvent: { layout: { width: 320, height: 220 } } });
  await waitFor(() => expect(screen.getByTestId('route-trace-layer-grid')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('sum-route-layer-mars'));
  await fireEvent(screen.getByTestId('route-trace'), 'layout', { nativeEvent: { layout: { width: 320, height: 220 } } });
  expect(useWorkoutPrefs.getState().traceLayer).toBe('mars');
  expect(screen.getByTestId('route-trace-layer-mars')).toBeTruthy();
  expect(screen.getByTestId('sum-route-layer-geo')).toBeTruthy();
  // 完整性：健走以 3 m/s（10.8 km/h）持續 2 分鐘 → sustained_speed（防弊）
  expect(screen.getByTestId('sum-integrity')).toBeTruthy();
  expect(screen.getByText(/^Sustained speed: 1 stretch/)).toBeTruthy();
  await fireEvent.press(screen.getByTestId('sum-done'));
  expect(mockNav.navigate).toHaveBeenCalledWith('Workouts');
});
