/**
 * PG-SEASON-03（設計 §4）：節日章的畫面只呈現「活動與資格狀態」。
 * 最重要的是——達標不得出現領取按鈕，也不能說 NFT 已到手（後端 mint_enabled: false）。
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import type { PropsWithChildren } from 'react';

import { SeasonalBadge } from '@/components/SeasonalBadge';
import { ShareCard } from '@/components/ShareCard';
import { seasonalShareLayout, SEASONAL_SHARE_DEFAULT, sharePublishable } from '@/domain/shareImage';
import { SeasonalFootprints } from '@/components/SeasonalFootprints';
import { t, useLocaleStore } from '@/i18n';
import { apiClient, type MySeasonalItem } from '@/services/api/ApiClient';
import { useSeasonalReminderStore } from '@/state/seasonalReminderStore';
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
  source: { fact: { 'zh-TW': '中文依據', en: 'english reference' }, url: 'https://example.com', checked_on: '2026-09-25' },
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
  useSeasonalReminderStore.setState({ loaded: true, subscribed: [], dismissed: [] });
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

/**
 * PG-SEASON-05 節日收藏卡（設計 §4.5）。三條界線：狀態如實、公開日期與個人取得時間分開、
 * 沒有任何鏈上資產就不掛網路標示。
 */
describe('節日收藏卡（PG-SEASON-05）', () => {
  const tr = (k: string, p?: Record<string, string | number>) => t(k as never, p);
  const base = { themeName: 'Genesis Stride', themeId: 'genesis_stride', year: 2027, windowLabel: 'Mar 16 (UTC)', achievedAt: new Date('2027-03-16T08:00:00Z'), mintEnabled: false };
  const mk = (o: Partial<typeof base & { status: 'eligible' | 'pending_review' }> = {}, f = SEASONAL_SHARE_DEFAULT) =>
    seasonalShareLayout({ ...base, status: 'eligible', ...o }, f, { t: tr, labels: { tagline: 'Walk or run to grow your shoes.', site: 'neonshift.cc' } });

  test('mint 沒開放就只能寫「尚未開放領取」，而且不是鏈上資產', () => {
    const l = mk();
    expect(l.lines[0]).toBe(t('share.card.seasonal.notOpen'));
    expect(l.lines.join('|')).not.toMatch(/minted|鑄造/i);
    expect(l.chainAsset).toBe(false);
    expect(l.notice).toBeNull();
    expect(sharePublishable(l)).toBe(true);
  });

  test('待驗證不能寫成已達標；開放領取後才變成「可領取，尚未鑄造」', () => {
    expect(mk({ status: 'pending_review' }).lines[0]).toBe(t('share.card.seasonal.pending'));
    expect(mk({ status: 'pending_review' }).badge).toMatchObject({ state: 'pending' });
    expect(mk({ mintEnabled: true }).lines[0]).toBe(t('share.card.seasonal.claimable'));
    // 即使開放領取，沒鑄造就還不是鏈上資產
    expect(mk({ mintEnabled: true }).chainAsset).toBe(false);
    expect(mk().badge).toMatchObject({ themeId: 'genesis_stride', year: 2027, state: 'earned' });
  });

  test('活動窗口（公開）一定在；自己達標的時間預設不在，勾選後只到月份', () => {
    expect(mk().lines).toContain('Mar 16 (UTC)');
    expect(mk().lines.join('|')).not.toMatch(/2027-03/);
    expect(mk({}, { date: true }).lines).toContain(t('share.card.seasonal.achieved', { month: '2027-03' }));
    // 連勾選後也只到月份：只看新增的那一行（窗口那一行本來就含公開日期）
    const added = mk({}, { date: true }).lines.filter((l) => !mk().lines.includes(l));
    expect(added).toHaveLength(1);
    expect(added[0]).not.toMatch(/-16|08:00/);
  });

  test('圖上畫的是這一章真正的插畫，不是分享時另畫一個代號', async () => {
    await render(<ShareCard layout={mk()} />);
    expect(screen.getByTestId('share-card-badge-genesis_stride-earned')).toBeTruthy();
    // 待驗證的章畫成 pending（虛線軌道），不會借用已達標的樣式
    await render(<ShareCard layout={mk({ status: 'pending_review' })} testID="pending-card" />);
    expect(screen.getByTestId('share-card-badge-genesis_stride-pending')).toBeTruthy();
  });

  test('收藏頁：達標才有分享入口；未達標沒有', async () => {
    mockMine([campaign({ status: 'locked' })]);
    await render(<SeasonalFootprints />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('seasonal-genesis-stride-2027')).toBeTruthy());
    expect(screen.queryByTestId('seasonal-genesis-stride-2027-share')).toBeNull();

    mockMine([campaign({ status: 'eligible', first: { source: { kind: 'workout', id: 'w1', revision: 1 }, started_at: '2027-03-16T08:00:00Z', moving_ms: 1_500_000 }, progress: { best_moving_ms: 1_500_000, required_ms: 1_200_000 } })]);
    await render(<SeasonalFootprints />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('seasonal-genesis-stride-2027-share-open')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('seasonal-genesis-stride-2027-share-open'));
    await waitFor(() => expect(screen.getByTestId('seasonal-genesis-stride-2027-share-preview')).toBeTruthy());
    // 畫面上也沒有領取按鈕（分享不是領取）
    expect(screen.queryByTestId('seasonal-genesis-stride-2027-claim')).toBeNull();
  });
});

