/**
 * PG-SEASON-03（設計 §4）：節日章的畫面只呈現「活動與資格狀態」。
 * 最重要的是——達標不得出現領取按鈕，也不能說 NFT 已到手（後端 mint_enabled: false）。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import type { PropsWithChildren } from 'react';

import { SeasonalBadge } from '@/components/SeasonalBadge';
import { SeasonalFootprints } from '@/components/SeasonalFootprints';
import { t, useLocaleStore } from '@/i18n';
import { apiClient, type MySeasonalItem } from '@/services/api/ApiClient';
import { useWalletStore } from '@/state/walletStore';
import { ThemeProvider } from '@/theme';

jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useNavigation: () => ({ navigate: jest.fn() }), useFocusEffect: () => {} }));

const Wrapper = ({ children }: PropsWithChildren) => (
  <ThemeProvider>
    <NavigationContainer>{children}</NavigationContainer>
  </ThemeProvider>
);

const campaign = (o: Partial<MySeasonalItem> = {}): MySeasonalItem => ({
  campaign_id: 'genesis-stride-2027',
  theme_id: 'genesis_stride',
  year: 2027,
  art_version: 1,
  rules_version: 1,
  prototype: false,
  window: { starts_at: '2027-03-16T00:00:00.000Z', ends_at: '2027-03-17T00:00:00.000Z', display_timezone: 'UTC', state: 'open' },
  rules: { min_moving_minutes: 20, grace_days: 7, single_session: true, gps_counts: true },
  source: { fact: 'Mainnet Beta 2020-03-16', url: 'https://example.com', checked_on: '2026-09-25' },
  mint_enabled: false,
  status: 'locked',
  first: null,
  pending: null,
  progress: { best_moving_ms: 0, required_ms: 1_200_000 },
  reason: null,
  ...o,
});

beforeEach(() => {
  jest.clearAllMocks();
  useLocaleStore.setState({ setting: 'en', locale: 'en' });
  useWalletStore.setState({ status: 'connected', session: { address: 'wallet-a' } } as never);
});

const mockMine = (items: MySeasonalItem[]) => jest.spyOn(apiClient, 'mySeasonal').mockResolvedValue({ items, notes: ['eligibility_only_no_mint_path_yet'] });

test('進行中的窗口：顯示活動時區與本地時間、單筆 20 分規則與開始運動入口', async () => {
  mockMine([campaign()]);
  await render(<SeasonalFootprints />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByTestId('seasonal-genesis-stride-2027')).toBeTruthy());
  expect(screen.getByText(t('season.window.open'))).toBeTruthy();
  expect(screen.getByText(/UTC/)).toBeTruthy();
  expect(screen.getByText(/at least 20 minutes/)).toBeTruthy();
  expect(screen.getByTestId('seasonal-genesis-stride-2027-start')).toBeTruthy();
});

test('達標：說「已達標、尚未開放領取」，且畫面上沒有任何領取按鈕', async () => {
  mockMine([campaign({ status: 'eligible', first: { source: { kind: 'workout', id: 'w1', revision: 1 }, started_at: '2027-03-16T08:00:00Z', moving_ms: 1_500_000 }, progress: { best_moving_ms: 1_500_000, required_ms: 1_200_000 } })]);
  await render(<SeasonalFootprints />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByTestId('seasonal-genesis-stride-2027-status-eligible')).toBeTruthy());
  expect(screen.getByText(t('season.state.eligible'))).toBeTruthy();
  expect(screen.getByText(t('season.state.eligibleBody'))).toBeTruthy();
  // 沒有任何領取／鑄造按鈕（說明文字本身會提到「尚未開放領取」，所以只查按鈕）
  expect(screen.queryByRole('button', { name: /Mint|Claim|領取/ })).toBeNull();
  expect(screen.queryByTestId('seasonal-genesis-stride-2027-start')).toBeNull();
  // 可以連回是哪一次運動取得
  expect(screen.getByTestId('seasonal-genesis-stride-2027-source')).toBeTruthy();
});

test('待審：說明審查決定的是運動是否符合條件，不是收藏品結果', async () => {
  mockMine([campaign({ status: 'pending_review', pending: { source: { kind: 'workout', id: 'w2', revision: 1 }, started_at: '2027-03-16T08:00:00Z', moving_ms: 1_500_000 } })]);
  await render(<SeasonalFootprints />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByTestId('seasonal-genesis-stride-2027-status-pending_review')).toBeTruthy());
  expect(screen.getByText(t('season.state.pendingBody'))).toBeTruthy();
});

test('未達標：進度用分鐘說還差多少，不只給倒數', async () => {
  mockMine([campaign({ progress: { best_moving_ms: 900_000, required_ms: 1_200_000 } })]);
  await render(<SeasonalFootprints />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByText(/15 of 20 minutes/)).toBeTruthy());
});

test('測試窗口標 Prototype；已結束的屆次不給開始運動', async () => {
  mockMine([campaign({ prototype: true, window: { ...campaign().window, state: 'closed' } })]);
  await render(<SeasonalFootprints />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByText(t('season.prototype'))).toBeTruthy());
  expect(screen.getByText(t('season.window.closed'))).toBeTruthy();
  expect(screen.queryByTestId('seasonal-genesis-stride-2027-start')).toBeNull();
});

test('未登入：只拿公開目錄、不顯示個人狀態', async () => {
  useWalletStore.setState({ status: 'disconnected', session: null } as never);
  const pub = jest.spyOn(apiClient, 'seasonal').mockResolvedValue({ items: [{ ...campaign(), status: undefined } as never] });
  const mine = jest.spyOn(apiClient, 'mySeasonal');
  await render(<SeasonalFootprints />, { wrapper: Wrapper });
  await waitFor(() => expect(pub).toHaveBeenCalled());
  expect(mine).not.toHaveBeenCalled();
  expect(screen.queryByTestId('seasonal-genesis-stride-2027-status-locked')).toBeNull();
});

test('沒有任何已發布窗口 → 說清楚還沒有，不假裝有活動', async () => {
  mockMine([]);
  await render(<SeasonalFootprints />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByTestId('seasonal-empty')).toBeTruthy());
});

test('讀取失敗顯示警示，不讓整段消失', async () => {
  jest.spyOn(apiClient, 'mySeasonal').mockRejectedValue(new Error('offline'));
  await render(<SeasonalFootprints />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByTestId('seasonal-failed')).toBeTruthy());
});

test('徽章：上鎖不只靠顏色（有鎖圖示），已取得則沒有', async () => {
  const locked = await render(<SeasonalBadge themeId="moonlit_steps" year={2026} state="locked" />, { wrapper: Wrapper });
  expect(locked.getByTestId('seasonal-badge-lock')).toBeTruthy();
  await locked.unmount();
  const earned = await render(<SeasonalBadge themeId="moonlit_steps" year={2026} state="earned" />, { wrapper: Wrapper });
  expect(earned.queryByTestId('seasonal-badge-lock')).toBeNull();
});

test('徽章：五種主題各有自己的插畫，未知主題也畫得出來（不留白）', async () => {
  for (const theme of ['genesis_stride', 'seeker_horizon', 'moonlit_steps', 'pizza_miles', 'mobile_trail', 'unknown_theme']) {
    const v = await render(<SeasonalBadge themeId={theme} year={2027} state="earned" />, { wrapper: Wrapper });
    expect(v.getByTestId(`seasonal-badge-${theme}-earned`)).toBeTruthy();
    await v.unmount();
  }
});

describe('年份篩選（PG-SEASON-03；設計 §5「不把每年卡片全部塞到首頁」）', () => {
  const y2026 = campaign({ campaign_id: 'moonlit-steps-2026-demo', theme_id: 'moonlit_steps', year: 2026, prototype: true, window: { starts_at: '2026-10-01T00:00:00.000Z', ends_at: '2026-10-02T00:00:00.000Z', display_timezone: 'UTC', state: 'closed' } });
  const y2027b = campaign({ campaign_id: 'seeker-horizon-2027', theme_id: 'seeker_horizon', year: 2027, window: { starts_at: '2027-08-04T00:00:00.000Z', ends_at: '2027-08-05T00:00:00.000Z', display_timezone: 'UTC', state: 'upcoming' } });

  test('只有一個年份時不出現篩選列', async () => {
    mockMine([campaign()]);
    await render(<SeasonalFootprints />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('seasonal-genesis-stride-2027')).toBeTruthy());
    expect(screen.queryByTestId('seasonal-years')).toBeNull();
  });

  test('跨年份：預設全部、年份新的在前、選一年只留那一年', async () => {
    mockMine([y2026, y2027b, campaign()]);
    await render(<SeasonalFootprints />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('seasonal-years')).toBeTruthy());
    expect(screen.getByTestId('seasonal-year-all')).toBeTruthy();
    // 新的年份排在前面
    const years = screen.getAllByRole('tab').map((n) => n.props.accessibilityLabel as string);
    expect(years).toEqual([t('season.year.all'), 'Year 2027', 'Year 2026']);
    // 預設不篩：三屆都在
    expect(screen.getByTestId('seasonal-moonlit-steps-2026-demo')).toBeTruthy();
    expect(screen.getByTestId('seasonal-genesis-stride-2027')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('seasonal-year-2026'));
    await waitFor(() => expect(screen.queryByTestId('seasonal-genesis-stride-2027')).toBeNull());
    expect(screen.getByTestId('seasonal-moonlit-steps-2026-demo')).toBeTruthy();
    expect(screen.queryByTestId('seasonal-seeker-horizon-2027')).toBeNull();

    await fireEvent.press(screen.getByTestId('seasonal-year-all'));
    await waitFor(() => expect(screen.getByTestId('seasonal-genesis-stride-2027')).toBeTruthy());
  });

  test('同一年依窗口開始時間排序（收藏年份排序）', async () => {
    mockMine([y2027b, campaign(), y2026]);
    await render(<SeasonalFootprints />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('seasonal-years')).toBeTruthy());
    const order = screen.getAllByTestId(/^seasonal-(?!year-)[a-z].*-\d{4}(-demo)?$/).map((n) => n.props.testID as string);
    expect(order).toEqual(['seasonal-genesis-stride-2027', 'seasonal-seeker-horizon-2027', 'seasonal-moonlit-steps-2026-demo']);
  });
});
