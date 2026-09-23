import { render, screen, fireEvent } from '@testing-library/react-native';
import { MissionJourney } from '@/components/MissionJourney';
import { ThemeProvider } from '@/theme';
import { useLocaleStore } from '@/i18n';
beforeEach(() => useLocaleStore.setState({ setting: 'en', locale: 'en' }));
test('uses loaded thresholds, counts claimed tasks and reveals milestone navigation', async () => {
  const onChallenges = jest.fn();
  const onStartWorkout = jest.fn();
  const onSteps = jest.fn();
  await render(<ThemeProvider><MissionJourney profile={{ xp: 300n } as never} config={{ shoeXpThresholds: [0n, 600n, 1800n, 4000n, 8000n] } as never} statuses={['claimed', 'ready']} onGear={jest.fn()} onChallenges={onChallenges} onStartWorkout={onStartWorkout} onSteps={onSteps} /></ThemeProvider>);
  expect(screen.getByText('Today · 1/2 claimed')).toBeTruthy();
  expect(screen.getByText(/Asian Elephant · 300 XP to go/)).toBeTruthy();
  expect(screen.getByText(/Equivalent to 3 successful/)).toBeTruthy();
  await fireEvent.press(screen.getByText('Explore rewards and milestones'));
  await fireEvent.press(screen.getByText('Explore milestone eligibility'));
  expect(onChallenges).toHaveBeenCalledTimes(1);
  // 兩個每日任務各自要有入口：規則文字說得再清楚，讀完仍需要知道去哪裡做
  await fireEvent.press(screen.getByTestId('journey-go-workout'));
  await fireEvent.press(screen.getByTestId('journey-go-steps'));
  expect([onStartWorkout.mock.calls.length, onSteps.mock.calls.length]).toEqual([1, 1]);
});
test('missing rules do not fabricate an upgrade target', async () => {
  await render(<ThemeProvider><MissionJourney profile={null} config={null} statuses={['not_met', 'not_met']} onGear={jest.fn()} onChallenges={jest.fn()} onStartWorkout={jest.fn()} onSteps={jest.fn()} /></ThemeProvider>);
  expect(screen.getByText(/load the game rules/)).toBeTruthy();
  expect(screen.queryByText(/XP to go/)).toBeNull();
});
