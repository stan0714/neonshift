/** PG-R-01：Health Connect session → 匯入 payload 映射（運動範圍、單位、Active／Total 分開、不套通用步長）、匯入器分批／不可用、運動紀錄畫面。 */
import { NavigationContainer } from '@react-navigation/native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';
import { Alert } from 'react-native';

import { formatDuration, formatKm, formatPace, sportOf, toImportInput } from '@/domain/workouts';
import { WorkoutsScreen } from '@/screens/WorkoutsScreen';
import { importFromHealthConnect } from '@/services/workouts/importer';
import { ThemeProvider } from '@/theme';

jest.mock('@/services/api/ApiClient', () => ({ ...jest.requireActual('@/services/api/ApiClient'), apiClient: { myWorkouts: jest.fn(), importWorkouts: jest.fn(), deleteWorkout: jest.fn(), personalBests: jest.fn(async () => ({ rules_major: 1, imported_since: '2026-09-01T00:00:00Z', groups: [{ key: 'k', category: 'fastest_5k', environment: 'outdoor', verification_class: 'device', timing_basis: 'elapsed', current: { pb_id: 'p2', category: 'fastest_5k', environment: 'outdoor', verification_class: 'device', timing_basis: 'elapsed', rules_major: 1, value: '1500000', unit: 'ms', source: { kind: 'workout', id: 's1', revision: 1 }, achieved_at: '2026-09-05T00:00:00Z', status: 'current', is_baseline: false, previous_pb_id: 'p1', invalidated_at: null, reason: null }, history: [{ pb_id: 'p1', category: 'fastest_5k', environment: 'outdoor', verification_class: 'device', timing_basis: 'elapsed', rules_major: 1, value: '1600000', unit: 'ms', source: { kind: 'workout', id: 's0', revision: 1 }, achieved_at: '2026-09-01T00:00:00Z', status: 'historical', is_baseline: true, previous_pb_id: null, invalidated_at: null, reason: null }] }, { key: 'k2', category: 'longest_run', environment: 'outdoor', verification_class: 'organizer', timing_basis: 'elapsed', current: null, history: [{ pb_id: 'p3', category: 'longest_run', environment: 'outdoor', verification_class: 'organizer', timing_basis: 'elapsed', rules_major: 1, value: '5000000', unit: 'mm', source: { kind: 'result', id: 'r1', revision: 1 }, achieved_at: '2026-10-03T00:00:00Z', status: 'invalidated', is_baseline: true, previous_pb_id: null, invalidated_at: '2026-10-04T00:00:00Z', reason: 'source_removed_or_corrected' }] }] })) } }));
const api = jest.requireMock('@/services/api/ApiClient').apiClient as Record<'myWorkouts' | 'importWorkouts' | 'deleteWorkout', jest.Mock>;

const Wrapper = ({ children }: PropsWithChildren) => (
  <ThemeProvider>
    <NavigationContainer>{children}</NavigationContainer>
  </ThemeProvider>
);
const hc = { recordId: 'hc-1', dataOrigin: 'com.example.watch', exerciseType: 56, startUnixMs: Date.UTC(2026, 8, 14, 0, 0), endUnixMs: Date.UTC(2026, 8, 14, 0, 25), version: 3, distanceMeters: 5000.4, steps: 6000, activeKcal: 320.4, totalKcal: 350 };

beforeEach(() => jest.clearAllMocks());

