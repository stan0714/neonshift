/** PG-G-03：藝廊列表（排名／You／搜尋／Load more）與玩家頁（等級／XP／streak／收藏；不含健康數值）。 */
import { NavigationContainer } from '@react-navigation/native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';

import { GalleryPlayerScreen, GalleryScreen } from '@/screens/gallery/GalleryScreens';
import { useWalletStore } from '@/state/walletStore';
import { ThemeProvider } from '@/theme';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useNavigation: () => ({ navigate: mockNavigate }), useRoute: () => ({ params: { wallet: 'BBBB2222BBBB2222BBBB2222BBBB2222BBBB2222BBBB' } }) }));
jest.mock('@/services/api/ApiClient', () => ({ ...jest.requireActual('@/services/api/ApiClient'), apiClient: { galleryPlayers: jest.fn(), galleryPlayer: jest.fn(), gallerySearch: jest.fn() } }));
const api = jest.requireMock('@/services/api/ApiClient').apiClient as Record<'galleryPlayers' | 'galleryPlayer' | 'gallerySearch', jest.Mock>;
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
    fireEvent.press(screen.getByTestId('gallery-more'));
    await waitFor(() => expect(screen.getByText('CCCC…CCCC')).toBeTruthy());
    expect(screen.queryByTestId('gallery-more')).toBeNull();
    await act(async () => {}); // 讓 load() 的 finally（setLoading）在 act 內完成，避免影響下一個 render
  });

  test('搜尋地址前綴', async () => {
    api.galleryPlayers.mockResolvedValue({ generated_at: '2026-09-14T00:00:00Z', total: 1, next_cursor: null, players: [player(B, 1)], you: null });
    api.gallerySearch.mockResolvedValue({ players: [player(B, 1)] });
    await render(<GalleryScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText(/1 players/)).toBeTruthy());
    fireEvent.changeText(screen.getByTestId('gallery-search'), 'BB');
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
    expect(screen.getByText('Lv.3 · Phase')).toBeTruthy();
    expect(screen.getByText('1,600')).toBeTruthy();
    expect(screen.getByText('3d')).toBeTruthy();
    expect(screen.getByText('7d')).toBeTruthy();
    expect(screen.getByText(/Last clock-in 2026-09-14 UTC/)).toBeTruthy();
    expect(screen.getByTestId('gallery-collectible-1')).toBeTruthy();
    expect(screen.getByText('7-Day Streak')).toBeTruthy();
    expect(screen.queryByText(/steps/i)).toBeNull();
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
    fireEvent.press(screen.getByTestId(`gallery-row-${B}`));
    expect(mockNavigate).toHaveBeenCalledWith('GalleryPlayer', { wallet: B });
  });
});
