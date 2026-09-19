import { fireEvent, render, screen } from '@testing-library/react-native';
import { ShoeStory } from '@/components/ShoeStory';
import { ThemeProvider } from '@/theme';
import { useLocaleStore } from '@/i18n';

beforeEach(() => useLocaleStore.setState({ setting: 'en', locale: 'en' }));

test('preview inspection changes both detail and story without assigning a personal finish', async () => {
  await render(<ThemeProvider><ShoeStory level={3} preview /></ThemeProvider>);
  expect(screen.getByTestId('shoe-inspect-heel')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('shoe-detail-upper'));
  expect(screen.getByTestId('shoe-inspect-upper')).toBeTruthy();
  expect(screen.getByText('Beautiful on a living turtle')).toBeTruthy();
  expect(screen.getByTestId('shoe-detail-upper').props.accessibilityState.selected).toBe(true);
  expect(screen.queryByText(/Your finish/)).toBeNull();
  await fireEvent.press(screen.getByTestId('shoe-detail-sole'));
  expect(screen.getByText('A current beneath your feet')).toBeTruthy();
});

test('locked shoe exposes educational details but retains the growth-box state', async () => {
  await render(<ThemeProvider><ShoeStory level={2} locked /></ThemeProvider>);
  await fireEvent.press(screen.getByTestId('shoe-detail-upper'));
  expect(screen.getByText('A path through the forest')).toBeTruthy();
  expect(screen.getByText('Growth box · reveals at this level')).toBeTruthy();
  expect(screen.queryByText(/Your finish/)).toBeNull();
});
