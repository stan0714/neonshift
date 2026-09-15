/** PG-A-17：升級 reveal 只在等級高於上次看到時播放一次；第一次觀察不播；確認後記住。 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import type { PropsWithChildren } from 'react';

import { EvolutionReveal } from '@/components/EvolutionReveal';
import { useDashboardStore } from '@/state/dashboardStore';
import { useLevelRevealStore } from '@/state/levelRevealStore';
import { ThemeProvider } from '@/theme';

jest.mock('expo-haptics', () => ({ notificationAsync: jest.fn(), NotificationFeedbackType: { Success: 'success', Warning: 'warning' } }));
const Wrapper = ({ children }: PropsWithChildren) => <ThemeProvider>{children}</ThemeProvider>;
const profile = (shoeLevel: number) => ({ shoeLevel, coreLevel: shoeLevel, xp: BigInt(0), streakDays: 0, maxStreakDays: 0 });

beforeEach(async () => {
  await SecureStore.deleteItemAsync('neonshift.shoe.lastSeenLevel.v1');
  useLevelRevealStore.setState({ lastSeen: null, loaded: false, pending: null, lastTxSignature: null });
  useDashboardStore.setState({ profile: null } as never);
});

describe('levelRevealStore', () => {
  test('降等確認後可再次升等，同等級同步不重播', async () => {
    useLevelRevealStore.setState({ lastSeen: 4, loaded: true });
    await useLevelRevealStore.getState().observe(2);
    expect(useLevelRevealStore.getState().pending).toEqual({ from: 4, to: 2 });
    await useLevelRevealStore.getState().acknowledge();
    await useLevelRevealStore.getState().observe(2);
    expect(useLevelRevealStore.getState().pending).toBeNull();
    await useLevelRevealStore.getState().observe(3);
    expect(useLevelRevealStore.getState().pending).toEqual({ from: 2, to: 3 });
  });
  test('第一次觀察只記錄；升級才 pending；acknowledge 後持久化', async () => {
    const s = useLevelRevealStore.getState();
    await s.observe(2);
    expect(useLevelRevealStore.getState().pending).toBeNull();
    expect(await SecureStore.getItemAsync('neonshift.shoe.lastSeenLevel.v1')).toBe('2');
    await s.observe(2);
    expect(useLevelRevealStore.getState().pending).toBeNull();
    await s.observe(3);
    expect(useLevelRevealStore.getState().pending).toEqual({ from: 2, to: 3 });
    await useLevelRevealStore.getState().acknowledge();
    expect(useLevelRevealStore.getState().pending).toBeNull();
    expect(await SecureStore.getItemAsync('neonshift.shoe.lastSeenLevel.v1')).toBe('3');
    // 重啟後 lastSeen 從儲存讀回
    useLevelRevealStore.setState({ lastSeen: null, loaded: false });
    await useLevelRevealStore.getState().observe(3);
    expect(useLevelRevealStore.getState().pending).toBeNull();
  });
});

describe('EvolutionReveal', () => {
  test('profile 等級提升時顯示一次 reveal，含新等級名稱與交易連結；Nice 關閉', async () => {
    useLevelRevealStore.setState({ lastSeen: 1, loaded: true, lastTxSignature: 'sig123' });
    useDashboardStore.setState({ profile: profile(1) } as never);
    await render(<EvolutionReveal />, { wrapper: Wrapper });
    expect(screen.queryByTestId('evolution-reveal')).toBeNull();
    useDashboardStore.setState({ profile: profile(2) } as never);
    await waitFor(() => expect(screen.getByTestId('evolution-reveal')).toBeTruthy());
    expect(screen.getByText('Lv.2 · Pulse')).toBeTruthy();
    expect(screen.getByTestId('reveal-tx')).toBeTruthy();
    const haptics = jest.requireMock('expo-haptics');
    expect(haptics.notificationAsync).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId('reveal-ok'));
    await waitFor(() => expect(screen.queryByTestId('evolution-reveal')).toBeNull());
    expect(useLevelRevealStore.getState().lastSeen).toBe(2);
  });
});