describe('提醒訂閱（PG-SEASON-06）', () => {
  test('訂閱開關存在本機；打開後說清楚「只有 App 內提醒、不會上傳」', async () => {
    mockMine([campaign()]);
    await render(<SeasonalFootprints />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('seasonal-genesis-stride-2027-remind')).toBeTruthy());
    // 沒訂閱時不佔版面說明
    expect(screen.queryByTestId('seasonal-genesis-stride-2027-remind-note')).toBeNull();
    await fireEvent(screen.getByTestId('seasonal-genesis-stride-2027-remind'), 'valueChange', true);
    await waitFor(() => expect(useSeasonalReminderStore.getState().subscribed).toEqual(['genesis-stride-2027']));
    expect(screen.getByTestId('seasonal-genesis-stride-2027-remind-note')).toBeTruthy();
    expect(screen.getByText(t('season.remindNote'))).toBeTruthy();
  });

  test('已結束的一屆不再提供訂閱（提醒一個結束的窗口沒有意義）', async () => {
    mockMine([campaign({ window: { starts_at: '2027-03-16T00:00:00.000Z', ends_at: '2027-03-17T00:00:00.000Z', display_timezone: 'UTC', state: 'closed' } })]);
    await render(<SeasonalFootprints />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('seasonal-genesis-stride-2027')).toBeTruthy());
    expect(screen.queryByTestId('seasonal-genesis-stride-2027-remind')).toBeNull();
  });

  test('取消訂閱會把這一屆的已讀提醒一起清掉（重新訂閱要收得到）', async () => {
    useSeasonalReminderStore.setState({ loaded: true, subscribed: ['genesis-stride-2027'], dismissed: ['open:genesis-stride-2027', 'soon:other-2027'] });
    mockMine([campaign()]);
    await render(<SeasonalFootprints />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('seasonal-genesis-stride-2027-remind')).toBeTruthy());
    await fireEvent(screen.getByTestId('seasonal-genesis-stride-2027-remind'), 'valueChange', false);
    await waitFor(() => expect(useSeasonalReminderStore.getState().subscribed).toEqual([]));
    expect(useSeasonalReminderStore.getState().dismissed).toEqual(['soon:other-2027']);
  });
});

/**
 * PG-SEASON-04：領取。畫面上的鐵則是「`mint_enabled` 關著就沒有領取按鈕」——
 * 達標不等於已取得，而那個開關代表的是鏈上程式支援與部署狀態，不是活動熱度。
 */
