import { NavigationContainer } from '@react-navigation/native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';

import type { BootstrapState } from '@/bootstrap';
import { BootstrapScreen } from '@/screens/launch/BootstrapScreen';
import { ThemeProvider } from '@/theme';

const mockReset = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), reset: mockReset }),
}));

let mockState: BootstrapState;
jest.mock('@/bootstrap', () => ({
  ...jest.requireActual('@/bootstrap'),
  useBootstrap: () => mockState,
}));

const base = (over: Partial<BootstrapState>): BootstrapState => ({
  phase: 'loading',
  steps: [
    { id: 'profile', label: 'Restoring your profile', status: 'done' },
    { id: 'health', label: 'Checking health access', status: 'running' },
    { id: 'network', label: 'Contacting devnet', status: 'pending' },
  ],
  currentLabel: 'Checking health access',
  diagnostics: [],
  retry: jest.fn(),
  canUseOffline: false,
  continueOffline: jest.fn(),
  ...over,
});

const Wrapper = ({ children }: PropsWithChildren) => (
  <ThemeProvider>
    <NavigationContainer>{children}</NavigationContainer>
  </ThemeProvider>
);

describe('BootstrapScreen（Style 8.2）', () => {
  test('hidden：不渲染內容以免閃爍', async () => {
    mockState = base({ phase: 'hidden' });
    await render(<BootstrapScreen />, { wrapper: Wrapper });
    expect(screen.getByTestId('bootstrap-hidden')).toBeTruthy();
    expect(screen.queryByText('DEVNET')).toBeNull();
  });

  test('loading：顯示目前步驟文案，不列出步驟清單', async () => {
    mockState = base({});
    await render(<BootstrapScreen />, { wrapper: Wrapper });
    expect(screen.getByText('Checking health access')).toBeTruthy();
    expect(screen.queryByText('Restoring your profile')).toBeNull();
    expect(screen.queryByText('Use offline data')).toBeNull();
  });

  test('slow：列出步驟；有快取時才顯示 Use offline data', async () => {
    mockState = base({ phase: 'slow', canUseOffline: true });
    await render(<BootstrapScreen />, { wrapper: Wrapper });
    expect(screen.getByText('Restoring your profile')).toBeTruthy();
    expect(screen.getByText('Contacting devnet')).toBeTruthy();
    await fireEvent.press(screen.getByText('Use offline data'));
    expect(mockState.continueOffline).toHaveBeenCalled();
  });

  test('stalled：Retry 與診斷摘要，且不顯示 spinner 文案', async () => {
    mockState = base({ phase: 'stalled', currentLabel: undefined, diagnostics: ['Elapsed 10234 ms'] });
    await render(<BootstrapScreen />, { wrapper: Wrapper });
    expect(screen.getByText('This is taking longer than expected.')).toBeTruthy();
    expect(screen.getByText('Elapsed 10234 ms')).toBeTruthy();
    await fireEvent.press(screen.getByText('Retry'));
    expect(mockState.retry).toHaveBeenCalled();
  });

  test('forceUpdate：顯示版本原因與 Update app', async () => {
    mockState = base({
      phase: 'forceUpdate',
      result: { kind: 'blocked', reason: 'forceUpdate', detail: 'Minimum version 0.2.0', ctx: { onboardingComplete: false, walletConnected: false, hasCache: false, minVersionOk: false } },
    });
    await render(<BootstrapScreen />, { wrapper: Wrapper });
    expect(screen.getByText('Update required')).toBeTruthy();
    expect(screen.getByText('Minimum version 0.2.0')).toBeTruthy();
    expect(screen.getByText('Update app')).toBeTruthy();
    expect(screen.queryByText('Retry')).toBeNull();
  });

  test('done：reset 導航至結果路由（不疊 stack）', async () => {
    mockState = base({
      phase: 'done',
      result: { kind: 'ok', route: 'Landing', ctx: { onboardingComplete: false, walletConnected: false, hasCache: false, minVersionOk: true } },
    });
    await render(<BootstrapScreen />, { wrapper: Wrapper });
    expect(mockReset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'Landing' }] });
  });
});
