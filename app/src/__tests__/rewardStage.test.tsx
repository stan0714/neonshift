import { act, render } from '@testing-library/react-native';
import { Animated, AppState, Text, type AppStateStatus } from 'react-native';
import { RewardStage } from '@/components/RewardStage';
let mockReduced = false;
jest.mock('@/hooks/useReduceMotion', () => ({ useReduceMotion: () => mockReduced }));
afterEach(() => { jest.restoreAllMocks(); mockReduced = false; });

test('backgrounding settles the reveal; foregrounding never starts a second animation', async () => {
  let change: (state: AppStateStatus) => void = () => {};
  const remove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, listener) => { change = listener; return { remove }; });
  const stop = jest.fn();
  const timing = jest.spyOn(Animated, 'timing').mockReturnValue({ start: jest.fn(), stop, reset: jest.fn() });
  const set = jest.spyOn(Animated.Value.prototype, 'setValue');
  const view = await render(<RewardStage mode="task"><Text>Done</Text></RewardStage>);
  await act(() => { change('background'); change('active'); });
  expect(stop).toHaveBeenCalled();
  expect(set).toHaveBeenLastCalledWith(1);
  expect(timing).toHaveBeenCalledTimes(1);
  await view.unmount();
  expect(remove).toHaveBeenCalled();
});

test('reduce motion renders the result immediately without starting a timeline', async () => {
  mockReduced = true;
  const timing = jest.spyOn(Animated, 'timing');
  const set = jest.spyOn(Animated.Value.prototype, 'setValue');
  await render(<RewardStage mode="milestone"><Text>5 km</Text></RewardStage>);
  expect(timing).not.toHaveBeenCalled();
  expect(set).toHaveBeenLastCalledWith(1);
});
