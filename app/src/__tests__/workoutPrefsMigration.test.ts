import * as SecureStore from 'expo-secure-store';

import { useWorkoutPrefs } from '@/state/workoutPrefsStore';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn() }));
const store = SecureStore as jest.Mocked<typeof SecureStore>;
const KEY = 'neonshift.workout.prefs.v1';

beforeEach(() => {
  jest.clearAllMocks();
  useWorkoutPrefs.setState({ loaded: false, activityOrder: 'desc', prefsSchema: undefined } as never);
});

test('預設：Activity 由新到舊', async () => {
  store.getItemAsync.mockResolvedValueOnce(null);
  expect((await useWorkoutPrefs.getState().load()).activityOrder).toBe('desc');
});

test('遷移：舊版存下的 asc（當初的預設值，非使用者所選）一次性翻成 desc 並寫回', async () => {
  store.getItemAsync.mockResolvedValueOnce(JSON.stringify({ mode: 'walk', activityOrder: 'asc' }));
  const prefs = await useWorkoutPrefs.getState().load();
  expect(prefs.activityOrder).toBe('desc');
  expect(prefs.mode).toBe('walk'); // 其他偏好不受影響
  expect(JSON.parse((store.setItemAsync.mock.calls[0]![1]) as string)).toMatchObject({ activityOrder: 'desc', prefsSchema: 2, mode: 'walk' });
});

test('遷移只跑一次：已是新版結構時尊重使用者自己選的 asc', async () => {
  store.getItemAsync.mockResolvedValueOnce(JSON.stringify({ activityOrder: 'asc', prefsSchema: 2 }));
  expect((await useWorkoutPrefs.getState().load()).activityOrder).toBe('asc');
  expect(store.setItemAsync).not.toHaveBeenCalled();
});
