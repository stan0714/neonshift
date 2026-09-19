/** PG-G-03：藝廊列表（排名／You／搜尋／Load more）與玩家頁（等級／XP／streak／收藏；不含健康數值）。 */
import { NavigationContainer } from '@react-navigation/native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';

import { AchievementDetailScreen } from '@/screens/gallery/AchievementDetailScreen';
import { GalleryPlayerScreen, GalleryScreen } from '@/screens/gallery/GalleryScreens';
import { useWalletStore } from '@/state/walletStore';
import { ThemeProvider } from '@/theme';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useNavigation: () => ({ navigate: mockNavigate }), useRoute: () => ({ params: { wallet: 'BBBB2222BBBB2222BBBB2222BBBB2222BBBB2222BBBB', asset: 'AssetC' } }) }));
jest.mock('@/services/api/ApiClient', () => ({ ...jest.requireActual('@/services/api/ApiClient'), apiClient: { galleryPlayers: jest.fn(), galleryPlayer: jest.fn(), gallerySearch: jest.fn(), galleryAchievement: jest.fn() } }));
const api = jest.requireMock('@/services/api/ApiClient').apiClient as Record<'galleryPlayers' | 'galleryPlayer' | 'gallerySearch' | 'galleryAchievement', jest.Mock>;
const { ApiError } = jest.requireActual('@/services/api/ApiClient');

const ME = 'AAAA1111AAAA1111AAAA1111AAAA1111AAAA1111AAAA';
const B = 'BBBB2222BBBB2222BBBB2222BBBB2222BBBB2222BBBB';
const player = (wallet: string, rank: number, over: Record<string, unknown> = {}) => ({ rank, wallet, shoe_level: 2, core_level: 2, xp: '900', streak_days: 3, max_streak_days: 7, last_task_date: 20_710, collectible_count: 1, updated_at: '2026-09-14T00:00:00Z', ...over });

const Wrapper = ({ children }: PropsWithChildren) => (
  <ThemeProvider>
    <NavigationContainer>{children}</NavigationContainer>
  </ThemeProvider>
);

beforeEach(() => {
  jest.clearAllMocks();
  useWalletStore.setState({ status: 'connected', session: { address: ME, publicKey: {} as never, walletUriBase: '', label: 'Phantom' }, error: null } as never);
});

describe('GalleryScreen', () => {
  test('排行、本人標 You 與名次、點列進玩家頁、Load more、搜尋', async () => {
    api.galleryPlayers.mockResolvedValueOnce({ generated_at: '2026-09-14T00:00:00Z', total: 3, next_cursor: '2', players: [player(B, 1, { shoe_level: 3, xp: '1600' }), player(ME, 2)], you: { rank: 2 } });
    api.galleryPlayers.mockResolvedValueOnce({ generated_at: '2026-09-14T00:00:00Z', total: 3, next_cursor: null, players: [player('CCCC3333CCCC3333CCCC3333CCCC3333CCCC3333CCCC', 3)], you: { rank: 2 } });
    await render(<GalleryScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText('You')).toBeTruthy());
    expect(screen.getByText('You are #2')).toBeTruthy();
    expect(screen.getByText('BBBB…BBBB')).toBeTruthy();
    expect(screen.getByText('LV. 3')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('gallery-more'));
    await waitFor(() => expect(screen.getByText('CCCC…CCCC')).toBeTruthy());
    expect(screen.queryByTestId('gallery-more')).toBeNull();
    await act(async () => {}); // 讓 load() 的 finally（setLoading）在 act 內完成，避免影響下一個 render
  });

  test('PG-V-04：切換歷史成就榜 → 以 board=lifetime 重新載入、Chip 顯示歷史最高', async () => {
    api.galleryPlayers.mockResolvedValueOnce({ generated_at: '2026-09-14T00:00:00Z', board: 'active', total: 1, next_cursor: null, players: [player(B, 1, { shoe_level: 2, highest_level: 5 })], you: null });
    await render(<GalleryScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId(`gallery-row-${B}`)).toBeTruthy());
    expect(api.galleryPlayers).toHaveBeenLastCalledWith(null, 50, 'active');
    expect(screen.getByText('LV. 2')).toBeTruthy();
    api.galleryPlayers.mockResolvedValueOnce({ generated_at: '2026-09-14T00:00:00Z', board: 'lifetime', total: 1, next_cursor: null, players: [player(B, 1, { shoe_level: 2, highest_level: 5 })], you: null });
    await fireEvent.press(screen.getByTestId('gallery-board-lifetime'));
    await waitFor(() => expect(api.galleryPlayers).toHaveBeenLastCalledWith(null, 50, 'lifetime'));
    await waitFor(() => expect(screen.getByText('LV. 5')).toBeTruthy());
    await act(async () => {});
  });

  test('搜尋地址前綴', async () => {
    api.galleryPlayers.mockResolvedValue({ generated_at: '2026-09-14T00:00:00Z', total: 1, next_cursor: null, players: [player(B, 1)], you: null });
    api.gallerySearch.mockResolvedValue({ players: [player(B, 1)] });
    await render(<GalleryScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText(/1 players/)).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('gallery-search'), 'BB');
    await waitFor(() => expect(screen.getByText('1 match')).toBeTruthy());
    expect(api.gallerySearch).toHaveBeenCalledWith('BB');
  });

  test('需登入狀態', async () => {
    api.galleryPlayers.mockRejectedValue(new ApiError(401, 'NO_SESSION', 'Sign in required'));
    await render(<GalleryScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('gallery-signin')).toBeTruthy());
  });
});

