import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';

import { Buffer } from 'buffer';

import { assetPda, collectiblePda, configPda, discriminator, MPL_CORE_PROGRAM_ID, playerPda, programId } from './program';

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
