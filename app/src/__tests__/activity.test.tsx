/** PG-A-20：Activity history — 累計收益、紀錄列表（Onchain／Not redeemed）、空狀態、錯誤狀態、需登入。 */
import { NavigationContainer } from '@react-navigation/native';
import { render, screen, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';

import { ActivityHistoryScreen } from '@/screens/ActivityHistoryScreen';
import { ThemeProvider } from '@/theme';

jest.mock('@/services/api/ApiClient', () => ({ ...jest.requireActual('@/services/api/ApiClient'), apiClient: { history: jest.fn() } }));
const api = jest.requireMock('@/services/api/ApiClient').apiClient as { history: jest.Mock };
const { ApiError } = jest.requireActual('@/services/api/ApiClient');

const Wrapper = ({ children }: PropsWithChildren) => (
  <ThemeProvider>
    <NavigationContainer>{children}</NavigationContainer>
  </ThemeProvider>
);

describe('ActivityHistoryScreen', () => {
  test('顯示累計收益與紀錄；有簽章者標 Onchain、無者 Not redeemed', async () => {
    api.history.mockResolvedValue({ days: 30, retention_days: 30, total_earned: '15000000', items: [
      { task_date: 20_710, task_type: 'steps', issued_at: '', expires_at: '', redeemed_signature: 'sigA', amount: '10000000', xp: 100, shoe_level: 1 },
      { task_date: 20_709, task_type: 'sleep', issued_at: '', expires_at: '', redeemed_signature: null, amount: null, xp: null, shoe_level: null },
    ] });
    await render(<ActivityHistoryScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText('15 tSKR')).toBeTruthy());
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('1/2')).toBeTruthy();
    expect(screen.getByText('+10')).toBeTruthy();
    expect(screen.getByText(/2026-09-14 UTC · 100 XP/)).toBeTruthy();
    expect(screen.getAllByText('Onchain')).toHaveLength(2); // stat 標題 + 一筆紀錄
    expect(screen.getByText('Not redeemed')).toBeTruthy();
  });

  test('空狀態', async () => {
    api.history.mockResolvedValue({ days: 30, retention_days: 30, total_earned: '0', items: [] });
    await render(<ActivityHistoryScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('activity-empty')).toBeTruthy());
  });

  test('需登入與錯誤（含 Ref）', async () => {
    api.history.mockRejectedValueOnce(new ApiError(401, 'NO_SESSION', 'Sign in required'));
    await render(<ActivityHistoryScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('activity-signin')).toBeTruthy());
    api.history.mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'internal error', undefined, null, 'req-9'));
    await render(<ActivityHistoryScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('activity-error')).toBeTruthy());
    expect(screen.getByText('Ref req-9')).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
  });
});
