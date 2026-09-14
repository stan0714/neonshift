/**
 * 初階跑鞋領取（FR-04.1，2026-09-14 定案：不鑄造 NFT、免費贈與）。
 * 跑鞋隨鏈上 PlayerProfile 建立（`init_player`）直接給予；使用者只付帳戶 rent＋交易費（devnet SOL）。
 * 重試不會建立第二個 profile（PDA init 失敗），已存在即視為已領取。
 */
import type { PublicKey } from '@solana/web3.js';

import { initPlayerInstruction } from '@/chain/instructions';
import { playerPda, PLAYER_PROFILE_SPACE } from '@/chain/program';
import { APP_CONFIG } from '@/config/app';
import { WalletError } from '@/services/wallet/WalletService';

import { accountExists, estimateFeeLamports, sendWithWallet } from './ChainClient';

export type ClaimQuote = {
  shoeName: string;
  network: string;
  /** lamports：rent + 交易費 */
  estimatedFeeLamports: number;
};

export type ClaimResult = { signature: string | null; profile: string; alreadyClaimed: boolean };

export type ClaimErrorCode = 'NOT_AVAILABLE' | 'REJECTED' | 'NETWORK_ERROR' | 'FAILED';

export class ClaimError extends Error {
  constructor(
    public readonly code: ClaimErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ClaimError';
  }
}

export const STARTER_SHOE_NAME = 'NeonShift Starter Shoe · Lv.1';

const FALLBACK_FEE_LAMPORTS = 5_000 + 1_370_000; // 簽章費 + 約 69 bytes 帳戶 rent（devnet 基準）

export const starterShoeService = {
  async quote(wallet: PublicKey | null): Promise<ClaimQuote> {
    const network = `Solana ${APP_CONFIG.cluster === 'devnet' ? 'Devnet' : APP_CONFIG.cluster}`;
    if (!wallet || !APP_CONFIG.chainConfigured) return { shoeName: STARTER_SHOE_NAME, network, estimatedFeeLamports: FALLBACK_FEE_LAMPORTS };
    try {
      const fee = await estimateFeeLamports(wallet, [initPlayerInstruction(wallet)], PLAYER_PROFILE_SPACE);
      return { shoeName: STARTER_SHOE_NAME, network, estimatedFeeLamports: fee };
    } catch {
      return { shoeName: STARTER_SHOE_NAME, network, estimatedFeeLamports: FALLBACK_FEE_LAMPORTS };
    }
  },

  async claim(wallet: PublicKey): Promise<ClaimResult> {
    if (!APP_CONFIG.chainConfigured) throw new ClaimError('NOT_AVAILABLE', 'Onchain program is not configured for this build');
    const profile = playerPda(wallet);
    try {
      if (await accountExists(profile)) return { signature: null, profile: profile.toBase58(), alreadyClaimed: true };
      const sent = await sendWithWallet(wallet, [initPlayerInstruction(wallet)]);
      return { signature: sent.signature, profile: profile.toBase58(), alreadyClaimed: false };
    } catch (e) {
      if (e instanceof WalletError) {
        if (e.code === 'REJECTED') throw new ClaimError('REJECTED', e.message);
        if (e.code === 'NETWORK_ERROR') throw new ClaimError('NETWORK_ERROR', e.message);
      }
      // 送出後逾時／失敗：以帳戶是否存在為準（不盲目重送）
      if (await accountExists(profile).catch(() => false)) return { signature: null, profile: profile.toBase58(), alreadyClaimed: true };
      throw new ClaimError('FAILED', e instanceof Error ? e.message : String(e));
    }
  },
};

export const lamportsToSol = (l: number) => (l / 1_000_000_000).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
