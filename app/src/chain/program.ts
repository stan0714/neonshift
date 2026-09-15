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

/** 成就 NFT 領取紀錄 PDA `["collectible", wallet, kind]`（SD 3.2） */
export const collectiblePda = (wallet: PublicKey, kind: number) => PublicKey.findProgramAddressSync([Buffer.from('collectible'), wallet.toBytes(), Buffer.from([kind])], programId())[0];
/** 成就 NFT asset PDA `["asset", wallet, kind]`：Metaplex Core asset 位址，由程式 invoke_signed 建立 */
export const assetPda = (wallet: PublicKey, kind: number) => PublicKey.findProgramAddressSync([Buffer.from('asset'), wallet.toBytes(), Buffer.from([kind])], programId())[0];

/** 錦標賽 PDA（SD 3.1）：`["tournament", week_id_le]`、vault `["vault", tournament]`、entry `["entry", tournament, wallet]` */
export const tournamentPda = (weekId: number) => {
  const le = Buffer.alloc(4);
  le.writeUInt32LE(weekId, 0);
  return PublicKey.findProgramAddressSync([Buffer.from('tournament'), le], programId())[0];
};
export const tournamentVaultPda = (tournament: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from('vault'), tournament.toBytes()], programId())[0];
export const entryPda = (tournament: PublicKey, wallet: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from('entry'), tournament.toBytes(), wallet.toBytes()], programId())[0];

/** Metaplex Core（SD 11A） */
export const MPL_CORE_PROGRAM_ID = new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d');

/** 8-byte Anchor discriminator，直接取自 IDL，避免與程式不同步 */
export function discriminator(instruction: string): Buffer {
  const ix = (idl as { instructions: { name: string; discriminator: number[] }[] }).instructions.find((i) => i.name === instruction);
  if (!ix) throw new Error(`IDL 沒有指令 ${instruction}`);
  return Buffer.from(ix.discriminator);
}

/** PlayerProfile 帳戶大小（8 + InitSpace）：wallet 32 + core 1 + shoe 1 + xp 8 + last 4 + streak 2 + max_streak 2 + claimed 8 + today 4 + bump 1 ＋ PG-V-02 highest 1 + anchor 4 + settled 4 + points 2 + bitmap 1 + rules 2 */
export const PLAYER_PROFILE_SPACE = 8 + 63 + 14;
/** PG-V-05：全域 incident freeze PDA `["freeze"]`（不存在時指令傳 program id 表示 None） */
export const freezePda = () => PublicKey.findProgramAddressSync([Buffer.from('freeze')], programId())[0];
/** PG-V-02 前的舊版長度（migrate_player 前） */
export const PLAYER_PROFILE_V1_SPACE = 8 + 63;
// PG-R-08：成就 NFT（每個 achievement_id 一枚）
export const eligibilityPda = (wallet: PublicKey, achievementId: Uint8Array) => PublicKey.findProgramAddressSync([Buffer.from('eligibility'), wallet.toBytes(), Buffer.from(achievementId)], programId())[0];
export const achievementPda = (wallet: PublicKey, achievementId: Uint8Array) => PublicKey.findProgramAddressSync([Buffer.from('achievement'), wallet.toBytes(), Buffer.from(achievementId)], programId())[0];
export const achievementAssetPda = (wallet: PublicKey, achievementId: Uint8Array) => PublicKey.findProgramAddressSync([Buffer.from('aasset'), wallet.toBytes(), Buffer.from(achievementId)], programId())[0];
