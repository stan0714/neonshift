/**
 * 鏈上程式常數與 PDA（SD 3.1）。IDL 由 scripts/chain/build.sh 從 programs/target 複製，
 * 與後端／tools 共用同一份，不手改。
 */
import { PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';

import { APP_CONFIG } from '@/config/app';

import idl from './idl/neonshift_core.json';

export const NEONSHIFT_IDL = idl;

export function programId(): PublicKey {
  if (!APP_CONFIG.chainConfigured) throw new Error('EXPO_PUBLIC_PROGRAM_ID is not set for this build');
  return new PublicKey(APP_CONFIG.programId);
}

export const configPda = () => PublicKey.findProgramAddressSync([Buffer.from('config')], programId())[0];
export const playerPda = (wallet: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from('player'), wallet.toBytes()], programId())[0];
export const claimPda = (wallet: PublicKey, taskDate: number, taskType: number) => {
  const date = Buffer.alloc(4);
  date.writeUInt32LE(taskDate, 0);
  return PublicKey.findProgramAddressSync([Buffer.from('claim'), wallet.toBytes(), date, Buffer.from([taskType])], programId())[0];
};

/** 8-byte Anchor discriminator，直接取自 IDL，避免與程式不同步 */
export function discriminator(instruction: string): Buffer {
  const ix = (idl as { instructions: { name: string; discriminator: number[] }[] }).instructions.find((i) => i.name === instruction);
  if (!ix) throw new Error(`IDL 沒有指令 ${instruction}`);
  return Buffer.from(ix.discriminator);
}

/** PlayerProfile 帳戶大小（8 + InitSpace）：wallet 32 + core 1 + shoe 1 + xp 8 + last 4 + streak 2 + claimed 8 + today 4 + bump 1 */
export const PLAYER_PROFILE_SPACE = 8 + 61;
