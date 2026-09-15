import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';

import { Buffer } from 'buffer';

import { SYSVAR_INSTRUCTIONS_PUBKEY } from '@solana/web3.js';

import { achievementAssetPda, achievementPda, assetPda, collectiblePda, configPda, discriminator, eligibilityPda, entryPda, MPL_CORE_PROGRAM_ID, playerPda, programId, tournamentPda, tournamentVaultPda } from './program';
import { associatedTokenAddress, TOKEN_PROGRAM_ID } from './txBuilder';

/** `init_player`：玩家簽章付 rent；即初階跑鞋的贈與（SD 3.2） */
export function initPlayerInstruction(wallet: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: programId(),
    keys: [
      { pubkey: wallet, isSigner: true, isWritable: true },
      { pubkey: configPda(), isSigner: false, isWritable: false },
      { pubkey: playerPda(wallet), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: discriminator('init_player'),
  });
}

/** PG-V-02 `migrate_player`：舊版 PlayerProfile 補維持欄位；payer 付 rent 差額（打卡交易前置） */
export function migratePlayerInstruction(payer: PublicKey, wallet: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: programId(),
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: playerPda(wallet), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: discriminator('migrate_player'),
  });
}

/** PG-V-02 `settle_player_epochs`：任何 payer 結算已過期週期（bounded；clock_in 落後 > 8 期時前置） */
export function settlePlayerEpochsInstruction(payer: PublicKey, wallet: PublicKey, maxEpochs = 64): TransactionInstruction {
  if (!Number.isInteger(maxEpochs) || maxEpochs < 1 || maxEpochs > 255) throw new RangeError(`maxEpochs 必須是 1..255：${maxEpochs}`);
  return new TransactionInstruction({
    programId: programId(),
    keys: [
      { pubkey: payer, isSigner: true, isWritable: false },
      { pubkey: configPda(), isSigner: false, isWritable: false },
      { pubkey: playerPda(wallet), isSigner: false, isWritable: true },
    ],
    data: Buffer.concat([discriminator('settle_player_epochs'), Buffer.from([maxEpochs])]),
  });
}

/** `claim_collectible`：免費領取成就 NFT（只付 rent）；帳戶順序與 programs/.../claim_collectible.rs 一致 */
export function claimCollectibleInstruction(wallet: PublicKey, kind: number): TransactionInstruction {
  if (!Number.isInteger(kind) || kind < 0 || kind > 255) throw new RangeError(`kind 必須是 u8：${kind}`);
  return new TransactionInstruction({
    programId: programId(),
    keys: [
      { pubkey: wallet, isSigner: true, isWritable: true },
      { pubkey: configPda(), isSigner: false, isWritable: false },
      { pubkey: playerPda(wallet), isSigner: false, isWritable: false },
      { pubkey: collectiblePda(wallet, kind), isSigner: false, isWritable: true },
      { pubkey: assetPda(wallet, kind), isSigner: false, isWritable: true },
      { pubkey: MPL_CORE_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([discriminator('claim_collectible'), Buffer.from([kind])]),
  });
}

/** `join_tournament`：質押 stake_amount 到賽事 vault（受 pause 影響）；帳戶順序見 tournament.rs */
export function joinTournamentInstruction(wallet: PublicKey, weekId: number, mint: PublicKey): TransactionInstruction {
  const t = tournamentPda(weekId);
  return new TransactionInstruction({
    programId: programId(),
    keys: [
      { pubkey: wallet, isSigner: true, isWritable: true },
      { pubkey: configPda(), isSigner: false, isWritable: false },
      { pubkey: t, isSigner: false, isWritable: true },
      { pubkey: entryPda(t, wallet), isSigner: false, isWritable: true },
      { pubkey: tournamentVaultPda(t), isSigner: false, isWritable: true },
      { pubkey: associatedTokenAddress(mint, wallet), isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: discriminator('join_tournament'),
  });
}

/** `claim_prize`／`refund_all` 共用 ClaimPrize 帳戶（不受 pause 影響） */
function prizeInstruction(name: 'claim_prize' | 'refund_all', wallet: PublicKey, weekId: number, mint: PublicKey): TransactionInstruction {
  const t = tournamentPda(weekId);
  return new TransactionInstruction({
    programId: programId(),
    keys: [
      { pubkey: wallet, isSigner: true, isWritable: false },
      { pubkey: configPda(), isSigner: false, isWritable: false },
      { pubkey: t, isSigner: false, isWritable: true },
      { pubkey: entryPda(t, wallet), isSigner: false, isWritable: true },
      { pubkey: tournamentVaultPda(t), isSigner: false, isWritable: true },
      { pubkey: associatedTokenAddress(mint, wallet), isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: discriminator(name),
  });
}
export const claimPrizeInstruction = (wallet: PublicKey, weekId: number, mint: PublicKey) => prizeInstruction('claim_prize', wallet, weekId, mint);
export const refundAllInstruction = (wallet: PublicKey, weekId: number, mint: PublicKey) => prizeInstruction('refund_all', wallet, weekId, mint);

/** 成就證明 canonical bytes 長度與 domain（與 backend lib/achievement.ts、attestation-core 一致） */
export const ACHIEVEMENT_LEN = 194;
export const ACHIEVEMENT_DOMAIN = 'NEONSHIFT_ACHIEVEMENT_V1';

/**
 * `claim_achievement`（PG-R-08）：緊接在 ed25519 驗簽指令之後；args 的 borsh 佈局恰等於 194-byte 訊息去掉 24-byte domain
 * （version、program_id、cluster_id、wallet、achievement_id、category、class、source_revision u32、rules_version u16、metadata_hash、issued_at、expiry、nonce）。
 */
export function claimAchievementInstruction(wallet: PublicKey, message: Uint8Array): TransactionInstruction {
  if (message.length !== ACHIEVEMENT_LEN || Buffer.from(message.subarray(0, 24)).toString('ascii') !== ACHIEVEMENT_DOMAIN) throw new RangeError('not a NEONSHIFT_ACHIEVEMENT_V1 message');
  const achievementId = message.subarray(90, 122);
  const msgWallet = new PublicKey(message.subarray(58, 90));
  if (!msgWallet.equals(wallet)) throw new RangeError('proof wallet mismatch');
  return new TransactionInstruction({
    programId: programId(),
    keys: [
      { pubkey: wallet, isSigner: true, isWritable: true },
      { pubkey: configPda(), isSigner: false, isWritable: false },
      { pubkey: eligibilityPda(wallet, achievementId), isSigner: false, isWritable: false },
      { pubkey: achievementPda(wallet, achievementId), isSigner: false, isWritable: true },
      { pubkey: achievementAssetPda(wallet, achievementId), isSigner: false, isWritable: true },
      { pubkey: MPL_CORE_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([discriminator('claim_achievement'), Buffer.from(message.subarray(24))]),
  });
}
