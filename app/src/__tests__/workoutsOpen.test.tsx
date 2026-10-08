/**
 * 2026-10-02 實機（拍黑客松素材時）：Home → Workouts → 點 9/30 那筆跑步，毫無反應。
 * 已同步的紀錄在這頁只以「伺服器卡片」出現，而那張卡整張沒有 onPress（只有 Delete 能按）；
 * 同一筆在 Activity 分頁卻點得開。開啟規則要與 Activity 分頁一致：
 * 有這支手機錄的原始紀錄 → WorkoutSummary（路線、分段）；只在伺服器（匯入）→ ActivityDetail。
 */
import { NavigationContainer } from '@react-navigation/native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useNavigation: () => ({ navigate: mockNavigate }) }));
jest.mock('@/services/api/ApiClient', () => ({
  ...jest.requireActual('@/services/api/ApiClient'),
  apiClient: {
    myWorkouts: jest.fn(),
    personalBests: jest.fn(async () => ({ rules_major: 1, imported_since: null, groups: [] })),
    myAchievements: jest.fn(async () => ({ items: [] })),
    milestones: jest.fn(async () => ({ items: [] })),
  },
}));

import { estimateItemEnergy, itemFromLocal } from '@/domain/activity';
import { WorkoutsScreen } from '@/screens/WorkoutsScreen';
import { useBody } from '@/state/bodyStore';
import { workoutRecorder } from '@/services/workouts/WorkoutRecorder';
import { ThemeProvider } from '@/theme';

const api = jest.requireMock('@/services/api/ApiClient').apiClient as Record<'myWorkouts', jest.Mock>;
const Wrapper = ({ children }: PropsWithChildren) => (
  <ThemeProvider>
    <NavigationContainer>{children}</NavigationContainer>
  </ThemeProvider>
);
const w = (id: string, origin: string) => ({ session_id: id, sport: 'run', environment: 'outdoor', source: { origin, source_id: 'cc.neonshift.app', external_record_id: null, source_revision: 1 }, started_at: '2026-09-30T12:59:00Z', ended_at: '2026-09-30T13:25:00Z', elapsed_ms: '1538000', paused_ms: '0', status: 'saved', quality: 'complete', rules_version: 1, review_reasons: [], possible_duplicate_of: null, metrics: { distance: { value_mm: '3890000', method: 'device' }, steps: null, active_energy: null, total_energy: null, avg_pace_s_per_km: 395, avg_speed_kmh: 9.1, step_length_mm: null }, pb_eligible: true, extras: {}, revision: 1, imported_at: '', updated_at: '' });

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(workoutRecorder, 'unsynced').mockReturnValue([]);
  jest.spyOn(workoutRecorder, 'markRecoverable').mockResolvedValue([]);
});

test('已同步、這支手機錄的紀錄 → 點卡片開 WorkoutSummary（本機 sessionId）', async () => {
  api.myWorkouts.mockResolvedValue({ items: [w('srv-930', 'device_gps')], rules_version: 1 });
  jest.spyOn(workoutRecorder, 'localStore').mockReturnValue({ list: () => [{ sessionId: 'local-930', syncedSessionId: 'srv-930' }] } as never);
  await render(<WorkoutsScreen />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByTestId('workout-open-srv-930')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('workout-open-srv-930'));
  expect(mockNavigate).toHaveBeenCalledWith('WorkoutSummary', { sessionId: 'local-930' });
});

test('只在伺服器的紀錄（例如 Health Connect 匯入）→ 開 ActivityDetail', async () => {
  api.myWorkouts.mockResolvedValue({ items: [w('srv-hc', 'health_connect')], rules_version: 1 });
  jest.spyOn(workoutRecorder, 'localStore').mockReturnValue({ list: () => [] } as never);
  await render(<WorkoutsScreen />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByTestId('workout-open-srv-hc')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('workout-open-srv-hc'));
  expect(mockNavigate).toHaveBeenCalledWith('ActivityDetail', { serverId: 'srv-hc' });
});

/**
 * 同一天拍素材時的第二個發現：列表上 9/30 的 kcal 是「—」，點進詳情卻是 ≈226。
 * 列表只讀伺服器的能量欄位（GPS 紀錄沒有），詳情頁才用體重估算。兩處改用同一支 estimateItemEnergy。
 */
describe('列表與詳情的 kcal 必須是同一個數字', () => {
  const meta = {
    sessionId: 'local-930', syncedSessionId: 'srv-930', sport: 'run', intent: 'run', status: 'saved', startedAtUtc: Date.UTC(2026, 8, 30, 12, 59), endedAtUtc: Date.UTC(2026, 8, 30, 13, 25),
    summary: { distanceMm: 3_890_000, elapsedMs: 1_538_000, movingMs: 1_536_000, avgPaceSPerKm: 395, avgSpeedKmh: 9.1, laps: [],
      splits: [{ distanceMm: 1_000_000, durationMs: 429_000, paceSPerKm: 429, isPartial: false }, { distanceMm: 1_000_000, durationMs: 390_000, paceSPerKm: 390, isPartial: false }, { distanceMm: 1_000_000, durationMs: 387_000, paceSPerKm: 387, isPartial: false }, { distanceMm: 890_000, durationMs: 330_000, paceSPerKm: 371, isPartial: true }] },
  };
  afterEach(() => useBody.setState({ weightKg: null, loaded: false }));

  test('有體重 → 列表顯示與詳情頁相同的估算值（≈N kcal），不是「—」', async () => {
    useBody.setState({ weightKg: 82, loaded: true });
    api.myWorkouts.mockResolvedValue({ items: [w('srv-930', 'gps')], rules_version: 1 });
    jest.spyOn(workoutRecorder, 'localStore').mockReturnValue({ list: () => [meta] } as never);
    const expected = estimateItemEnergy(itemFromLocal(meta as never, null)!, 82)!.activeKcal;
    await render(<WorkoutsScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText(`≈${expected} kcal`)).toBeTruthy());
  });

  test('沒設體重 → 仍是「—」（不憑空估）', async () => {
    useBody.setState({ weightKg: null, loaded: true });
    api.myWorkouts.mockResolvedValue({ items: [w('srv-930', 'gps')], rules_version: 1 });
    jest.spyOn(workoutRecorder, 'localStore').mockReturnValue({ list: () => [meta] } as never);
    await render(<WorkoutsScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('workout-srv-930')).toBeTruthy());
    expect(screen.queryByText(/≈\d+ kcal/)).toBeNull();
  });
});

/**
 * 2026-10-02 實機（RC v15 驗收）：「Walk / brisk」在 brisk 前換行，第二行被圓角邊框裁掉，畫面只剩「Walk /」。
 * 版面無法在 jest 量測；這裡釘住修法本身——篩選標籤單行、Android 用 simple 斷行。
 */
test('篩選標籤固定單行，不會在按鈕裡換行被裁掉', async () => {
  api.myWorkouts.mockResolvedValue({ items: [w('srv-hc', 'health_connect')], rules_version: 1 });
  jest.spyOn(workoutRecorder, 'localStore').mockReturnValue({ list: () => [] } as never);
  await render(<WorkoutsScreen />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByTestId('workouts-filter-label-walking')).toBeTruthy());
  for (const f of ['all', 'walking', 'running']) {
    expect(screen.getByTestId(`workouts-filter-label-${f}`).props).toMatchObject({ numberOfLines: 1, textBreakStrategy: 'simple' });
  }
});
