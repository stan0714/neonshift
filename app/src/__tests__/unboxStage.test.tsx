import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState, type AppStateStatus, Text as NativeText } from 'react-native';
import * as Haptics from 'expo-haptics';
import { UnboxStage, UNBOX_TIMELINE } from '@/components/UnboxStage';
import { ThemeProvider } from '@/theme';

let mockReduced = false;
jest.mock('@/hooks/useReduceMotion', () => ({ useReduceMotion: () => mockReduced }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(async () => {}), ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' } }));
const stage = (onRevealed: () => void) => <ThemeProvider><UnboxStage accent="#30EBC8" height={380} onRevealed={onRevealed}><NativeText>Shoe</NativeText></UnboxStage></ThemeProvider>;
beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); mockReduced = false; });
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

test('normal ceremony reveals once and finishes with no box or skip button', async () => {
  const done = jest.fn();
  await render(stage(done));
  expect(screen.getByTestId('unbox-lid')).toBeTruthy();
  await act(async () => { jest.advanceTimersByTime(UNBOX_TIMELINE.revealed - 1); });
  expect(done).not.toHaveBeenCalled();
  await act(async () => { jest.advanceTimersByTime(1); });
  expect(done).toHaveBeenCalledTimes(1);
  await act(async () => { jest.advanceTimersByTime(UNBOX_TIMELINE.total); });
  expect(done).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('reward-stage-box')).toBeNull();
  expect(screen.queryByTestId('unbox-skip')).toBeNull();
  expect(Haptics.impactAsync).toHaveBeenCalledTimes(3);
});
test('skip reveals immediately and cancels later haptics and callbacks', async () => {
  const done = jest.fn();
  await render(stage(done));
  await fireEvent.press(screen.getByTestId('unbox-skip'));
  expect(done).toHaveBeenCalledTimes(1);
  await act(async () => { jest.advanceTimersByTime(UNBOX_TIMELINE.total); });
  expect(done).toHaveBeenCalledTimes(1);
  expect(Haptics.impactAsync).not.toHaveBeenCalled();
  expect(screen.queryByTestId('reward-stage-box')).toBeNull();
});
test('reduced motion shows final state without a box or delayed impacts', async () => {
  mockReduced = true;
  const done = jest.fn();
  await render(stage(done));
  expect(done).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('reward-stage-box')).toBeNull();
  await act(async () => { jest.advanceTimersByTime(UNBOX_TIMELINE.total); });
  expect(Haptics.impactAsync).not.toHaveBeenCalled();
});
test('backgrounding settles and does not replay on foreground', async () => {
  let change: (state: AppStateStatus) => void = () => {};
  const remove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => { change = listener; return { remove }; });
  const done = jest.fn();
  const view = await render(stage(done));
  await act(async () => { change('background'); change('active'); jest.advanceTimersByTime(UNBOX_TIMELINE.total); });
  expect(done).toHaveBeenCalledTimes(1);
  expect(Haptics.impactAsync).not.toHaveBeenCalled();
  await view.unmount();
  expect(remove).toHaveBeenCalled();
});
test('unmount cancels queued callbacks', async () => {
  const done = jest.fn();
  const view = await render(stage(done));
  await view.unmount();
  await act(async () => { jest.advanceTimersByTime(UNBOX_TIMELINE.total); });
  expect(done).not.toHaveBeenCalled();
  expect(Haptics.impactAsync).not.toHaveBeenCalled();
});
