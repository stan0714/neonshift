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
import { useSeasonalReminderStore } from '@/state/seasonalReminderStore';
import { useWalletStore } from '@/state/walletStore';
import { ThemeProvider } from '@/theme';

jest.mock('@/services/api/ApiClient', () => ({ apiClient: { mySeasonal: jest.fn(), seasonal: jest.fn() } }));
const api = jest.requireMock('@/services/api/ApiClient').apiClient as { mySeasonal: jest.Mock; seasonal: jest.Mock };

jest.mock('@/services/notifications/seasonalNotifications', () => ({
  syncSeasonalNotifications: jest.fn().mockResolvedValue({ scheduled: [], cancelled: [], kept: [] }),
  cancelAllSeasonalNotifications: jest.fn().mockResolvedValue([]),
}));
const notify = jest.requireMock('@/services/notifications/seasonalNotifications') as {
  syncSeasonalNotifications: jest.Mock;
  cancelAllSeasonalNotifications: jest.Mock;
};

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
  useSeasonalReminderStore.setState({ loaded: true, subscribed: [], dismissed: [] });
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

/**
 * PG-SEASON-06：同一個浮層也負責訂閱提醒。共用一個位置是刻意的——兩個浮層互相蓋住
 * 才是真正的問題；資格核准（已經發生的事）永遠優先於提醒（還沒發生的事）。
 */
describe('訂閱提醒（PG-SEASON-06）', () => {
  const open = () => campaign({ status: 'locked', window: { starts_at: '2027-03-16T00:00:00.000Z', ends_at: '2027-03-17T00:00:00.000Z', display_timezone: 'UTC', state: 'open' } });

  beforeEach(() => jest.useFakeTimers({ now: new Date('2027-03-16T06:00:00Z'), doNotFake: ['nextTick', 'setImmediate'] }));
  afterEach(() => jest.useRealTimers());

  test('沒訂閱 → 不提醒，而且未登入時連請求都不發', async () => {
    useWalletStore.setState({ session: null as never });
    await render(<ThemeProvider><SeasonalNotice onOpen={jest.fn()} /></ThemeProvider>);
    expect(api.mySeasonal).not.toHaveBeenCalled();
    expect(api.seasonal).not.toHaveBeenCalled();
  });

  test('未登入但訂閱了 → 查公開目錄並提醒進行中的那一屆', async () => {
    useWalletStore.setState({ session: null as never });
    useSeasonalReminderStore.setState({ loaded: true, subscribed: ['genesis-stride-2027'], dismissed: [] });
    api.seasonal.mockResolvedValue({ items: [open()] });
    await render(<ThemeProvider><SeasonalNotice onOpen={jest.fn()} /></ThemeProvider>);
    await waitFor(() => expect(screen.getByTestId('seasonal-reminder-open')).toBeTruthy());
    expect(api.mySeasonal).not.toHaveBeenCalled();
    // 文案講的是「還能做什麼」，不是「你已經拿到了」
    expect(screen.getByText(/is open until/)).toBeTruthy();
    expect(screen.getByText(/20 minutes/)).toBeTruthy();
  });

  test('資格核准優先於提醒（已經發生的事先講）', async () => {
    useSeasonalReminderStore.setState({ loaded: true, subscribed: ['genesis-stride-2027'], dismissed: [] });
    api.mySeasonal.mockResolvedValue({ items: [campaign({ status: 'eligible' })] });
    await render(<ThemeProvider><SeasonalNotice onOpen={jest.fn()} /></ThemeProvider>);
    await waitFor(() => expect(screen.getByTestId('seasonal-notice')).toBeTruthy());
    expect(screen.queryByTestId('seasonal-reminder-open')).toBeNull();
  });

  test('關掉提醒會記在本機；同一個階段不再出現', async () => {
    useSeasonalReminderStore.setState({ loaded: true, subscribed: ['genesis-stride-2027'], dismissed: [] });
    api.mySeasonal.mockResolvedValue({ items: [open()] });
    await render(<ThemeProvider><SeasonalNotice onOpen={jest.fn()} /></ThemeProvider>);
    await waitFor(() => expect(screen.getByTestId('seasonal-reminder-open')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('seasonal-reminder-close'));
    await waitFor(() => expect(screen.queryByTestId('seasonal-reminder-open')).toBeNull());
    expect(useSeasonalReminderStore.getState().dismissed).toEqual(['open:genesis-stride-2027']);
  });
});


/**
 * PG-SEASON-06 的本機排程通知由這支元件負責對齊（它本來就會定期拿活動資料）。
 * 這裡釘住兩件容易漏的事：關掉最後一屆時**要把已排的通知清掉**，
 * 否則「關了開關還是被通知」；以及有訂閱時排程計畫要跟著活動資料走。
 */
test('未登入且關掉最後一屆訂閱時，清掉已排的通知（否則關了開關還是會被通知）', async () => {
  useWalletStore.setState({ session: null as never });
  useSeasonalReminderStore.setState({ loaded: true, subscribed: [], dismissed: [] });
  await render(<ThemeProvider><SeasonalNotice onOpen={jest.fn()} /></ThemeProvider>);
  await waitFor(() => expect(notify.cancelAllSeasonalNotifications).toHaveBeenCalled());
  // 沒有要查的東西時仍然不發請求
  expect(api.seasonal).not.toHaveBeenCalled();
  expect(api.mySeasonal).not.toHaveBeenCalled();
  expect(notify.syncSeasonalNotifications).not.toHaveBeenCalled();
});

test('有訂閱時以拿到的活動資料對齊排程', async () => {
  useWalletStore.setState({ session: null as never });
  useSeasonalReminderStore.setState({ loaded: true, subscribed: ['genesis-stride-2027'], dismissed: [] });
  api.seasonal.mockResolvedValue({ items: [campaign({ status: undefined })] });
  await render(<ThemeProvider><SeasonalNotice onOpen={jest.fn()} /></ThemeProvider>);
  await waitFor(() => expect(notify.syncSeasonalNotifications).toHaveBeenCalled());
  expect(notify.cancelAllSeasonalNotifications).not.toHaveBeenCalled();
});
