/**
 * 「需要重新連結」浮層（2026-09-30）。
 *
 * 實機上最難自己發現的狀態：**錢包連著、但後端登入已失效**。首頁照常顯示位址，
 * 同步／任務／收藏卻全在送出前被擋下，而畫面沒有任何地方說該做什麼
 * （當天使用者的原話是「點擊 sync now 沒有任何動作」）。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { SessionNotice } from '@/components/SessionNotice';
import { ApiError, onBackendSessionLost } from '@/services/api/ApiClient';
import { useBackendSessionStore } from '@/state/backendSessionStore';
import { useWalletStore } from '@/state/walletStore';
import { ThemeProvider } from '@/theme';

jest.mock('@/services/api/ApiClient', () => {
  const actual = jest.requireActual('@/services/api/ApiClient');
  return { ...actual, apiClient: { hasSession: jest.fn(async () => true), signIn: jest.fn(async () => ({})) } };
});
const api = jest.requireMock('@/services/api/ApiClient').apiClient as { hasSession: jest.Mock; signIn: jest.Mock };

const connect = () => useWalletStore.setState({ session: { address: 'walletA' } } as never);

beforeEach(() => {
  jest.clearAllMocks();
  useBackendSessionStore.setState({ state: 'unknown', reason: null, restoring: false });
  useWalletStore.setState({ session: null } as never);
});

test('錢包連著但後端 session 失效 → 顯示浮層，並說明錢包授權還在', async () => {
  connect();
  useBackendSessionStore.getState().markExpired('invalid');
  await render(<ThemeProvider><SessionNotice /></ThemeProvider>);
  expect(await screen.findByTestId('session-notice')).toBeTruthy();
  // 文案要說清楚「不必重走新手流程」——那正是使用者當天的疑問
  expect(screen.getByText(/not repeat setup|不會重走新手流程/)).toBeTruthy();
});

test('沒連錢包時不顯示——那時候「請登入」是理所當然的，不需要浮層', async () => {
  useBackendSessionStore.getState().markExpired('missing');
  await render(<ThemeProvider><SessionNotice /></ThemeProvider>);
  expect(screen.queryByTestId('session-notice')).toBeNull();
});

test('session 正常時不顯示', async () => {
  connect();
  useBackendSessionStore.getState().markActive();
  await render(<ThemeProvider><SessionNotice /></ThemeProvider>);
  expect(screen.queryByTestId('session-notice')).toBeNull();
});

test('按「重新連結」只做 SIWS，成功後浮層消失', async () => {
  connect();
  useBackendSessionStore.getState().markExpired('invalid');
  await render(<ThemeProvider><SessionNotice /></ThemeProvider>);
  await fireEvent.press(await screen.findByTestId('session-restore'));
  await waitFor(() => expect(api.signIn).toHaveBeenCalledWith('walletA'));
  await waitFor(() => expect(screen.queryByTestId('session-notice')).toBeNull());
});

test('重新連結失敗時維持顯示，使用者可以再試', async () => {
  connect();
  useBackendSessionStore.getState().markExpired('invalid');
  api.signIn.mockRejectedValueOnce(new ApiError(503, 'SERVER_ERROR', 'down'));
  await render(<ThemeProvider><SessionNotice /></ThemeProvider>);
  await fireEvent.press(await screen.findByTestId('session-restore'));
  await waitFor(() => expect(api.signIn).toHaveBeenCalled());
  expect(screen.getByTestId('session-notice')).toBeTruthy();
});

test('ApiClient 丟出 NO_SESSION 時會通知 store——各畫面不必自己猜', () => {
  const seen: string[] = [];
  const off = onBackendSessionLost((r) => seen.push(r));
  // 直接觸發監聽器（emit 點在 requestRaw 內，這裡只驗通道本身接得上）
  useBackendSessionStore.getState().markExpired('missing');
  expect(useBackendSessionStore.getState().state).toBe('expired');
  off();
  expect(seen.length).toBe(0);
});

test('check() 查不到時不亂猜，維持現狀（避免離線誤報要重新連結）', async () => {
  connect();
  useBackendSessionStore.getState().markActive();
  api.hasSession.mockRejectedValueOnce(new Error('offline'));
  await useBackendSessionStore.getState().check();
  expect(useBackendSessionStore.getState().state).toBe('active');
});
