/**
 * PG-SEASON-05 節日資格核准通知（設計 §4.3／§4.4）。
 *
 * 伺服器核准的是**資格**，不是 NFT。所以這個浮層在 `mint_enabled: false` 時只能說
 * 「本屆尚未開放領取」，不能出現領取按鈕，也不能播放任何揭曉動畫——那兩件事要等
 * PG-SEASON-04 真的有 mint 路徑。待驗證（`pending_review`）不彈通知。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { AppState } from 'react-native';

import { SeasonalNotice } from '@/components/SeasonalNotice';
import { t, useLocaleStore } from '@/i18n';
import { useWalletStore } from '@/state/walletStore';
import { ThemeProvider } from '@/theme';

jest.mock('@/services/api/ApiClient', () => ({ apiClient: { mySeasonal: jest.fn() } }));
const api = jest.requireMock('@/services/api/ApiClient').apiClient as { mySeasonal: jest.Mock };

const campaign = (o: Record<string, unknown> = {}) => ({
  campaign_id: 'genesis-stride-2027', theme_id: 'genesis_stride', year: 2027, art_version: 1, rules_version: 1, prototype: false,
  window: { starts_at: '2027-03-16T00:00:00.000Z', ends_at: '2027-03-17T00:00:00.000Z', display_timezone: 'UTC', state: 'open' },
  rules: { min_moving_minutes: 20, grace_days: 7, single_session: true, gps_counts: true },
  source: { fact: 'x', url: 'https://example.com', checked_on: '2026-09-25' },
  mint_enabled: false, status: 'eligible', first: null, pending: null,
  progress: { best_moving_ms: 1_500_000, required_ms: 1_200_000 }, reason: null, ...o,
});

beforeEach(() => {
  jest.clearAllMocks();
  useLocaleStore.setState({ setting: 'en', locale: 'en' });
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  jest.spyOn(SecureStore, 'getItemAsync').mockResolvedValue(null);
  useWalletStore.setState({ session: { address: 'walletA' } as never });
});
afterEach(async () => { await cleanup(); jest.restoreAllMocks(); });

test('資格核准 → 通知說「尚未開放領取」，沒有領取按鈕；關閉後記在本機', async () => {
  api.mySeasonal.mockResolvedValue({ items: [campaign()] });
  const open = jest.fn();
  await render(<ThemeProvider><SeasonalNotice onOpen={open} /></ThemeProvider>);
  await waitFor(() => expect(screen.getByTestId('seasonal-notice')).toBeTruthy());
  expect(screen.getByText(t('season.notice.notOpen', { name: 'Genesis Stride 2027' }))).toBeTruthy();
  // 核准的是資格：這個浮層不得出現任何領取入口
  expect(screen.queryByText(t('pb.mint'))).toBeNull();
  expect(screen.queryByText(t('gear.claim'))).toBeNull();
  await fireEvent.press(screen.getByTestId('seasonal-notice-open'));
  expect(open).toHaveBeenCalled();
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith('seasonal-notices-v1.walletA', '["genesis-stride-2027"]');
  expect(screen.queryByTestId('seasonal-notice')).toBeNull();
});

test('待驗證與未達標不彈通知（還沒核准就先報喜會被讀成已經拿到）', async () => {
  api.mySeasonal.mockResolvedValue({ items: [campaign({ status: 'pending_review' }), campaign({ campaign_id: 'x-2027', status: 'locked' })] });
  await render(<ThemeProvider><SeasonalNotice onOpen={jest.fn()} /></ThemeProvider>);
  await waitFor(() => expect(api.mySeasonal).toHaveBeenCalled());
  expect(screen.queryByTestId('seasonal-notice')).toBeNull();
});

test('已關閉過的一屆不再出現；開放領取後文案才會變', async () => {
  jest.spyOn(SecureStore, 'getItemAsync').mockResolvedValue('["genesis-stride-2027"]');
  api.mySeasonal.mockResolvedValue({ items: [campaign()] });
  await render(<ThemeProvider><SeasonalNotice onOpen={jest.fn()} /></ThemeProvider>);
  await waitFor(() => expect(api.mySeasonal).toHaveBeenCalled());
  expect(screen.queryByTestId('seasonal-notice')).toBeNull();
  await cleanup();

  jest.spyOn(SecureStore, 'getItemAsync').mockResolvedValue(null);
  api.mySeasonal.mockResolvedValue({ items: [campaign({ mint_enabled: true })] });
  await render(<ThemeProvider><SeasonalNotice onOpen={jest.fn()} /></ThemeProvider>);
  await waitFor(() => expect(screen.getByTestId('seasonal-notice')).toBeTruthy());
  expect(screen.getByText(t('season.notice.claimable', { name: 'Genesis Stride 2027' }))).toBeTruthy();
});

test('讀不到伺服器不會清掉也不會偽造通知；未登入完全不查', async () => {
  api.mySeasonal.mockRejectedValue(new Error('offline'));
  await render(<ThemeProvider><SeasonalNotice onOpen={jest.fn()} /></ThemeProvider>);
  await waitFor(() => expect(api.mySeasonal).toHaveBeenCalled());
  expect(screen.queryByTestId('seasonal-notice')).toBeNull();
  await cleanup();

  jest.clearAllMocks();
  useWalletStore.setState({ session: null as never });
  await render(<ThemeProvider><SeasonalNotice onOpen={jest.fn()} /></ThemeProvider>);
  expect(api.mySeasonal).not.toHaveBeenCalled();
});
