import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';

import { Buffer } from 'buffer';

import { assetPda, collectiblePda, configPda, discriminator, entryPda, MPL_CORE_PROGRAM_ID, playerPda, programId, tournamentPda, tournamentVaultPda } from './program';
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
