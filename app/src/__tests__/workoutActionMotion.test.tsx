import { act, render, screen } from '@testing-library/react-native';
import { Animated } from 'react-native';
import { WorkoutActionArt, WorkoutActionFeedback, WORKOUT_FEEDBACK_MS } from '@/components/WorkoutActionMotion';
import { ThemeProvider } from '@/theme';
let mockReduced = false;
jest.mock('@/hooks/useReduceMotion', () => ({ useReduceMotion: () => mockReduced }));
beforeEach(() => { mockReduced = false; jest.useFakeTimers(); });
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });
for (const mode of ['walk', 'brisk', 'run'] as const) {
  for (const action of ['start', 'pause', 'resume', 'finish'] as const) {
    test(`${mode} ${action}: plays once and stops when removed`, async () => {
      const start = jest.fn(); const stop = jest.fn();
      const timing = jest.spyOn(Animated, 'timing').mockReturnValue({ start, stop, reset: jest.fn() });
      const view = await render(<ThemeProvider><WorkoutActionArt mode={mode} action={action} /></ThemeProvider>);
      expect(screen.getByTestId(`workout-art-${mode}-${action}`)).toBeTruthy();
      expect(timing).toHaveBeenCalledTimes(1);
      expect(start).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId(action === 'finish' ? `workout-emblem-${mode}` : `workout-figure-${mode}`)).toBeTruthy();
      await view.unmount();
      expect(stop).toHaveBeenCalledTimes(1);
    });
  }
}
test('reduced motion has static artwork and no running animation', async () => {
  mockReduced = true;
  const timing = jest.spyOn(Animated, 'timing');
  await render(<ThemeProvider><WorkoutActionArt mode="brisk" action="pause" /></ThemeProvider>);
  expect(timing).not.toHaveBeenCalled();
  expect(screen.getByTestId('workout-art-brisk-pause')).toBeTruthy();
});
test('feedback leaves controls touchable and dismisses without navigating or waiting for animation', async () => {
  await render(<ThemeProvider><WorkoutActionFeedback mode="run" action="finish" /></ThemeProvider>);
  expect(screen.getByTestId('workout-feedback-finish').props.pointerEvents).toBe('none');
  expect(screen.getByText('Saved on this device')).toBeTruthy();
  await act(async () => { jest.advanceTimersByTime(WORKOUT_FEEDBACK_MS); });
  expect(screen.queryByTestId('workout-feedback-finish')).toBeNull();
});

test('switching to reduced motion stops the current effect', async () => {
  const stop = jest.fn();
  const timing = jest.spyOn(Animated, 'timing').mockReturnValue({ start: jest.fn(), stop, reset: jest.fn() });
  const view = await render(<ThemeProvider><WorkoutActionArt mode="run" action="finish" /></ThemeProvider>);
  mockReduced = true;
  await view.rerender(<ThemeProvider><WorkoutActionArt mode="run" action="finish" /></ThemeProvider>);
  expect(stop).toHaveBeenCalledTimes(1);
  expect(timing).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('workout-emblem-run')).toBeTruthy();
});
test('resume has its own message and mode label', async () => {
  await render(<ThemeProvider><WorkoutActionFeedback mode="brisk" action="resume" /></ThemeProvider>);
  expect(screen.getByText('Back in rhythm')).toBeTruthy();
  expect(screen.getByText('Brisk walk')).toBeTruthy();
});
