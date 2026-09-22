import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { ApprovalNotice } from '@/components/ApprovalNotice';
import { MintProgress } from '@/components/MintProgress';
import { useWalletStore } from '@/state/walletStore';
import { ThemeProvider } from '@/theme';

jest.mock('@/services/api/ApiClient', () => ({ apiClient: { myAchievements: jest.fn() } }));
const api = jest.requireMock('@/services/api/ApiClient').apiClient;
const approved = { achievement_id: 'approval1', status: 'approved', minted: false, kind: 'milestone' };
beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  jest.spyOn(SecureStore, 'getItemAsync').mockResolvedValue(null);
  useWalletStore.setState({ session: { address: 'walletA' } as never });
});
afterEach(async () => { await cleanup(); jest.restoreAllMocks(); });

test('approved notification opens the matching achievement, persists dismissal, and does not mint', async () => {
  api.myAchievements.mockResolvedValue({ items: [approved] });
  const open = jest.fn();
  await render(<ThemeProvider><ApprovalNotice onOpen={open} /></ThemeProvider>);
  await waitFor(() => expect(screen.getByTestId('approval-notice')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('approval-open'));
  expect(open).toHaveBeenCalledWith(approved);
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith('approval-notices-v1.walletA', '["approval1"]');
  expect(screen.queryByTestId('approval-notice')).toBeNull();
});

test('pending and already minted achievements do not trigger approval notifications', async () => {
  api.myAchievements.mockResolvedValue({ items: [{ ...approved, status: 'pending_registry' }, { ...approved, minted: true }] });
  await render(<ThemeProvider><ApprovalNotice onOpen={jest.fn()} /></ThemeProvider>);
  await waitFor(() => expect(api.myAchievements).toHaveBeenCalled());
  expect(screen.queryByTestId('approval-notice')).toBeNull();
});

test('a late approval response cannot appear after switching accounts', async () => {
  let resolve!: (value: unknown) => void;
  api.myAchievements.mockReturnValueOnce(new Promise(r => { resolve = r; })).mockResolvedValue({ items: [] });
  await render(<ThemeProvider><ApprovalNotice onOpen={jest.fn()} /></ThemeProvider>);
  await waitFor(() => expect(api.myAchievements).toHaveBeenCalledTimes(1));
  await act(async () => { useWalletStore.setState({ session: { address: 'walletB' } as never }); });
  await act(async () => { resolve({ items: [approved] }); });
  expect(screen.queryByTestId('approval-notice')).toBeNull();
});

test('progress reflects the supplied stage without announcing mint success early', async () => {
  const view = await render(<ThemeProvider><MintProgress phase="wallet" /></ThemeProvider>);
  expect(screen.getByTestId('mint-progress-wallet')).toBeTruthy();
  await view.rerender(<ThemeProvider><MintProgress phase="confirming" /></ThemeProvider>);
  expect(screen.queryByTestId('mint-progress-wallet')).toBeNull();
  expect(screen.getByTestId('mint-progress-confirming')).toBeTruthy();
});
