import { PublicKey } from '@solana/web3.js';

import type { PlayerProfile } from '@/chain/accounts';
import { claimCollectibleInstruction } from '@/chain/instructions';
import { assetPda, collectiblePda, discriminator, MPL_CORE_PROGRAM_ID } from '@/chain/program';
import { COLLECTIBLES, collectibleName, collectibleStatus, isEligible } from '@/domain/collectibles';
import { translate } from '@/i18n';
import { collectibleService } from '@/services/chain/CollectibleService';
import { ClaimError } from '@/services/chain/StarterShoeService';
import { useCollectibleStore } from '@/state/collectibleStore';
import { WalletError } from '@/services/wallet/WalletService';

jest.mock('@/config/app', () => ({ APP_CONFIG: { ...jest.requireActual('@/config/app').APP_CONFIG, programId: '6MhVoQHdEpY2hqkaNJMkT2vHWakfnGfEYDgCtJzh6ENA', chainConfigured: true } }));

const mockAccountExists = jest.fn(async (_k: PublicKey) => false);
const mockSend = jest.fn(async (_w: PublicKey, _ixs: unknown[]) => ({ signature: 'sig111', blockhash: 'b', lastValidBlockHeight: 1 }));
const mockGetMultiple = jest.fn(async (keys: PublicKey[]) => keys.map(() => null));
const mockGetProgramAccounts = jest.fn(async (_p: PublicKey, _cfg: unknown) => [] as { pubkey: PublicKey; account: { data: Uint8Array } }[]);
jest.mock('@/services/chain/ChainClient', () => ({
  accountExists: (k: PublicKey) => mockAccountExists(k),
  sendWithWallet: (w: PublicKey, ixs: unknown[]) => mockSend(w, ixs),
  getConnection: () => ({ getMultipleAccountsInfo: (keys: PublicKey[]) => mockGetMultiple(keys), getProgramAccounts: (p: PublicKey, cfg: unknown) => mockGetProgramAccounts(p, cfg) }),
}));