describe('domain/workouts', () => {
  test('sportOf：只接受跑步／健走（含跑步機＝室內）', () => {
    expect(sportOf(56)).toEqual({ sport: 'run', environment: 'unknown' });
    expect(sportOf(57)).toEqual({ sport: 'run', environment: 'indoor' });
    expect(sportOf(79)).toEqual({ sport: 'walk', environment: 'unknown' });
    expect(sportOf(8)).toBeNull();
  });
  test('toImportInput：公尺→毫米字串、kcal→毫 kcal、Active／Total 分開、device 距離、revision、record id 缺時組合鍵', () => {
    const p = toImportInput(hc)!;
    expect(p).toMatchObject({ sport: 'run', origin: 'health_connect', source_id: 'com.example.watch', external_record_id: 'hc-1', source_revision: 3, distance_mm: '5000400', distance_method: 'device', steps: 6000, active_energy_mkcal: '320400', energy_method: 'device', total_energy_mkcal: '350000', step_length_mm: null, client_flags: [] });
    expect(p.started_at).toBe('2026-09-14T00:00:00.000Z');
    expect(toImportInput({ ...hc, recordId: null }, {})!.external_record_id).toBe(`com.example.watch:${hc.startUnixMs}`);
    expect(toImportInput({ ...hc, exerciseType: 8 })).toBeNull();
    expect(toImportInput({ ...hc, endUnixMs: hc.startUnixMs })).toBeNull();
  });
  test('沒有裝置距離：只有校準步長時才附 step_length_mm（估算由後端標記）；沒校準不套通用值；部分權限旗標', () => {
    const noDist = { ...hc, distanceMeters: null, activeKcal: null, partialPermissions: true };
    expect(toImportInput(noDist)!).toMatchObject({ distance_mm: null, distance_method: null, step_length_mm: null, energy_method: null, client_flags: ['partial_permissions'] });
    expect(toImportInput(noDist, { stepLengthMm: 780 })!.step_length_mm).toBe(780);
    expect(toImportInput(hc, { stepLengthMm: 780 })!.step_length_mm).toBeNull(); // 有量測距離就不估算
  });
  test('格式化', () => {
    expect(formatPace(300)).toBe('5:00 /km');
    expect(formatPace(null)).toBe('—');
    expect(formatKm('5000400')).toBe('5.00 km');
    expect(formatDuration('1500000')).toBe('25:00');
  });
});

describe('importer', () => {
  test('原生模組沒有 readExerciseSessions → unavailable，不呼叫 API', async () => {
    expect(await importFromHealthConnect({ reader: {} })).toEqual({ kind: 'unavailable' });
    expect(api.importWorkouts).not.toHaveBeenCalled();
  });
  test('讀 30 天、過濾不支援運動、分批 ≤ 50、統計 imported／superseded／skipped', async () => {
    const sessions = Array.from({ length: 60 }, (_, i) => ({ ...hc, recordId: `r${i}`, exerciseType: i === 59 ? 8 : 56 }));
    api.importWorkouts.mockImplementation(async (batch: unknown[]) => ({ imported: batch.length - 1, results: [{ external_record_id: 'x', outcome: 'superseded', session: {} }, ...batch.slice(1).map(() => ({ external_record_id: 'y', outcome: 'created', session: {} }))] }));
    const r = await importFromHealthConnect({ reader: { readExerciseSessions: async () => ({ sessions }) } });
    expect(api.importWorkouts).toHaveBeenCalledTimes(2);
    expect(api.importWorkouts.mock.calls[0]![0]).toHaveLength(50);
    expect(api.importWorkouts.mock.calls[1]![0]).toHaveLength(9);
    expect(r).toEqual({ kind: 'ok', imported: 57, superseded: 2, skipped: 1 });
  });
});

