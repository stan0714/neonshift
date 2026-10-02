/**
 * 成就 NFT 領取（PG-A-14，FR-04.6）：免費、只付 rent；玩家以 MWA 簽 `claim_collectible`。
 * 冪等：receipt PDA 存在即視為已領取（重送會被 PDA init 擋下，不會有第二枚）。
 */
import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { Buffer } from 'buffer';

import { claimCollectibleInstruction } from '@/chain/instructions';
import { accountDiscriminator, assetPda, collectiblePda, programId } from '@/chain/program';
import { APP_CONFIG } from '@/config/app';
import { COLLECTIBLES, type CollectibleKind } from '@/domain/collectibles';
import { WalletError } from '@/services/wallet/WalletService';

import { accountExists, getConnection, isInsufficientSol, sendWithWallet } from './ChainClient';
import { ClaimError } from './StarterShoeService';

export type CollectibleClaimResult = { kind: CollectibleKind; asset: string; signature: string | null; alreadyClaimed: boolean };
/** NFT 編號：同 kind 的鏈上領取順序（第 edition 位，共 total 位）。由 CollectibleReceipt 的 claimed_at＋asset 排序推得，任何人可重算；不寫在共用 metadata 內（WILD-05）。 */
export type CollectibleEdition = { kind: CollectibleKind; edition: number; total: number };

/** CollectibleReceipt 版面：disc 8 ｜ wallet 32 ｜ kind 1（@40）｜ asset 32（@41）｜ claimed_at i64（@73）｜ bump */
const RECEIPT_KIND_OFFSET = 40;
const RECEIPT_ASSET_OFFSET = 41;
const RECEIPT_SLICE_LEN = 40;

export const collectibleService = {
  /** 一次查所有 kind 的 receipt（單一 RPC） */
  async fetchClaimed(wallet: PublicKey): Promise<Set<number>> {
    if (!APP_CONFIG.chainConfigured) return new Set();
    const kinds = COLLECTIBLES.map((c) => c.kind);
    const infos = await getConnection().getMultipleAccountsInfo(kinds.map((k) => collectiblePda(wallet, k)), 'confirmed');
    return new Set(kinds.filter((_, i) => infos[i] !== null));
  },

  /** 查此錢包在該 kind 的領取編號；未領取回 null。單一 getProgramAccounts（只切 asset＋claimed_at 40 bytes）。 */
  async fetchEdition(wallet: PublicKey, kind: CollectibleKind): Promise<CollectibleEdition | null> {
    if (!APP_CONFIG.chainConfigured) return null;
    const mine = assetPda(wallet, kind).toBase58();
    const accounts = await getConnection().getProgramAccounts(programId(), {
      commitment: 'confirmed',
      dataSlice: { offset: RECEIPT_ASSET_OFFSET, length: RECEIPT_SLICE_LEN },
      filters: [
        { memcmp: { offset: 0, bytes: bs58.encode(accountDiscriminator('CollectibleReceipt')) } },
        { memcmp: { offset: RECEIPT_KIND_OFFSET, bytes: bs58.encode(Uint8Array.from([kind])) } },
      ],
    });
    const rows = accounts.map(({ account }) => {
      const data = Buffer.from(account.data);
      return { asset: new PublicKey(data.subarray(0, 32)).toBase58(), claimedAt: data.readBigInt64LE(32) };
    });
    rows.sort((a, b) => (a.claimedAt === b.claimedAt ? (a.asset < b.asset ? -1 : a.asset > b.asset ? 1 : 0) : a.claimedAt < b.claimedAt ? -1 : 1));
    const index = rows.findIndex((r) => r.asset === mine);
    return index < 0 ? null : { kind, edition: index + 1, total: rows.length };
  },

  async claim(wallet: PublicKey, kind: CollectibleKind): Promise<CollectibleClaimResult> {
    if (!APP_CONFIG.chainConfigured) throw new ClaimError('NOT_AVAILABLE', 'Onchain program is not configured for this build');
    const receipt = collectiblePda(wallet, kind);
    const asset = assetPda(wallet, kind).toBase58();
    try {
      if (await accountExists(receipt)) return { kind, asset, signature: null, alreadyClaimed: true };
      const sent = await sendWithWallet(wallet, [claimCollectibleInstruction(wallet, kind)]);
      return { kind, asset, signature: sent.signature, alreadyClaimed: false };
    } catch (e) {
      if (isInsufficientSol(e)) throw new ClaimError('INSUFFICIENT_SOL', e instanceof Error ? e.message : String(e)); // 沒送出：不用再查帳戶
      if (e instanceof WalletError) {
        if (e.code === 'REJECTED') throw new ClaimError('REJECTED', e.message);
        if (e.code === 'NETWORK_ERROR') throw new ClaimError('NETWORK_ERROR', e.message);
      }
      // 送出後逾時／失敗：以 receipt 是否存在為準（SD 5.3，不盲目重送）
      if (await accountExists(receipt).catch(() => false)) return { kind, asset, signature: null, alreadyClaimed: true };
      throw new ClaimError('FAILED', e instanceof Error ? e.message : String(e));
    }
  },
};