const wallet = new PublicKey('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
const profile = (p: Partial<PlayerProfile>): PlayerProfile => ({ wallet, coreLevel: 1, shoeLevel: 1, xp: BigInt(0), lastTaskDate: 0, streakDays: 0, maxStreakDays: 0, claimedToday: BigInt(0), todayDate: 0, migrated: true, highestLevel: 1, epochAnchor: 0, lastSettledEpoch: 0, epochPoints: 0, epochBitmap: 0, maintenanceRulesVersion: 1, ...p });

beforeEach(() => {
  jest.clearAllMocks();
  mockAccountExists.mockResolvedValue(false);
  useCollectibleStore.setState({ claimed: new Set(), loading: false, error: null, claiming: null, outcome: null, editions: {}, editionLoading: {} });
});

/** CollectibleReceipt dataSlice（asset 32 ＋ claimed_at i64 LE） */
const receiptSlice = (asset: PublicKey, claimedAt: number) => {
  const data = new Uint8Array(40);
  data.set(asset.toBytes(), 0);
  new DataView(data.buffer).setBigInt64(32, BigInt(claimedAt), true);
  return { pubkey: asset, account: { data } };
};

describe('NFT 編號（鏈上領取順序）', () => {
  test('依 claimed_at 排序、同秒以 asset 位址決定；回第 n 位與總數；未領取回 null；memcmp 過濾 discriminator＋kind', async () => {
    const other1 = new PublicKey('11111111111111111111111111111112');
    const other2 = new PublicKey('SysvarC1ock11111111111111111111111111111111');
    const mine = assetPda(wallet, 4);
    mockGetProgramAccounts.mockResolvedValueOnce([receiptSlice(mine, 2_000), receiptSlice(other1, 1_000), receiptSlice(other2, 3_000)]);
    await expect(collectibleService.fetchEdition(wallet, 4)).resolves.toEqual({ kind: 4, edition: 2, total: 3 });
    const cfg = mockGetProgramAccounts.mock.calls[0][1] as { dataSlice: { offset: number; length: number }; filters: { memcmp: { offset: number; bytes: string } }[] };
    expect(cfg.dataSlice).toEqual({ offset: 41, length: 40 });
    expect(cfg.filters.map((f) => f.memcmp.offset)).toEqual([0, 40]);
    mockGetProgramAccounts.mockResolvedValueOnce([receiptSlice(other1, 1_000)]);
    await expect(collectibleService.fetchEdition(wallet, 4)).resolves.toBeNull();
    // store：領取成功後自動查編號；RPC 失敗不覆蓋
    mockGetProgramAccounts.mockResolvedValueOnce([receiptSlice(mine, 5)]);
    await useCollectibleStore.getState().loadEdition(wallet, 4);
    expect(useCollectibleStore.getState().editions[4]).toEqual({ kind: 4, edition: 1, total: 1 });
    mockGetProgramAccounts.mockRejectedValueOnce(new Error('rpc'));
    await useCollectibleStore.getState().loadEdition(wallet, 4, true);
    expect(useCollectibleStore.getState().editions[4]).toEqual({ kind: 4, edition: 1, total: 1 });
  });
});

describe('domain/collectibles（與鏈上 eligible() 一致）', () => {
  test('跑鞋 kind ≤ shoe_level；徽章依 xp／max_streak_days；名次一律鎖定', () => {
    const p = profile({ shoeLevel: 3, xp: BigInt(1500), streakDays: 2, maxStreakDays: 7 });
    expect([1, 2, 3, 4, 5].map((k) => isEligible(p, k as 1))).toEqual([true, true, true, false, false]);
    expect(isEligible(p, 101)).toBe(true);
    expect(isEligible(p, 102)).toBe(true);
    expect(isEligible(profile({ streakDays: 7, maxStreakDays: 6 }), 102)).toBe(false);
    expect(isEligible(profile({ xp: BigInt(0) }), 101)).toBe(false);
    expect(isEligible(p, 111)).toBe(false);
    expect(isEligible(null, 1)).toBe(false);
  });

  test('status：claimed 優先於資格', () => {
    const p = profile({ shoeLevel: 2 });
    expect(collectibleStatus(p, new Set([1]), 1)).toBe('claimed');
    expect(collectibleStatus(p, new Set(), 2)).toBe('claimable');
    expect(collectibleStatus(p, new Set(), 3)).toBe('locked');
  });

  test('目錄：五階跑鞋名稱對齊 Style 16.2，kind 不重複', () => {
    const en = (k: Parameters<typeof translate>[1], p?: Record<string, string | number>) => translate('en', k, p);
    expect(COLLECTIBLES.filter((c) => c.group === 'shoe').map((c) => collectibleName(en, c))).toEqual(['Shoe · Origin', 'Shoe · Asian Elephant', 'Shoe · Hawksbill', 'Shoe · Tiger', 'Shoe · Amur Leopard']);
    const zh = (k: Parameters<typeof translate>[1], p?: Record<string, string | number>) => translate('zh-TW', k, p);
    expect(collectibleName(zh, COLLECTIBLES[0]!)).toBe('跑鞋 · 原點');
    expect(new Set(COLLECTIBLES.map((c) => c.kind)).size).toBe(COLLECTIBLES.length);
  });
});

describe('chain/instructions claim_collectible', () => {
  test('帳戶順序與資料（disc + u8 kind）', () => {
    const ix = claimCollectibleInstruction(wallet, 102);
    expect(ix.keys.map((k) => [k.isSigner, k.isWritable])).toEqual([[true, true], [false, false], [false, false], [false, true], [false, true], [false, false], [false, false]]);
    expect(ix.keys[3]!.pubkey.equals(collectiblePda(wallet, 102))).toBe(true);
    expect(ix.keys[4]!.pubkey.equals(assetPda(wallet, 102))).toBe(true);
    expect(ix.keys[5]!.pubkey.equals(MPL_CORE_PROGRAM_ID)).toBe(true);
    expect(Array.from(ix.data)).toEqual([...discriminator('claim_collectible'), 102]);
    expect(() => claimCollectibleInstruction(wallet, 300)).toThrow(RangeError);
  });
});

describe('CollectibleService', () => {
  test('fetchClaimed 以單一 RPC 查所有 receipt', async () => {
    mockGetMultiple.mockImplementationOnce(async (keys) => keys.map((k) => (k.equals(collectiblePda(wallet, 1)) || k.equals(collectiblePda(wallet, 101)) ? ({} as never) : null)));
    const claimed = await collectibleService.fetchClaimed(wallet);
    expect([...claimed]).toEqual([1, 101]);
    expect(mockGetMultiple).toHaveBeenCalledTimes(1);
  });

  test('claim：receipt 已存在 → alreadyClaimed 不送交易', async () => {
    mockAccountExists.mockResolvedValueOnce(true);
    const r = await collectibleService.claim(wallet, 1);
    expect(r).toMatchObject({ kind: 1, alreadyClaimed: true, signature: null, asset: assetPda(wallet, 1).toBase58() });
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('claim：送出後失敗但 receipt 已存在 → 視為成功（冪等）', async () => {
    mockSend.mockRejectedValueOnce(new Error('timeout'));
    mockAccountExists.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const r = await collectibleService.claim(wallet, 2);
    expect(r.alreadyClaimed).toBe(true);
  });

  test('claim：錢包拒簽 → REJECTED', async () => {
    mockSend.mockRejectedValueOnce(new WalletError('REJECTED', 'user cancelled'));
    await expect(collectibleService.claim(wallet, 1)).rejects.toMatchObject({ code: 'REJECTED' });
  });
});

describe('collectibleStore', () => {
  test('claim 成功：加入 claimed、outcome success；失敗保留 outcome error', async () => {
    await useCollectibleStore.getState().claim(wallet, 1);
    expect(useCollectibleStore.getState().claimed.has(1)).toBe(true);
    expect(useCollectibleStore.getState().outcome).toMatchObject({ kind: 'success', result: { kind: 1, signature: 'sig111' } });
    mockSend.mockRejectedValueOnce(new ClaimError('FAILED', 'boom'));
    await useCollectibleStore.getState().claim(wallet, 2);
    expect(useCollectibleStore.getState().claimed.has(2)).toBe(false);
    expect(useCollectibleStore.getState().outcome).toMatchObject({ kind: 'error', code: 'FAILED', collectible: 2 });
    expect(useCollectibleStore.getState().claiming).toBeNull();
  });
});
