import { NavigationContainer } from '@react-navigation/native';
import { render, screen } from '@testing-library/react-native';
import { WorkoutRecordScreen } from '@/screens/workouts/WorkoutRecordScreen';
import { useRecorder } from '@/screens/workouts/useRecorder';
import { workoutRecorder, type RecorderSnapshot } from '@/services/workouts/WorkoutRecorder';
import { ThemeProvider } from '@/theme';

jest.mock('@/screens/workouts/useRecorder', () => ({ useRecorder: jest.fn() }));
jest.mock('@/services/workouts/WorkoutCues', () => ({ workoutCues: { reset: jest.fn(), onSnapshot: jest.fn() } }));
const mockSnapshot = useRecorder as jest.MockedFunction<typeof useRecorder>;
const show = async (overrides: Partial<RecorderSnapshot> = {}) => {
  mockSnapshot.mockReturnValue({ ...workoutRecorder.snapshot(), state: 'recording', sport: 'run', intent: 'run', gps: 'ok', distanceMm: 3_510_000, movingMs: 1_491_750, elapsedMs: 1_491_750, currentPaceSPerKm: 351, goal: { kind: 'distance', target: 3_000_000, unit: 'mm', version: 1 }, goalReached: true, ...overrides });
  return render(<ThemeProvider><NavigationContainer><WorkoutRecordScreen /></NavigationContainer></ThemeProvider>);
};

test('faster pace gets energy treatment and exceeded distance shows uncapped completion with capped bar', async () => {
  await show();
  expect(screen.getByTestId('record-energy', { includeHiddenElements: true })).toBeTruthy();
  expect(screen.getByTestId('record-goal-achievement')).toBeTruthy();
  expect(screen.getByText('117%')).toBeTruthy();
  expect(screen.getByText('+0.51 km')).toBeTruthy();
  expect(screen.getByTestId('record-goal-bar').props.accessibilityValue.now).toBe(100);
});

test.each([
  { gps: 'poor' }, { gps: 'searching' }, { state: 'paused' },
  { currentPaceSPerKm: null }, { currentPaceSPerKm: 425 }, { currentPaceSPerKm: 450 },
] as Partial<RecorderSnapshot>[])('no energy treatment with unreliable, paused or non-faster pace: %o', async (overrides) => {
  await show(overrides);
  expect(screen.queryByTestId('record-energy', { includeHiddenElements: true })).toBeNull();
});

test('unfinished and free goals do not show achievement', async () => {
  const view = await show({ goalReached: false, distanceMm: 1_500_000 });
  expect(screen.queryByTestId('record-goal-achievement')).toBeNull();
  expect(screen.getByTestId('record-goal-bar').props.accessibilityValue.now).toBe(50);
  await view.unmount();
  await show({ goalReached: false, goal: null });
  expect(screen.queryByTestId('record-goal-bar')).toBeNull();
});

test('time goal uses elapsed time consistently and formats extra duration', async () => {
  await show({ goal: { kind: 'time', target: 600, unit: 's', version: 1 }, elapsedMs: 660_000 });
  expect(screen.getByText('110%')).toBeTruthy();
  expect(screen.getByText('+1:00')).toBeTruthy();
});