describe('領取（PG-SEASON-04）', () => {
  const earned = (over: Partial<MySeasonalItem> = {}) =>
    campaign({ status: 'eligible', first: { source: { kind: 'workout', id: 'w1', revision: 1 }, started_at: '2027-03-16T08:00:00Z', moving_ms: 1_500_000 }, progress: { best_moving_ms: 1_500_000, required_ms: 1_200_000 }, ...over });

  test('mint_enabled 關著（預設）→ 達標也沒有領取按鈕，文案說尚未開放', async () => {
    mockMine([earned()]);
    await render(<SeasonalFootprints />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('seasonal-genesis-stride-2027-status-eligible')).toBeTruthy());
    expect(screen.queryByTestId('seasonal-genesis-stride-2027-claim')).toBeNull();
    expect(screen.getByText(t('season.state.eligibleBody'))).toBeTruthy();
  });

  test('mint_enabled 開著 → 出現領取按鈕，文案改成可以領取（會付網路費與 rent）', async () => {
    mockMine([earned({ mint_enabled: true })]);
    await render(<SeasonalFootprints />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('seasonal-genesis-stride-2027-claim-btn')).toBeTruthy());
    expect(screen.getByText(t('season.state.claimableBody'))).toBeTruthy();
    // 尚未達標的一屆即使開放領取也沒有按鈕
    mockMine([campaign({ status: 'locked', mint_enabled: true })]);
    await render(<SeasonalFootprints />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('seasonal-genesis-stride-2027')).toBeTruthy());
    expect(screen.queryByTestId('seasonal-genesis-stride-2027-claim-btn')).toBeNull();
  });

  test('待驗證不給領取（審查決定的是資格，不是收藏品）', async () => {
    mockMine([campaign({ status: 'pending_review', mint_enabled: true, pending: { source: { kind: 'workout', id: 'w2', revision: 1 }, started_at: '2027-03-16T08:00:00Z', moving_ms: 1_500_000 } })]);
    await render(<SeasonalFootprints />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('seasonal-genesis-stride-2027-status-pending_review')).toBeTruthy());
    expect(screen.queryByTestId('seasonal-genesis-stride-2027-claim-btn')).toBeNull();
  });
});

/**
 * R5（implementation-review-2026-09-29）：session 改變會重抓，但沒先清空個人 rows，
 * 也沒有忽略過時請求。A 的資格會留在 B 的畫面上，A 的慢回應還能蓋掉 B。
 * 就算 mint 最後被後端擋下，使用者已經先看到了假資格。
 */
describe('R5：節日收藏不得殘留跨帳號資料', () => {
  const ELIGIBLE = 'seasonal-genesis-stride-2027-status-eligible';
  const asWallet = (address: string | null) =>
    useWalletStore.setState(address ? ({ status: 'connected', session: { address } } as never) : ({ status: 'disconnected', session: null } as never));

  test('換錢包 → A 的資格立刻從畫面消失，不必等 B 回來', async () => {
    const spy = mockMine([campaign({ status: 'eligible' })]);
    await render(<SeasonalFootprints />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId(ELIGIBLE)).toBeTruthy());
    spy.mockImplementation(() => new Promise(() => {})); // B 的請求還沒回來
    await act(async () => { asWallet('wallet-b'); });
    expect(screen.queryByTestId(ELIGIBLE)).toBeNull();
    // 公開目錄（窗口、規則、提醒）與帳號無關，照樣留著——不必整段消失
    expect(screen.getByTestId('seasonal-genesis-stride-2027')).toBeTruthy();
  });

  test('登出 → 個人狀態消失（公開目錄還在）', async () => {
    const spy = mockMine([campaign({ status: 'eligible' })]);
    await render(<SeasonalFootprints />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId(ELIGIBLE)).toBeTruthy());
    jest.spyOn(apiClient, 'seasonal').mockResolvedValue({ items: [{ ...campaign(), status: undefined } as never] });
    await act(async () => { asWallet(null); });
    expect(screen.queryByTestId(ELIGIBLE)).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1); // 登出後不再問個人資格
  });

  test('B 載入失敗 → 退回公開目錄，不保留 A 的資格', async () => {
    const spy = mockMine([campaign({ status: 'eligible' })]);
    await render(<SeasonalFootprints />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId(ELIGIBLE)).toBeTruthy());
    spy.mockRejectedValue(new Error('offline'));
    await act(async () => { asWallet('wallet-b'); });
    await waitFor(() => expect(screen.getByTestId('seasonal-failed')).toBeTruthy());
    expect(screen.queryByTestId(ELIGIBLE)).toBeNull();
  });

  test('A 的慢回應不得蓋掉 B 的資料', async () => {
    let resolveA: ((v: unknown) => void) | undefined;
    jest.spyOn(apiClient, 'mySeasonal')
      .mockImplementationOnce(() => new Promise((r) => { resolveA = r as (v: unknown) => void; }))
      .mockResolvedValue({ items: [campaign({ status: 'locked' })], notes: [] } as never);
    await render(<SeasonalFootprints />, { wrapper: Wrapper });
    await act(async () => { asWallet('wallet-b'); });
    await waitFor(() => expect(screen.getByTestId('seasonal-genesis-stride-2027-status-locked')).toBeTruthy());
    await act(async () => { resolveA!({ items: [campaign({ status: 'eligible' })], notes: [] }); });
    expect(screen.queryByTestId(ELIGIBLE)).toBeNull();
  });
});
