import { NavigationContainer } from '@react-navigation/native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';

import { LandingScreen } from '@/screens/launch/LandingScreen';
import { ThemeProvider } from '@/theme';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn(), reset: jest.fn() }),
}));

const Wrapper = ({ children }: PropsWithChildren) => (
  <ThemeProvider>
    <NavigationContainer>{children}</NavigationContainer>
  </ThemeProvider>
);

describe('Landing（Style 9）', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockNavigate.mockClear();
  });
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });
  test('顯示首選文案、DEVNET badge、三個 proof points 與 disclaimer', async () => {
    await render(<LandingScreen />, { wrapper: Wrapper });
    expect(screen.getByText('YOUR DAILY SHIFT')).toBeTruthy();
    expect(screen.getByText('CLOCK IN.\nMOVE BEYOND LIMITS.')).toBeTruthy();
    expect(screen.getByText('DEVNET')).toBeTruthy();
    expect(screen.getByText('Health-powered missions')).toBeTruthy();
    expect(screen.getByText('Onchain gear progress')).toBeTruthy();
    expect(screen.getByText('Multi-signal checks')).toBeTruthy();
    expect(screen.getByText(/no monetary value/)).toBeTruthy();
  });

  test('不使用禁用文案（9.2）', async () => {
    await render(<LandingScreen />, { wrapper: Wrapper });
    for (const banned of ['Guaranteed earnings', 'Real SKR rewards', 'Cheat-proof', 'Hardware verified', 'Passive income']) {
      expect(screen.queryByText(new RegExp(banned, 'i'))).toBeNull();
    }
  });

  test('Start adventure → GameGuide；Preview → DemoPreview', async () => {
    await render(<LandingScreen />, { wrapper: Wrapper });
    await fireEvent.press(screen.getByText('Start your adventure'));
    expect(mockNavigate).toHaveBeenCalledWith('GameGuide', { onboarding: true });
    await fireEvent.press(screen.getByText('Preview the app'));
    expect(mockNavigate).toHaveBeenCalledWith('DemoPreview');
  });
});
