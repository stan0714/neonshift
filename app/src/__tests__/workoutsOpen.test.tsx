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

import { WorkoutsScreen } from '@/screens/WorkoutsScreen';
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
