import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Share } from 'react-native';
import { GuardianMilestone } from '@/components/GuardianMilestone';
import { guardianProgress } from '@/config/guardianMilestones';
import { ThemeProvider } from '@/theme';
import { useLocaleStore } from '@/i18n';
const mockCount = jest.fn();
jest.mock('@/services/chain/GuardianCountService', () => ({ fetchGuardianCount: (level: number) => mockCount(level) }));

beforeEach(() => {
  jest.clearAllMocks();
  useLocaleStore.setState({ setting: 'en', locale: 'en' });
});
test('strictly exceeds reference; invalid or unavailable counts never unlock', () => {
  expect(guardianProgress(5, 130).status).toBe('building');
  expect(guardianProgress(5, 130).remaining).toBe(1);
  expect(guardianProgress(5, 131).status).toBe('unlocked');
  expect(guardianProgress(2, 50000).status).toBe('building');
  expect(guardianProgress(2, 50001).status).toBe('unlocked');
  expect(guardianProgress(4, 5575).status).toBe('unlocked');
  for (const n of [null, NaN, -1, 1.5, Infinity]) expect(guardianProgress(5, n).status).toBe('unknown');
  expect(guardianProgress(3, 99999999).status).toBe('unavailable');
  expect(guardianProgress(1, 99999999).status).toBe('unavailable');
});
test('live card requires successful count, handles failure and opens a closable habitat after threshold', async () => {
  mockCount.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ total: 131, checkedAt: '2026-09-19T01:00:00Z' });
  await render(<ThemeProvider><GuardianMilestone level={5} /></ThemeProvider>);
  expect(screen.queryByTestId('guardian-enter')).toBeNull();
  await fireEvent.press(screen.getByTestId('guardian-check'));
  await waitFor(() => expect(screen.getByText(/The count is unavailable/)).toBeTruthy());
  expect(screen.queryByTestId('guardian-enter')).toBeNull();
  await fireEvent.press(screen.getByTestId('guardian-check'));
  await waitFor(() => expect(screen.getByTestId('guardian-enter')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('guardian-enter'));
  expect(screen.getByTestId('guardian-scene')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('guardian-scene-close'));
  expect(screen.queryByTestId('guardian-scene')).toBeNull();
});
test('Demo never fetches live claims and shares only a generic invitation, not simulated counts', async () => {
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
  await render(<ThemeProvider><GuardianMilestone level={5} preview /></ThemeProvider>);
  expect(mockCount).not.toHaveBeenCalled();
  expect(screen.getByText(/DEMO · simulated/)).toBeTruthy();
  await fireEvent.press(screen.getByTestId('guardian-share'));
  expect(share).toHaveBeenCalledWith({ message: expect.stringContaining('Amur Leopard') });
  expect(share.mock.calls[0][0].message).not.toContain('131');
  share.mockRestore();
});
test('auto check after NFT reveal still does not force a modal over the reward', async () => {
  mockCount.mockResolvedValue({ total: 131, checkedAt: '2026-09-19T01:00:00Z' });
  await render(<ThemeProvider><GuardianMilestone level={5} autoCheck /></ThemeProvider>);
  await waitFor(() => expect(screen.getByTestId('guardian-enter')).toBeTruthy());
  expect(screen.queryByTestId('guardian-scene')).toBeNull();
});
