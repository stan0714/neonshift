/**
 * 成就 NFT 領取（PG-A-14，FR-04.6）：免費、只付 rent；玩家以 MWA 簽 `claim_collectible`。
 * 冪等：receipt PDA 存在即視為已領取（重送會被 PDA init 擋下，不會有第二枚）。
 */
import type { PublicKey } from '@solana/web3.js';

import { claimCollectibleInstruction } from '@/chain/instructions';
import { assetPda, collectiblePda } from '@/chain/program';
import { APP_CONFIG } from '@/config/app';
import { COLLECTIBLES, type CollectibleKind } from '@/domain/collectibles';
import { WalletError } from '@/services/wallet/WalletService';

import { accountExists, getConnection, sendWithWallet } from './ChainClient';
import { ClaimError } from './StarterShoeService';

export type CollectibleClaimResult = { kind: CollectibleKind; asset: string; signature: string | null; alreadyClaimed: boolean };

export const collectibleService = {
  /** 一次查所有 kind 的 receipt（單一 RPC） */
  async fetchClaimed(wallet: PublicKey): Promise<Set<number>> {
    if (!APP_CONFIG.chainConfigured) return new Set();
    const kinds = COLLECTIBLES.map((c) => c.kind);
    const infos = await getConnection().getMultipleAccountsInfo(kinds.map((k) => collectiblePda(wallet, k)), 'confirmed');
    return new Set(kinds.filter((_, i) => infos[i] !== null));
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
