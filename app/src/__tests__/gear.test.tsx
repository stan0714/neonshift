import { NavigationContainer } from '@react-navigation/native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { PublicKey } from '@solana/web3.js';
import type { PropsWithChildren } from 'react';

import type { PlayerProfile } from '@/chain/accounts';
import { GearScreen } from '@/screens/tabs/GearScreen';
import { useCollectibleStore } from '@/state/collectibleStore';
import { useDashboardStore } from '@/state/dashboardStore';
import { useWalletStore } from '@/state/walletStore';
import { ThemeProvider } from '@/theme';

jest.mock('@/config/app', () => ({ APP_CONFIG: { ...jest.requireActual('@/config/app').APP_CONFIG, programId: '6MhVoQHdEpY2hqkaNJMkT2vHWakfnGfEYDgCtJzh6ENA', chainConfigured: true } }));
const mockClaim = jest.fn(async (_w: PublicKey, kind: number) => ({ kind, asset: 'AssetAddr1111', signature: 'sig111', alreadyClaimed: false }));
const mockFetchClaimed = jest.fn(async () => new Set([1]));
jest.mock('@/services/chain/CollectibleService', () => ({ collectibleService: { claim: (w: PublicKey, k: number) => mockClaim(w, k), fetchClaimed: () => mockFetchClaimed() } }));
jest.mock('expo-haptics', () => ({ notificationAsync: jest.fn(), NotificationFeedbackType: { Success: 'success' } }));

const wallet = new PublicKey('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
const profile = (p: Partial<PlayerProfile>): PlayerProfile => ({ wallet, coreLevel: 2, shoeLevel: 2, xp: BigInt(600), lastTaskDate: 0, streakDays: 1, maxStreakDays: 1, claimedToday: BigInt(0), todayDate: 0, ...p });
const config = { clusterId: 1, attestorPubkey: new Uint8Array(32), mint: wallet, rewardVault: wallet, dailyCap: BigInt(0), baseStepsReward: BigInt(0), baseSleepReward: BigInt(0), coreMultiplierBps: [10_000, 11_000, 12_500, 14_000, 16_000], shoeXpThresholds: [0, 450, 1500, 3600, 7500].map(BigInt), paused: false };

const Wrapper = ({ children }: PropsWithChildren) => (
  <ThemeProvider>
    <NavigationContainer>{children}</NavigationContainer>
  </ThemeProvider>
);

beforeEach(() => {
  jest.clearAllMocks();
  useWalletStore.setState({ status: 'connected', session: { address: wallet.toBase58(), publicKey: wallet, walletUriBase: '', label: 'Phantom' }, error: null } as never);
  useDashboardStore.setState({ profile: profile({}), config, syncChain: jest.fn(async () => {}) } as never);
  useCollectibleStore.setState({ claimed: new Set([1]), loading: false, error: null, claiming: null, outcome: null });
});

describe('PG-A-14 Gear', () => {
  test('等級、倍率、距下一階 XP 與三種收藏狀態', async () => {
    await render(<GearScreen />, { wrapper: Wrapper });
    expect(screen.getByText('Pulse')).toBeTruthy();
    expect(screen.getByText(/600 XP · 900 XP to Lv\.3/)).toBeTruthy();
    expect(screen.getByText('1.1×')).toBeTruthy(); // core level 2
    expect(screen.getByText('1.25×')).toBeTruthy();
    expect(screen.getByText('1,500 XP')).toBeTruthy();
    expect(screen.getByLabelText('Shoe · Origin, claimed')).toBeTruthy();
    expect(screen.getByLabelText('Shoe · Pulse, claimable')).toBeTruthy();
    expect(screen.getByLabelText('Shoe · Phase, locked')).toBeTruthy();
    expect(screen.getByText('Reach Lv.3')).toBeTruthy();
    expect(screen.getByLabelText('First Clock-In, claimable')).toBeTruthy();
    expect(screen.getByLabelText('7-Day Streak, locked')).toBeTruthy();
    expect(screen.getByText(/only pay devnet rent/)).toBeTruthy();
    await waitFor(() => expect(mockFetchClaimed).toHaveBeenCalled());
  });

  test('按 Claim → 呼叫服務、顯示成功並改為 Claimed', async () => {
    await render(<GearScreen />, { wrapper: Wrapper });
    fireEvent.press(screen.getByTestId('claim-2'));
    await waitFor(() => expect(screen.getByTestId('collectible-success')).toBeTruthy());
    expect(mockClaim).toHaveBeenCalledWith(wallet, 2);
    expect(screen.getByText(/Shoe · Pulse · AssetAdd…/)).toBeTruthy();
    expect(screen.getByLabelText('Shoe · Pulse, claimed')).toBeTruthy();
  });

  test('拒簽顯示 warning，不改變狀態', async () => {
    const { ClaimError } = jest.requireActual('@/services/chain/StarterShoeService');
    mockClaim.mockRejectedValueOnce(new ClaimError('REJECTED', 'cancelled'));
    await render(<GearScreen />, { wrapper: Wrapper });
    fireEvent.press(screen.getByTestId('claim-101'));
    await waitFor(() => expect(screen.getByTestId('collectible-error')).toBeTruthy());
    expect(screen.getByText('Wallet approval cancelled')).toBeTruthy();
    expect(screen.getByLabelText('First Clock-In, claimable')).toBeTruthy();
  });

  test('沒有 profile 時 Claim 停用並說明原因', async () => {
    useDashboardStore.setState({ profile: null } as never);
    await render(<GearScreen />, { wrapper: Wrapper });
    expect(screen.getByText('No profile yet')).toBeTruthy();
    expect(screen.queryByTestId('claim-1')).toBeNull(); // 無 profile → 全部 locked
  });

  test('Lv.5 顯示 Max level、五階皆可領', async () => {
    useDashboardStore.setState({ profile: profile({ shoeLevel: 5, coreLevel: 5, xp: BigInt(9000) }) } as never);
    await render(<GearScreen />, { wrapper: Wrapper });
    expect(screen.getByText(/9,000 XP · Max level/)).toBeTruthy();
    expect(screen.getByText('1.6×')).toBeTruthy();
    expect(screen.getByLabelText('Shoe · Zenith, claimable')).toBeTruthy();
  });
});
