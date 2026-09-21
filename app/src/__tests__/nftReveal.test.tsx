import { fireEvent, render, screen } from '@testing-library/react-native';
import { NftReveal } from '@/components/NftReveal';
import { useNftRevealStore } from '@/state/nftRevealStore';
import { useLevelRevealStore } from '@/state/levelRevealStore';
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
