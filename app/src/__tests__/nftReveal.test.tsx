import { fireEvent, render, screen } from '@testing-library/react-native';
import { NftReveal } from '@/components/NftReveal';
import { useNftRevealStore } from '@/state/nftRevealStore';
import { useLevelRevealStore } from '@/state/levelRevealStore';
import { useLocaleStore } from '@/i18n';
import { ThemeProvider } from '@/theme';
jest.mock('expo-haptics', () => ({ notificationAsync: jest.fn().mockResolvedValue(undefined), NotificationFeedbackType: { Success: 'success' } }));
beforeEach(() => {
  useNftRevealStore.setState({ queue: [] });
  useLevelRevealStore.setState({ pending: null });
});
test('queues distinct rewards, dismisses in order, and does not duplicate a queued asset', async () => {
  const { enqueue } = useNftRevealStore.getState();
  enqueue({ id: 'one', title: 'First finish' });
  enqueue({ id: 'one', title: 'First finish' });
  enqueue({ id: 'two', title: 'Personal best' });
  await render(<ThemeProvider><NftReveal /></ThemeProvider>);
  expect(screen.getByText('First finish')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('nft-reveal-ok'));
  expect(screen.getByText('Personal best')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('nft-reveal-ok'));
  expect(screen.queryByTestId('nft-reveal')).toBeNull();
});
test('waits for the level ceremony before opening the NFT modal', async () => {
  useLevelRevealStore.setState({ pending: { from: 1, to: 2 } });
  useNftRevealStore.getState().enqueue({ id: 'one' });
  await render(<ThemeProvider><NftReveal /></ThemeProvider>);
  expect(screen.queryByTestId('nft-reveal')).toBeNull();
  expect(useNftRevealStore.getState().queue).toHaveLength(1);
});


test('first distance NFT displays its exact milestone without guessing from its title', async () => {
  useNftRevealStore.getState().enqueue({ id: 'half', title: 'First half marathon', milestone: 'first_half' });
  await render(<ThemeProvider><NftReveal /></ThemeProvider>);
  expect(screen.getByTestId('reward-stage-milestone')).toBeTruthy();
  expect(screen.getByText('21.0975')).toBeTruthy();
  expect(screen.getByText('km')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('nft-reveal-ok'));
  expect(screen.queryByTestId('nft-reveal')).toBeNull();
});

/**
 * PG-SEASON-04 的收尾：節日章翻面後要看到**這一屆的徽章**。
 * 在此之前 `SeasonalClaim` 只把 metadata 的 name 丟進佇列，揭曉畫的是通用金色獎章，
 * 而那個 name 整個系列共用（"NeonShift Seasonal Footprints"），看不出是哪一屆。
 */
test('seasonal reward reveals that edition badge and names the edition, not the shared series name', async () => {
  useLocaleStore.setState({ setting: 'en', locale: 'en' });
  useNftRevealStore.getState().enqueue({
    id: 'asset-moon',
    title: 'NeonShift Seasonal Footprints (Device)',
    seasonal: { themeId: 'moonlit_steps', year: 2026 },
  });
  await render(<ThemeProvider><NftReveal /></ThemeProvider>);
  // 翻面的舞台仍是共用的 2.2 秒 NFT 翻卡（不另發明一套節奏）
  expect(screen.getByTestId('reward-stage-nft')).toBeTruthy();
  // 正面是程序繪製的節日徽章本體，不是通用獎章
  expect(screen.getByTestId('nft-reveal-seasonal')).toBeTruthy();
  expect(screen.getByText('Moonlit Steps · 2026')).toBeTruthy();
  expect(screen.getByText('Seasonal Footprints collected')).toBeTruthy();
  // 鏈上共用的系列名不該出現在揭曉畫面上
  expect(screen.queryByText(/NeonShift Seasonal Footprints/)).toBeNull();
});

test('seasonal reward with an unknown theme shows the theme id, never a raw i18n key', async () => {
  useLocaleStore.setState({ setting: 'en', locale: 'en' });
  useNftRevealStore.getState().enqueue({ id: 'asset-x', seasonal: { themeId: 'not_a_theme', year: 2031 } });
  await render(<ThemeProvider><NftReveal /></ThemeProvider>);
  expect(screen.getByText('not_a_theme · 2031')).toBeTruthy();
  expect(screen.queryByText(/season\.name\./)).toBeNull();
});

test('a non-seasonal reward keeps the generic medal and copy', async () => {
  useLocaleStore.setState({ setting: 'en', locale: 'en' });
  useNftRevealStore.getState().enqueue({ id: 'plain', title: 'Personal best' });
  await render(<ThemeProvider><NftReveal /></ThemeProvider>);
  expect(screen.queryByTestId('nft-reveal-seasonal')).toBeNull();
  expect(screen.getByText('Achievement immortalized')).toBeTruthy();
});
