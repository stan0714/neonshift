/**
 * TxBuilder（PG-A-09，SD 3.5／5.1）：組 ed25519 前置指令 + clock_in；不送出、不重試。
 * 指令順序固定：ed25519 在前、程式指令在後；signature／pubkey／message offsets 全部自我引用。
 */
import { PublicKey, SystemProgram, SYSVAR_INSTRUCTIONS_PUBKEY, TransactionInstruction } from '@solana/web3.js';
import { Buffer } from 'buffer';

import { ATTESTATION_LEN, decodeAttestation, encodeAttestationArgs, type AttestationFields } from './attestation';
import { claimPda, configPda, discriminator, playerPda, programId } from './program';

export const ED25519_PROGRAM_ID = new PublicKey('Ed25519SigVerify111111111111111111111111111');
export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

/** 與 solana-ed25519-program `new_ed25519_instruction_with_signature` 相同的佈局：header(2)+offsets(14)+pubkey(32)+sig(64)+message */
export function ed25519Instruction(message: Uint8Array, signature: Uint8Array, pubkey: Uint8Array): TransactionInstruction {
  // 兩種 canonical 訊息：164-byte 打卡 attestation、194-byte 成就證明（PG-R-08）
  if (message.length !== ATTESTATION_LEN && message.length !== 194) throw new Error('message must be 164 or 194 bytes');
  if (signature.length !== 64 || pubkey.length !== 32) throw new Error('bad signature/pubkey length');
  const DATA_START = 16;
  const pubkeyOffset = DATA_START;
  const sigOffset = pubkeyOffset + 32;
  const msgOffset = sigOffset + 64;
  const data = new Uint8Array(msgOffset + message.length);
  const dv = new DataView(data.buffer);
  data[0] = 1; // num_signatures
  data[1] = 0; // padding
  const SELF = 0xffff;
  dv.setUint16(2, sigOffset, true);
  dv.setUint16(4, SELF, true);
  dv.setUint16(6, pubkeyOffset, true);
  dv.setUint16(8, SELF, true);
  dv.setUint16(10, msgOffset, true);
  dv.setUint16(12, message.length, true);
  dv.setUint16(14, SELF, true);
  data.set(pubkey, pubkeyOffset);
  data.set(signature, sigOffset);
  data.set(message, msgOffset);
  return new TransactionInstruction({ programId: ED25519_PROGRAM_ID, keys: [], data: Buffer.from(data) });
}

export function associatedTokenAddress(mint: PublicKey, owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([owner.toBytes(), TOKEN_PROGRAM_ID.toBytes(), mint.toBytes()], ASSOCIATED_TOKEN_PROGRAM_ID)[0];
}

/** ATA 不存在時建立（idempotent，指令 1）；由 player 付 rent */
export function createAtaIdempotentInstruction(payer: PublicKey, mint: PublicKey, owner: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: associatedTokenAddress(mint, owner), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

export type ClockInAccounts = { mint: PublicKey; rewardVault: PublicKey };

/** clock_in 指令（帳戶順序與 programs/neonshift-core ClockIn struct 一致） */
export function clockInInstruction(player: PublicKey, fields: AttestationFields, accts: ClockInAccounts): TransactionInstruction {
  const data = Buffer.concat([discriminator('clock_in'), Buffer.from(encodeAttestationArgs(fields))]);
  return new TransactionInstruction({
    programId: programId(),
    keys: [
      { pubkey: player, isSigner: true, isWritable: true },
      { pubkey: configPda(), isSigner: false, isWritable: false },
      { pubkey: playerPda(player), isSigner: false, isWritable: true },
      { pubkey: claimPda(player, fields.taskDate, fields.taskType), isSigner: false, isWritable: true },
      { pubkey: accts.mint, isSigner: false, isWritable: false },
      { pubkey: accts.rewardVault, isSigner: false, isWritable: true },
      { pubkey: associatedTokenAddress(accts.mint, player), isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export type ClaimTxInput = {
  player: PublicKey;
  attestation: { message_b64: string; signature_b64: string; attestor_pubkey_bytes: Uint8Array };
  accts: ClockInAccounts;
};

/**
 * 整筆打卡交易的指令：[ATA idempotent, ed25519, clock_in]。
 * 回傳解析後欄位供 UI／冪等查詢（ClaimReceipt PDA）。
 */
export function buildClaimInstructions(input: ClaimTxInput): { instructions: TransactionInstruction[]; fields: AttestationFields; receipt: PublicKey } {
  const message = new Uint8Array(Buffer.from(input.attestation.message_b64, 'base64'));
  const signature = new Uint8Array(Buffer.from(input.attestation.signature_b64, 'base64'));
  const fields = decodeAttestation(message);
  if (!fields.wallet.equals(input.player)) throw new Error('attestation wallet does not match signer');
  if (!fields.programId.equals(programId())) throw new Error('attestation program id does not match this build');
  const instructions = [
    createAtaIdempotentInstruction(input.player, input.accts.mint, input.player),
    ed25519Instruction(message, signature, input.attestation.attestor_pubkey_bytes),
    clockInInstruction(input.player, fields, input.accts),
  ];
  return { instructions, fields, receipt: claimPda(input.player, fields.taskDate, fields.taskType) };
}
