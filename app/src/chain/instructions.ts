import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';

import { configPda, discriminator, playerPda, programId } from './program';

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
