import { fireEvent, render, screen } from '@testing-library/react-native';
import { GameGuideScreen } from '@/screens/GameGuideScreen';
import { ThemeProvider } from '@/theme';
const mockNavigate = jest.fn();
const mockBack = jest.fn();
let mockOnboarding = true;
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockBack }),
  useRoute: () => ({ params: { onboarding: mockOnboarding } }),
}));
beforeEach(() => { mockNavigate.mockClear(); mockBack.mockClear(); mockOnboarding = true; });
test('explains all four systems and continues to wallet setup', async () => {
  await render(<ThemeProvider><GameGuideScreen /></ThemeProvider>);
  for (const chapter of ['daily', 'gear', 'collection', 'arena']) expect(screen.getByTestId(`guide-${chapter}`)).toBeTruthy();
  await fireEvent.press(screen.getByTestId('guide-done'));
  expect(mockNavigate).toHaveBeenCalledWith('Onboarding', { screen: 'WalletConnect' });
});
test('returning players go back instead of restarting setup', async () => {
  mockOnboarding = false;
  await render(<ThemeProvider><GameGuideScreen /></ThemeProvider>);
  await fireEvent.press(screen.getByTestId('guide-done'));
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(mockNavigate).not.toHaveBeenCalled();
});