describe('WorkoutsScreen', () => {
  const w = (o: Record<string, unknown>) => ({ session_id: 's1', sport: 'run', environment: 'unknown', source: { origin: 'health_connect', source_id: 'com.example.watch', external_record_id: 'hc-1', source_revision: 1 }, started_at: '2026-09-14T00:00:00Z', ended_at: '2026-09-14T00:25:00Z', elapsed_ms: '1500000', paused_ms: '0', status: 'saved', quality: 'complete', rules_version: 1, review_reasons: [], possible_duplicate_of: null, metrics: { distance: { value_mm: '5000000', method: 'device' }, steps: 6000, active_energy: { value_mkcal: '320000', method: 'device' }, total_energy: null, avg_pace_s_per_km: 300, avg_speed_kmh: 12, step_length_mm: null }, pb_eligible: true, extras: {}, revision: 1, imported_at: '', updated_at: '', ...o });
  test('清單：量測／估算／待審核與重複標記、Active 缺時顯示 Total、空狀態；匯入不可用提示；刪除需確認', async () => {
    api.myWorkouts.mockResolvedValue({ items: [w({}), w({ session_id: 's2', quality: 'estimated', pb_eligible: false, metrics: { distance: { value_mm: '4680000', method: 'estimated' }, steps: 6000, active_energy: null, total_energy: { value_mkcal: '350000' }, avg_pace_s_per_km: 320, avg_speed_kmh: 11.2, step_length_mm: 780 }, possible_duplicate_of: 's1' }), w({ session_id: 's3', sport: 'walk', quality: 'needs_review', status: 'needs_review', review_reasons: ['steps_rate_exceeds_cap'], pb_eligible: false })], rules_version: 1 });
    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, b) => b?.find((x) => x.style === 'destructive')?.onPress?.());
    api.deleteWorkout.mockResolvedValue({});
    await render(<WorkoutsScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('workout-s1')).toBeTruthy());
    // PB 區：裝置 5K 已刷新 1 次；官方最遠被撤銷
    await waitFor(() => expect(screen.getByTestId('pb-fastest_5k-device')).toBeTruthy());
    expect(screen.getAllByText('25:00').length).toBeGreaterThan(1); // PB 值與 s1 時間
    expect(screen.getByText('Improved 1×')).toBeTruthy();
    expect(screen.getByText('From records imported since 2026-09-01')).toBeTruthy();
    expect(screen.getByText('A record was corrected or deleted — this best was revised.')).toBeTruthy();
    expect(screen.getAllByText('5.00 km')).toHaveLength(2); // s1 與 s3 都是 5 km
    // PG-U-03：週回顧與模式篩選
    expect(screen.getByTestId('workouts-week-review')).toBeTruthy();
    expect(screen.getByText(/Weeks start Monday, local time/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('workouts-filter-walking'));
    expect(screen.queryByTestId('workout-s1')).toBeNull(); // s1 是跑步
    await fireEvent.press(screen.getByTestId('workouts-filter-all'));
    expect(screen.getByTestId('workout-s1')).toBeTruthy();
    expect(screen.getAllByText('5:00 /km').length).toBeGreaterThan(0);
    expect(screen.getAllByText('320 kcal').length).toBeGreaterThan(0);
    expect(screen.getByText('350 kcal (total)')).toBeTruthy();
    expect(screen.getAllByText('PB eligible')).toHaveLength(1);
    expect(screen.getByText('Estimated')).toBeTruthy();
    expect(screen.getByTestId('workout-dup-s2')).toBeTruthy();
    expect(screen.getByText('Needs review')).toBeTruthy();
    expect(screen.getByText('Step rate above 250/min')).toBeTruthy();
    // 匯入：原生模組回空 → 「沒有新的紀錄」（需先取得運動權限）
    const native = jest.requireMock('../../modules/neonshift-health/src/NeonshiftHealthModule').default as Record<string, jest.Mock>;
    native.getGrantedPermissions.mockResolvedValue([]);
    native.requestPermissions.mockResolvedValue(['android.permission.health.READ_EXERCISE']);
    await fireEvent.press(screen.getByTestId('workouts-import'));
    await waitFor(() => expect(screen.getByTestId('workouts-info')).toBeTruthy());
    expect(screen.getByText('Nothing new to import.')).toBeTruthy();
    expect(native.requestPermissions).toHaveBeenCalledWith(expect.arrayContaining(['android.permission.health.READ_EXERCISE', 'android.permission.health.READ_DISTANCE']));
    // 拒絕運動權限 → 警示，不阻擋其他功能
    native.getGrantedPermissions.mockResolvedValue([]);
    native.requestPermissions.mockResolvedValue([]);
    await fireEvent.press(screen.getByTestId('workouts-import'));
    await waitFor(() => expect(screen.getByTestId('workouts-warning')).toBeTruthy());
    // 刪除 → 確認 → API → 重新載入
    api.myWorkouts.mockResolvedValue({ items: [], rules_version: 1 });
    await fireEvent.press(screen.getByTestId('workout-delete-s1'));
    await waitFor(() => expect(api.deleteWorkout).toHaveBeenCalledWith('s1'));
    await waitFor(() => expect(screen.getByTestId('workouts-empty')).toBeTruthy());
    await act(async () => {});
  });
});
