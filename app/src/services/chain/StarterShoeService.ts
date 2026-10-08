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

import { accountExists, estimateFeeLamports, isInsufficientSol, MIN_FEE_LAMPORTS, rentExemptOnChain, sendWithWallet } from './ChainClient';

export type ClaimQuote = {
  shoeName: string;
  network: string;
  /** lamports：rent + 交易費 */
  estimatedFeeLamports: number;
  /** 這個錢包已經有 profile：不是第一次，不需要付費也不會送交易 */
  alreadyClaimed?: boolean;
};

export type ClaimResult = { signature: string | null; profile: string; alreadyClaimed: boolean };

export type ClaimErrorCode = 'NOT_AVAILABLE' | 'REJECTED' | 'NETWORK_ERROR' | 'INSUFFICIENT_SOL' | 'FAILED';

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
  /**
   * 報價。**已經有 profile 就不是「第一次」**——回 `alreadyClaimed: true` 且不報價。
   *
   * 2026-09-30 實機發現：斷開錢包再連回來會重走整條新手流程，而這一頁照樣算出
   * 「rent＋手續費」顯示給使用者看；但實際按下去 `claim()` 走的是 `alreadyClaimed` 分支，
   * **一毛都不會花、交易也不會送**。對一個重連的評審來說，那等於系統要他為已經擁有的
   * 東西再付一次錢——那是會讓人不敢按下去的錯。
   */
  async quote(wallet: PublicKey | null): Promise<ClaimQuote> {
    const network = `Solana ${APP_CONFIG.cluster === 'devnet' ? 'Devnet' : APP_CONFIG.cluster}`;
    if (!wallet || !APP_CONFIG.chainConfigured) return { shoeName: STARTER_SHOE_NAME, network, estimatedFeeLamports: FALLBACK_FEE_LAMPORTS };
    try {
      if (await accountExists(playerPda(wallet))) return { shoeName: STARTER_SHOE_NAME, network, estimatedFeeLamports: 0, alreadyClaimed: true };
      const fee = await estimateFeeLamports(wallet, [initPlayerInstruction(wallet)], PLAYER_PROFILE_SPACE);
      return { shoeName: STARTER_SHOE_NAME, network, estimatedFeeLamports: fee };
    } catch {
      // 查不到帳戶狀態時**不宣稱已擁有**：寧可照常報價（按下去仍會被 claim 的 accountExists 擋住），
      // 也不要因為一次讀取失敗就讓真正的新使用者拿不到起始鞋。
      return { shoeName: STARTER_SHOE_NAME, network, estimatedFeeLamports: FALLBACK_FEE_LAMPORTS };
    }
  },

  async claim(wallet: PublicKey): Promise<ClaimResult> {
    if (!APP_CONFIG.chainConfigured) throw new ClaimError('NOT_AVAILABLE', 'Onchain program is not configured for this build');
    const profile = playerPda(wallet);
    try {
      if (await accountExists(profile)) return { signature: null, profile: profile.toBase58(), alreadyClaimed: true };
      // 起始鞋要開 profile 帳戶：門檻是簽章費＋那個帳戶的 rent（問鏈上；查不到只檢查簽章費）
      const rent = await rentExemptOnChain(PLAYER_PROFILE_SPACE);
      const sent = await sendWithWallet(wallet, [initPlayerInstruction(wallet)], undefined, MIN_FEE_LAMPORTS + (rent ?? 0));
      return { signature: sent.signature, profile: profile.toBase58(), alreadyClaimed: false };
    } catch (e) {
      if (isInsufficientSol(e)) throw new ClaimError('INSUFFICIENT_SOL', e instanceof Error ? e.message : String(e)); // 沒送出：不用再查帳戶
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

export const lamportsToSol = (l: number) => (l / 1_000_000_000).toFixed(6).replace(/\.?0+$/, '');
