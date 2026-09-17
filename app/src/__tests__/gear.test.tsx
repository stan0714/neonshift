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
const mockFetchEdition = jest.fn(async (_w: PublicKey, kind: number) => ({ kind, edition: 12, total: 34 }));
jest.mock('@/services/chain/CollectibleService', () => ({ collectibleService: { claim: (w: PublicKey, k: number) => mockClaim(w, k), fetchClaimed: () => mockFetchClaimed(), fetchEdition: (w: PublicKey, k: number) => mockFetchEdition(w, k) } }));
jest.mock('expo-haptics', () => ({ notificationAsync: jest.fn(), impactAsync: jest.fn(), ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' }, NotificationFeedbackType: { Success: 'success' } }));

const wallet = new PublicKey('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
const profile = (p: Partial<PlayerProfile>): PlayerProfile => ({ wallet, coreLevel: 2, shoeLevel: 2, xp: BigInt(600), lastTaskDate: 0, streakDays: 1, maxStreakDays: 1, claimedToday: BigInt(0), todayDate: 0, migrated: true, highestLevel: 2, epochAnchor: 0, lastSettledEpoch: 0, epochPoints: 0, epochBitmap: 0, maintenanceRulesVersion: 1, ...p });
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
  useCollectibleStore.setState({ claimed: new Set([1]), loading: false, error: null, claiming: null, outcome: null, editions: {}, editionLoading: {} });
});

describe('PG-A-14 Gear', () => {
  test('等級、倍率、距下一階 XP 與三種收藏狀態', async () => {
    await render(<GearScreen />, { wrapper: Wrapper });
    expect(screen.getByText('Asian Elephant')).toBeTruthy();
    expect(screen.getByText(/600 XP · 900 XP to Lv\.3/)).toBeTruthy();
    expect(screen.getByText('1.1×')).toBeTruthy(); // core level 2
    expect(screen.getByText('1.25×')).toBeTruthy();
    expect(screen.getByText('1,500 XP')).toBeTruthy();
    expect(screen.getByLabelText('Shoe · Origin, claimed')).toBeTruthy();
    expect(screen.getByLabelText('Shoe · Asian Elephant, claimable')).toBeTruthy();
    expect(screen.getByLabelText('Shoe · Hawksbill, locked')).toBeTruthy();
    expect(screen.getByText('Reach Lv.3')).toBeTruthy();
    expect(screen.getByLabelText('First Clock-In, claimable')).toBeTruthy();
    expect(screen.getByLabelText('7-Day Streak, locked')).toBeTruthy();
    expect(screen.getByText(/devnet rent only/)).toBeTruthy();
    await waitFor(() => expect(mockFetchClaimed).toHaveBeenCalled());
  });

  test('PG-V-04：Active／Highest 標籤、本期維持區塊（點數／活躍日／回歸提示）、收藏三區與 History 標籤；歷史最高鞋款可補領', async () => {
    useDashboardStore.setState({ profile: profile({ coreLevel: 2, shoeLevel: 2, highestLevel: 4, xp: BigInt(4000), epochAnchor: Math.floor(Date.now() / 86_400_000) - 3, lastSettledEpoch: 0, epochPoints: 300, epochBitmap: 0b11 }), config, syncChain: jest.fn(async () => {}) } as never);
    await render(<GearScreen />, { wrapper: Wrapper });
    expect(screen.getByText('Active LV.2')).toBeTruthy();
    expect(screen.getByText('Highest LV.4')).toBeTruthy();
    expect(screen.getByTestId('gear-maintenance-active')).toBeTruthy();
    expect(screen.getByText('300 / 700')).toBeTruthy();
    expect(screen.getByText('2 / 5')).toBeTruthy();
    expect(screen.getByTestId('gear-maint-keep').props.children).toBe('Lv2 maintenance met for this period.');
    expect(screen.getByTestId('gear-maint-restore').props.children).toBe('Restore Lv4: 400 more points and 3 more active days (about 3 double-mission days). Your achievement stays in your collection.');
    expect(screen.getByTestId('gear-shoes-equipped')).toBeTruthy();
    expect(screen.getByTestId('gear-shoes-achieved')).toBeTruthy();
    expect(screen.getByTestId('gear-shoes-locked')).toBeTruthy();
    expect(screen.getByTestId('collectible-history-4')).toBeTruthy(); // Lv4 曾經達成
    expect(screen.getByLabelText('Shoe · Tiger, claimable')).toBeTruthy(); // 依歷史最高可補領
    expect(screen.getByLabelText('Shoe · Amur Leopard, locked')).toBeTruthy();
    await waitFor(() => expect(mockFetchClaimed).toHaveBeenCalled());
  });

  test('PG-V-04：未遷移帳戶顯示遷移說明；落後結算顯示待結算', async () => {
    useDashboardStore.setState({ profile: profile({ migrated: false }), config, syncChain: jest.fn(async () => {}) } as never);
    await render(<GearScreen />, { wrapper: Wrapper });
    expect(screen.getByTestId('gear-maintenance-migration_required')).toBeTruthy();
    useDashboardStore.setState({ profile: profile({ epochAnchor: Math.floor(Date.now() / 86_400_000) - 20, lastSettledEpoch: 0 }), config, syncChain: jest.fn(async () => {}) } as never);
    await render(<GearScreen />, { wrapper: Wrapper });
    expect(screen.getByTestId('gear-maintenance-settlement_pending')).toBeTruthy();
    expect(screen.getByText(/2 period\(s\) not yet settled/)).toBeTruthy();
    await waitFor(() => expect(mockFetchClaimed).toHaveBeenCalled());
  });

  test('按 Claim → 呼叫服務、顯示成功並改為 Claimed', async () => {
    await render(<GearScreen />, { wrapper: Wrapper });
    await fireEvent.press(screen.getByTestId('claim-2'));
    await waitFor(() => expect(screen.getByTestId('collectible-success')).toBeTruthy());
    expect(mockClaim).toHaveBeenCalledWith(wallet, 2);
    expect(screen.getByText(/Shoe · Asian Elephant · AssetAdd…/)).toBeTruthy();
    expect(screen.getByLabelText('Shoe · Asian Elephant, claimed')).toBeTruthy();
  });

  test('點鞋子開詳情面板：鞋階／XP／倍率／解鎖條件／NFT 狀態與裝備說明；可領時面板內可領取', async () => {
    await render(<GearScreen />, { wrapper: Wrapper });
    await fireEvent.press(screen.getByTestId('collectible-open-3')); // Hawksbill：locked（level 2，xp 600）
    expect(screen.getByTestId('shoe-detail')).toBeTruthy();
    expect(screen.getByText('Lv.3 · Hawksbill')).toBeTruthy();
    expect(screen.getByText('Overlapping shell panels · flipper-shaped heel')).toBeTruthy();
    expect(screen.getByTestId('shoe-detail-section-locked')).toBeTruthy();
    expect(screen.getByTestId('shoe-growth-box')).toBeTruthy();
    expect(screen.getByTestId('shoe-story-3')).toBeTruthy();
    expect(screen.getByText(/Eretmochelys imbricata/)).toBeTruthy();
    expect(screen.queryByText(/^Your finish/)).toBeNull();
    expect(screen.getByTestId('shoe-detail-nft').props.children).toBe('Claimable once you reach this stage');
    expect(screen.getByTestId('shoe-detail-remaining').props.children).toBe('You have 600 XP · 900 XP to go');
    expect(screen.getByText(/Gear and NFT are separate/)).toBeTruthy();
    // 試拆盲盒（示意）：DEMO 標籤、盒子層、系列展示樣式、無交易連結；關閉後不改任何狀態
    await fireEvent.press(screen.getByTestId('shoe-detail-preview-reveal'));
    expect(screen.getByTestId('evolution-reveal')).toBeTruthy();
    expect(screen.getByTestId('reveal-preview')).toBeTruthy();
    expect(screen.getByTestId('reward-stage-box')).toBeTruthy();
    expect(screen.getByText('Lv.2 → Lv.3')).toBeTruthy();
    expect(screen.getByText('Collection preview')).toBeTruthy();
    expect(screen.queryByTestId('reveal-tx')).toBeNull();
    await fireEvent.press(screen.getByTestId('reveal-ok'));
    expect(screen.queryByTestId('evolution-reveal')).toBeNull();
    expect(screen.getByTestId('shoe-detail')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('shoe-detail-done'));
    expect(screen.queryByTestId('shoe-detail')).toBeNull();

    await fireEvent.press(screen.getByTestId('collectible-open-1')); // Origin：claimed → 初階跑鞋說明＋NFT 編號（鏈上領取順序）
    await waitFor(() => expect(screen.getByTestId('shoe-detail-edition').props.children).toBe('No. 0012 · 34 claimed'));
    expect(mockFetchEdition).toHaveBeenCalledWith(wallet, 1);
    expect(screen.getByText(/Your starter shoe was granted/)).toBeTruthy();
    expect(screen.getByTestId('shoe-detail-nft').props.children).toBe('Already in your wallet');
    await fireEvent.press(screen.getByTestId('shoe-detail-close'));

    await fireEvent.press(screen.getByTestId('collectible-open-2')); // Asian Elephant：claimable → footer 領取
    await fireEvent.press(screen.getByTestId('shoe-detail-claim'));
    await waitFor(() => expect(mockClaim).toHaveBeenCalledWith(wallet, 2));
    await waitFor(() => expect(screen.getByTestId('shoe-detail-nft').props.children).toBe('Already in your wallet'));
  });

  test('拒簽顯示 warning，不改變狀態', async () => {
    const { ClaimError } = jest.requireActual('@/services/chain/StarterShoeService');
    mockClaim.mockRejectedValueOnce(new ClaimError('REJECTED', 'cancelled'));
    await render(<GearScreen />, { wrapper: Wrapper });
    await fireEvent.press(screen.getByTestId('claim-101'));
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
    expect(screen.getByLabelText('Shoe · Amur Leopard, claimable')).toBeTruthy();
  });
});
