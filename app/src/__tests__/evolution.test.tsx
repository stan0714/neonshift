/** PG-A-17：升級 reveal 只在等級高於上次看到時播放一次；第一次觀察不播；確認後記住。 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import type { PropsWithChildren } from 'react';

import { EvolutionReveal, RevealCeremony } from '@/components/EvolutionReveal';
import { useDashboardStore } from '@/state/dashboardStore';
import { useLevelRevealStore } from '@/state/levelRevealStore';
import { ThemeProvider } from '@/theme';

jest.mock('expo-haptics', () => ({ notificationAsync: jest.fn(), impactAsync: jest.fn(), ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' }, NotificationFeedbackType: { Success: 'success', Warning: 'warning' } }));
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
    expect(screen.getByText('Lv.2 · Asian Elephant')).toBeTruthy();
    expect(screen.getByTestId('reward-stage-box')).toBeTruthy(); // Lv.2+ 升階：成長盲盒先拆開
    expect(screen.getByTestId('wild-silhouette-elephant', { includeHiddenElements: true })).toBeTruthy(); // 物種背影在鞋子後方
    expect(screen.getByTestId('collector-plate-no').props.children).toBe('No. ——'); // 尚未領取 NFT → 未編號
    expect(screen.getByText(/once you claim the NFT in Gear/)).toBeTruthy();
    expect(screen.queryByTestId('reveal-preview')).toBeNull();
    expect(screen.getByTestId('reveal-tx')).toBeTruthy();
    const haptics = jest.requireMock('expo-haptics');
    expect(haptics.notificationAsync).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId('reveal-ok'));
    await waitFor(() => expect(screen.queryByTestId('evolution-reveal')).toBeNull());
    expect(useLevelRevealStore.getState().lastSeen).toBe(2);
  });
});

describe('RevealCeremony 示意模式', () => {
  test('Demo 圖鑑「試拆盲盒」：DEMO 標籤、不寫入已看過等級；Reduce Motion 下沒有盒子層', async () => {
    const { AccessibilityInfo } = jest.requireActual('react-native');
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    useLevelRevealStore.setState({ lastSeen: 1, loaded: true });
    const onClose = jest.fn();
    await render(<RevealCeremony from={4} to={5} preview onClose={onClose} />, { wrapper: Wrapper });
    expect(screen.getByTestId('reveal-preview')).toBeTruthy();
    expect(screen.getByText('Lv.5 · Amur Leopard')).toBeTruthy();
    expect(screen.getByTestId('wild-silhouette-leopard', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('collector-plate-no').props.children).toBe('No. 0001'); // 示意編號
    expect(screen.getByText(/Sample number/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId('reward-stage-box')).toBeNull());
    expect(screen.getByTestId('unbox-stage')).toBeTruthy();
    expect(screen.queryByTestId('reveal-tx')).toBeNull();
    // 示意模式可重播：舞台重新掛載，盒子（Reduce Motion 下仍無）
    await fireEvent.press(screen.getByTestId('reveal-replay'));
    expect(screen.getByTestId('unbox-stage')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('reveal-ok'));
    expect(onClose).toHaveBeenCalled();
    expect(useLevelRevealStore.getState().lastSeen).toBe(1);
    expect(await SecureStore.getItemAsync('neonshift.shoe.lastSeenLevel.v1')).toBeNull();
  });
});