describe('GalleryPlayerScreen', () => {
  test('等級／XP／streak／最近打卡與收藏網格；不顯示健康數值', async () => {
    api.galleryPlayer.mockResolvedValue({ player: player(B, 1, { shoe_level: 3, xp: '1600' }), is_you: false, collectibles: [{ kind: 1, asset: 'A', signature: 's', claimed_at: '2026-09-10T00:00:00Z' }, { kind: 102, asset: 'B', signature: 's2', claimed_at: '2026-09-12T00:00:00Z' }] });
    await render(<GalleryPlayerScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('gallery-player-hero')).toBeTruthy());
    expect(screen.getByText('Lv.3 · Hawksbill')).toBeTruthy();
    expect(screen.getByText('1,600')).toBeTruthy();
    expect(screen.getByText('3d')).toBeTruthy();
    expect(screen.getByText('7d')).toBeTruthy();
    expect(screen.getByText(/Last clock-in 2026-09-14 UTC/)).toBeTruthy();
    expect(screen.getByTestId('gallery-collectible-1')).toBeTruthy();
    expect(screen.getByText('7-Day Streak')).toBeTruthy();
    expect(screen.queryByText(/steps/i)).toBeNull();
  });

  test('PG-R-09：PB 成就卡（Current／Historical／Invalidated、公開值／未公開）、篩選 Personal best 隱藏跑鞋、本人可見 PB 櫃連結與退出提示；點卡進 NFT 詳情', async () => {
    const ach = (o: Record<string, unknown>) => ({ achievement_id: 'a1', asset: 'AssetA', series: 'pb_speed', category: 'fastest_5k', verification_class: 'device', environment: 'outdoor', record: 'current', public: true, value: '25:00', achieved_on: '2026-09-05', image: '', name: 'x', minted_at: '2026-09-06T00:00:00Z', minted_signature: 's', metadata_uri: '/v1/nft/achievements/a1.json', ...o });
    api.galleryPlayer.mockResolvedValue({ player: player(ME, 1), is_you: true, hidden: true, collectibles: [{ kind: 1, asset: 'A', signature: 's', claimed_at: '2026-09-10T00:00:00Z' }], achievements: [ach({}), ach({ achievement_id: 'a2', asset: 'AssetB', series: 'pb_distance', category: 'longest_run', verification_class: 'organizer', record: 'historical', public: false, value: null }), ach({ achievement_id: 'a3', asset: 'AssetC', record: 'invalidated' })] });
    await render(<GalleryPlayerScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('gallery-pb-a1')).toBeTruthy());
    expect(screen.getByTestId('gallery-hidden-note')).toBeTruthy();
    expect(screen.getByTestId('gallery-pb-cabinet')).toBeTruthy();
    expect(screen.getAllByText('25:00')).toHaveLength(2); // a1 與 a3（同值）
    expect(screen.getByText('Value kept private')).toBeTruthy();
    expect(screen.getByText('Current best')).toBeTruthy();
    expect(screen.getByText('Historical best')).toBeTruthy();
    expect(screen.getByText('Invalidated')).toBeTruthy();
    expect(screen.getByText('Distance PB · Official result')).toBeTruthy();
    expect(screen.getByTestId('gallery-collectible-1')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('gallery-filter-pb'));
    expect(screen.queryByTestId('gallery-collectible-1')).toBeNull();
    expect(screen.getByTestId('gallery-pb-a1')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('gallery-filter-shoes'));
    expect(screen.queryByTestId('gallery-pb-a1')).toBeNull();
    expect(screen.getByTestId('gallery-collectible-1')).toBeTruthy();
    await act(async () => {});
  });

  test('PG-M-03：首次里程碑卡與 PB 分開列（Genesis Distance／First Finish、未公開文案）；Firsts 篩選只留首次；無首次時 Firsts 顯示空狀態', async () => {
    const ach = (o: Record<string, unknown>) => ({ achievement_id: 'a1', asset: 'AssetA', series: 'pb_speed', category: 'fastest_5k', verification_class: 'device', environment: 'outdoor', record: 'current', public: true, value: '25:00', achieved_on: '2026-09-05', image: '', name: 'x', minted_at: '2026-09-06T00:00:00Z', minted_signature: 's', metadata_uri: '/v1/nft/achievements/a1.json', ...o });
    api.galleryPlayer.mockResolvedValue({ player: player(B, 1), is_you: false, collectibles: [], achievements: [ach({}), ach({ achievement_id: 'm1', asset: 'AssetM', kind: 'milestone', series: 'genesis_distance', category: 'first_10k', public: false, value: null }), ach({ achievement_id: 'm2', asset: 'AssetF', kind: 'milestone', series: 'first_finish', category: 'first_finish', verification_class: 'organizer', public: true, value: '42.195 km' })] });
    await render(<GalleryPlayerScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('gallery-first-m1')).toBeTruthy());
    expect(screen.getByTestId('gallery-first-m1').props.accessibilityLabel).toBe('First 10K · Current best');
    expect(screen.getByText('Genesis Distance · Device recorded')).toBeTruthy();
    expect(screen.getByText('First Finish · Official result')).toBeTruthy();
    expect(screen.getByText('Distance and date private')).toBeTruthy();
    expect(screen.getByTestId('gallery-pb-a1')).toBeTruthy();
    expect(screen.queryByTestId('gallery-pb-m1')).toBeNull(); // 不混入 PB 區
    await fireEvent.press(screen.getByTestId('gallery-filter-first'));
    expect(screen.queryByTestId('gallery-pb-a1')).toBeNull();
    expect(screen.getByTestId('gallery-first-m2')).toBeTruthy();
    api.galleryPlayer.mockResolvedValue({ player: player(B, 1), is_you: false, collectibles: [], achievements: [ach({})] });
    await render(<GalleryPlayerScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('gallery-pb-a1')).toBeTruthy());
    expect(screen.queryByTestId('gallery-no-first')).toBeNull(); // All 且無首次 → 不顯示區塊
    await fireEvent.press(screen.getByTestId('gallery-filter-first'));
    expect(screen.getByTestId('gallery-no-first')).toBeTruthy();
    await act(async () => {});
  });

  test('PG-M-04：活動紀念章卡（活動名、活動日期公開、時間未公開文案）；Events 篩選只留活動章；無活動章顯示空狀態', async () => {
    const ach = (o: Record<string, unknown>) => ({ achievement_id: 'a1', asset: 'AssetA', series: 'pb_speed', category: 'fastest_5k', verification_class: 'device', environment: 'outdoor', record: 'current', public: true, value: '25:00', achieved_on: '2026-09-05', image: '', name: 'x', minted_at: '2026-09-06T00:00:00Z', minted_signature: 's', metadata_uri: '/v1/nft/achievements/a1.json', ...o });
    api.galleryPlayer.mockResolvedValue({ player: player(B, 1), is_you: false, collectibles: [], achievements: [ach({}), ach({ achievement_id: 'e1', asset: 'AssetE', kind: 'event', series: 'event_finish', category: 'event_finish', verification_class: 'organizer', public: false, value: null, achieved_on: '2026-10-03', event: { title: 'River 10K', event_id: 'ev1' } })] });
    await render(<GalleryPlayerScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('gallery-event-e1')).toBeTruthy());
    expect(screen.getByTestId('gallery-event-e1').props.accessibilityLabel).toBe('River 10K · Current best');
    expect(screen.getByText('Event finisher · Official result')).toBeTruthy();
    expect(screen.getByText('2026-10-03')).toBeTruthy(); // 活動日期公開
    await fireEvent.press(screen.getByTestId('gallery-filter-events'));
    expect(screen.queryByTestId('gallery-pb-a1')).toBeNull();
    expect(screen.getByTestId('gallery-event-e1')).toBeTruthy();
    api.galleryPlayer.mockResolvedValue({ player: player(B, 1), is_you: false, collectibles: [], achievements: [ach({})] });
    await render(<GalleryPlayerScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('gallery-pb-a1')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('gallery-filter-events'));
    expect(screen.getByTestId('gallery-events-empty')).toBeTruthy();
    await act(async () => {});
  });

  test('NFT 詳情：系列、原達成者、狀態、鑄造日期、network、Explorer；invalidated 說明', async () => {
    api.galleryAchievement.mockResolvedValue({ achievement_id: 'a3', asset: 'AssetC', series: 'pb_speed', category: 'fastest_10k', verification_class: 'organizer', environment: 'outdoor', record: 'invalidated', public: false, value: null, achieved_on: null, image: '', name: 'x', minted_at: '2026-09-06T00:00:00Z', minted_signature: 's', metadata_uri: '', original_achiever: B, metadata: {}, network: 'devnet', explorer_url: 'https://explorer.solana.com/address/AssetC?cluster=devnet' });
    await render(<AchievementDetailScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('achievement-card')).toBeTruthy());
    expect(screen.getByTestId('achievement-invalidated')).toBeTruthy();
    expect(screen.getByText('Speed PB · Fastest 10 km')).toBeTruthy();
    expect(screen.getByText('Official result')).toBeTruthy();
    expect(screen.getByText('2026-09-06')).toBeTruthy();
    expect(screen.getByText('devnet')).toBeTruthy();
    expect(screen.getByTestId('achievement-explorer')).toBeTruthy();
    await act(async () => {});
  });

  test('本人標 You；無收藏顯示距下一階；404 顯示 No profile yet', async () => {
    api.galleryPlayer.mockResolvedValueOnce({ player: player(B, 5, { xp: '500' }), is_you: true, collectibles: [] });
    await render(<GalleryPlayerScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText('You')).toBeTruthy());
    expect(screen.getByText(/1,000 XP to Lv.3/)).toBeTruthy();
    api.galleryPlayer.mockRejectedValueOnce(new ApiError(404, 'NOT_FOUND', 'player not found'));
    await render(<GalleryPlayerScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('gallery-player-missing')).toBeTruthy());
  });
});

