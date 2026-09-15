/**
 * PB 成就 NFT 鑄造（PG-R-08，FR-15.2／BR-39）與首次里程碑鑄造（PG-M-03，FR-17.4）：後端 mint-intent（registry 已核准才有證明）→ [ed25519, claim_achievement] 以 MWA 簽送。
 * 不花 tSKR，只付 rent（費用由後端揭露）；冪等：receipt PDA 存在即已鑄造，不重送。
 */
import { PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';
import bs58 from 'bs58';

import { claimAchievementInstruction } from '@/chain/instructions';
import { achievementAssetPda, achievementPda } from '@/chain/program';
import { ed25519Instruction } from '@/chain/txBuilder';
import { APP_CONFIG } from '@/config/app';
import { apiClient, type MintIntent } from '@/services/api/ApiClient';
import { WalletError } from '@/services/wallet/WalletService';

import { accountExists, sendWithWallet } from './ChainClient';
import { ClaimError } from './StarterShoeService';

export type MintOutcome = { kind: 'minted'; asset: string; signature: string | null; alreadyMinted: boolean } | { kind: 'pending_registry' | 'revoke_pending' | 'revoked'; intent: MintIntent };

export const achievementService = {
  intent(pbId: string, publicConsent: boolean) {
    return apiClient.mintIntent(pbId, publicConsent);
  },
  /** PG-M-03：首次里程碑以穩定 key 申請（同 key 終身一枚；證明與鑄造流程共用） */
  milestoneIntent(key: string, publicConsent: boolean) {
    return apiClient.milestoneMintIntent(key, publicConsent);
  },

  async mint(wallet: PublicKey, intent: MintIntent): Promise<MintOutcome> {
    if (!APP_CONFIG.chainConfigured) throw new ClaimError('NOT_AVAILABLE', 'Onchain program is not configured for this build');
    if (!intent.proof) return { kind: intent.status === 'approved' || intent.status === 'minted' ? 'pending_registry' : (intent.status as 'pending_registry' | 'revoke_pending' | 'revoked'), intent };
    const id = Buffer.from(intent.achievement.achievement_id, 'hex');
    const receipt = achievementPda(wallet, id);
    const asset = achievementAssetPda(wallet, id).toBase58();
    try {
      if (await accountExists(receipt)) return { kind: 'minted', asset, signature: null, alreadyMinted: true };
      const message = new Uint8Array(Buffer.from(intent.proof.message_b64, 'base64'));
      const signature = new Uint8Array(Buffer.from(intent.proof.signature_b64, 'base64'));
      const attestor = bs58.decode(intent.proof.attestor);
      const sent = await sendWithWallet(wallet, [ed25519Instruction(message, signature, attestor), claimAchievementInstruction(wallet, message)]);
      return { kind: 'minted', asset, signature: sent.signature, alreadyMinted: false };
    } catch (e) {
      if (e instanceof WalletError) {
        if (e.code === 'REJECTED') throw new ClaimError('REJECTED', e.message);
        if (e.code === 'NETWORK_ERROR') throw new ClaimError('NETWORK_ERROR', e.message);
      }
      if (await accountExists(receipt).catch(() => false)) return { kind: 'minted', asset, signature: null, alreadyMinted: true };
      throw new ClaimError('FAILED', e instanceof Error ? e.message : String(e));
    }
  },
};