describe('GalleryScreen → GalleryPlayer', () => {
  test('點列進玩家頁', async () => {
    api.galleryPlayers.mockResolvedValue({ generated_at: '2026-09-14T00:00:00Z', total: 1, next_cursor: null, players: [player(B, 1)], you: null });
    await render(<GalleryScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId(`gallery-row-${B}`)).toBeTruthy());
    await fireEvent.press(screen.getByTestId(`gallery-row-${B}`));
    expect(mockNavigate).toHaveBeenCalledWith('GalleryPlayer', { wallet: B });
  });
});

jest.mock('@/services/chain/CollectibleService', () => ({ collectibleService: { fetchEdition: jest.fn(async () => ({ kind: 1, edition: 3, total: 9 })), fetchClaimed: jest.fn(async () => new Set()), claim: jest.fn() } }));

describe('2026-09-19 review：藝廊競態、舊資料清除、入口與空狀態、收藏詳情', () => {
  const deferred = <T,>() => { let resolve!: (v: T) => void; let reject!: (e: unknown) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };

  test('搜尋去抖＋序號：慢的舊回應不會蓋掉新結果；搜尋失敗顯示錯誤而非「找不到」', async () => {
    api.galleryPlayers.mockResolvedValue({ generated_at: '2026-09-14T00:00:00Z', total: 1, next_cursor: null, players: [player(B, 1)], you: null });
    const slow = deferred<{ players: unknown[] }>();
    api.gallerySearch.mockImplementationOnce(() => slow.promise).mockResolvedValueOnce({ players: [player('CCCC3333CCCC3333CCCC3333CCCC3333CCCC3333CCCC', 9)] });
    await render(<GalleryScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId(`gallery-row-${B}`)).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('gallery-search'), 'BB');
    await waitFor(() => expect(api.gallerySearch).toHaveBeenCalledWith('BB'));
    await fireEvent.changeText(screen.getByTestId('gallery-search'), 'CCC');
    await waitFor(() => expect(api.gallerySearch).toHaveBeenCalledWith('CCC'));
    await waitFor(() => expect(screen.getByText('CCCC…CCCC')).toBeTruthy());
    await act(async () => { slow.resolve({ players: [player(B, 1)] }); });
    expect(screen.getByText('CCCC…CCCC')).toBeTruthy(); // 舊的 BB 結果被忽略
    expect(screen.queryByText('BBBB…BBBB')).toBeNull();
    // 去抖：快速輸入三次只發一次（前面兩次已計，這裡再確認新輸入只多一次）
    api.gallerySearch.mockRejectedValueOnce(new ApiError(503, 'NETWORK_ERROR', 'offline'));
    await fireEvent.changeText(screen.getByTestId('gallery-search'), 'DD');
    await fireEvent.changeText(screen.getByTestId('gallery-search'), 'DDD');
    await fireEvent.changeText(screen.getByTestId('gallery-search'), 'DDDD');
    await waitFor(() => expect(screen.getByTestId('gallery-search-error')).toBeTruthy());
    expect(api.gallerySearch).toHaveBeenCalledTimes(3);
    expect(screen.queryByTestId('gallery-empty')).toBeNull();
    await act(async () => {});
  });

  test('切榜序號：舊榜慢回應不覆蓋新榜；切榜先清舊資料', async () => {
    const slowActive = deferred<unknown>();
    api.galleryPlayers.mockImplementationOnce(() => slowActive.promise).mockResolvedValueOnce({ generated_at: '2026-09-14T00:00:00Z', board: 'lifetime', total: 1, next_cursor: null, players: [player(B, 1, { shoe_level: 2, highest_level: 5 })], you: null });
    await render(<GalleryScreen />, { wrapper: Wrapper });
    await fireEvent.press(screen.getByTestId('gallery-board-lifetime'));
    await waitFor(() => expect(screen.getByText('LV. 5')).toBeTruthy());
    await act(async () => { slowActive.resolve({ generated_at: '2026-09-14T00:00:00Z', board: 'active', total: 1, next_cursor: null, players: [player('CCCC3333CCCC3333CCCC3333CCCC3333CCCC3333CCCC', 1)], you: null }); });
    expect(screen.queryByText('CCCC…CCCC')).toBeNull();
    expect(screen.getByText('LV. 5')).toBeTruthy();
  });

  test('頂部「我的收藏」入口 → 本人玩家頁', async () => {
    api.galleryPlayers.mockResolvedValue({ generated_at: '2026-09-14T00:00:00Z', total: 1, next_cursor: null, players: [player(ME, 1)], you: { rank: 1 } });
    await render(<GalleryScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText('Active rank #1 · open your collection')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('gallery-mine'));
    expect(mockNavigate).toHaveBeenCalledWith('GalleryPlayer', { wallet: ME });
  });

  test('玩家頁：重新整理收到 NOT_FOUND 時清除舊收藏；本人空收藏給下一步；跑鞋收藏可點開詳情', async () => {
    api.galleryPlayer.mockResolvedValueOnce({ player: player(B, 1, { shoe_level: 2, xp: '900' }), is_you: true, collectibles: [{ kind: 2, asset: 'A2', signature: 's', claimed_at: '2026-09-10T00:00:00Z' }] });
    await render(<GalleryPlayerScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('gallery-collectible-2')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('gallery-collectible-2'));
    await waitFor(() => expect(screen.getByTestId('gallery-collectible-detail')).toBeTruthy());
    expect(screen.getByText('Claimed after reaching Lv.2')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('collector-plate-no').props.children).toBe('No. 3'));
    expect(screen.getByText(/in-app look/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('gallery-collectible-detail-done'));
    // 對方退出藝廊 → 404：舊收藏不留
    api.galleryPlayer.mockRejectedValueOnce(new ApiError(404, 'NOT_FOUND', 'player not found'));
    await act(async () => { useWalletStore.setState({ session: { address: 'DDDD4444DDDD4444DDDD4444DDDD4444DDDD4444DDDD', publicKey: {} as never, walletUriBase: '', label: 'Phantom' } } as never); });
    await waitFor(() => expect(screen.getByTestId('gallery-player-missing')).toBeTruthy());
    expect(screen.queryByTestId('gallery-collectible-2')).toBeNull();
    expect(screen.queryByTestId('gallery-player-hero')).toBeNull();
    // 本人空收藏：三個下一步
    api.galleryPlayer.mockResolvedValueOnce({ player: player(ME, 5, { xp: '500' }), is_you: true, collectibles: [] });
    await act(async () => { useWalletStore.setState({ session: { address: ME, publicKey: {} as never, walletUriBase: '', label: 'Phantom' } } as never); });
    await waitFor(() => expect(screen.getByTestId('gallery-no-collectibles')).toBeTruthy());
    expect(screen.getByText(/maintenance rules/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('gallery-next-workout'));
    expect(mockNavigate).toHaveBeenCalledWith('WorkoutStart');
  });
});
