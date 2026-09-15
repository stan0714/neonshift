/** 鏈上帳戶解碼（SD 3.1）；佈局與 programs/neonshift-core/src/state.rs 一致 */
import type { Connection, PublicKey } from '@solana/web3.js';

export type PlayerProfile = {
  wallet: PublicKey;
  coreLevel: number;
  shoeLevel: number;
  xp: bigint;
  lastTaskDate: number;
  streakDays: number;
  /** 歷史最高連續天數（7 天徽章資格） */
  maxStreakDays: number;
  claimedToday: bigint;
  todayDate: number;
  // ---- PG-V-02 維持挑戰；舊帳戶（63 bytes）→ migrated=false、其餘為預設 ----
  migrated: boolean;
  highestLevel: number;
  epochAnchor: number;
  lastSettledEpoch: number;
  epochPoints: number;
  epochBitmap: number;
  maintenanceRulesVersion: number;
};

/** PG-V-05：incident freeze（start == end == 0 為無凍結） */
export type IncidentFreeze = { start: number; end: number; setAt: number; reasonHash: Uint8Array };
export function decodeIncidentFreeze(data: Uint8Array): IncidentFreeze {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return { start: Number(dv.getBigInt64(8, true)), end: Number(dv.getBigInt64(16, true)), setAt: Number(dv.getBigInt64(24, true)), reasonHash: data.slice(32, 64) };
}
export const freezeActive = (f: IncidentFreeze | null, nowSec: number) => !!f && f.end > f.start && nowSec >= f.start && nowSec < f.end;

/** PG-V-02：與 programs/.../maintenance.rs 一致的期索引 */
export const EPOCH_DAYS = 7;
export const epochIndexOf = (anchor: number, taskDate: number) => Math.floor(Math.max(0, taskDate - anchor) / EPOCH_DAYS);
/** clock_in 可順帶結算的期數上限（MAX_INLINE_SETTLE_EPOCHS）；超過須先 settle_player_epochs */
export const MAX_INLINE_SETTLE_EPOCHS = 8;
/** 需要先做的維持動作：遷移／補結算（期數） */
export function maintenanceNeeds(profile: PlayerProfile | null, todayTaskDate: number, freezeExists = false): { migrate: boolean; pendingEpochs: number; freezeExists: boolean } {
  if (!profile) return { migrate: false, pendingEpochs: 0, freezeExists };
  if (!profile.migrated) return { migrate: true, pendingEpochs: 0, freezeExists };
  return { migrate: false, pendingEpochs: Math.max(0, epochIndexOf(profile.epochAnchor, todayTaskDate) - profile.lastSettledEpoch), freezeExists };
}

export type ChainConfig = {
  clusterId: number;
  attestorPubkey: Uint8Array;
  mint: PublicKey;
  rewardVault: PublicKey;
  dailyCap: bigint;
  baseStepsReward: bigint;
  baseSleepReward: bigint;
  coreMultiplierBps: number[];
  shoeXpThresholds: bigint[];
  paused: boolean;
};

export function decodePlayerProfile(data: Uint8Array, PublicKeyCtor: { new (v: Uint8Array): PublicKey }): PlayerProfile {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = 8; // discriminator
  const wallet = new PublicKeyCtor(data.subarray(o, o + 32));
  o += 32;
  const coreLevel = data[o++]!;
  const shoeLevel = data[o++]!;
  const xp = dv.getBigUint64(o, true);
  o += 8;
  const lastTaskDate = dv.getUint32(o, true);
  o += 4;
  const streakDays = dv.getUint16(o, true);
  o += 2;
  const maxStreakDays = dv.getUint16(o, true);
  o += 2;
  const claimedToday = dv.getBigUint64(o, true);
  o += 8;
  const todayDate = dv.getUint32(o, true);
  o += 4;
  o += 1; // bump
  const migrated = data.byteLength >= o + 14;
  const highestLevel = migrated ? data[o]! : Math.max(coreLevel, shoeLevel);
  const epochAnchor = migrated ? dv.getUint32(o + 1, true) : 0;
  const lastSettledEpoch = migrated ? dv.getUint32(o + 5, true) : 0;
  const epochPoints = migrated ? dv.getUint16(o + 9, true) : 0;
  const epochBitmap = migrated ? data[o + 11]! : 0;
  const maintenanceRulesVersion = migrated ? dv.getUint16(o + 12, true) : 0;
  return { wallet, coreLevel, shoeLevel, xp, lastTaskDate, streakDays, maxStreakDays, claimedToday, todayDate, migrated, highestLevel, epochAnchor, lastSettledEpoch, epochPoints, epochBitmap, maintenanceRulesVersion };
}

export function decodeConfig(data: Uint8Array, PublicKeyCtor: { new (v: Uint8Array): PublicKey }): ChainConfig {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = 8;
  o += 32; // admin
  const clusterId = data[o++]!;
  const attestorPubkey = data.slice(o, o + 32);
  o += 32;
  o += 8; // attestor_valid_from
  o += 32; // prev_attestor_pubkey
  o += 8; // prev_attestor_valid_until
  const mint = new PublicKeyCtor(data.subarray(o, o + 32));
  o += 32;
  o += 1; // mint_decimals
  const rewardVault = new PublicKeyCtor(data.subarray(o, o + 32));
  o += 32;
  o += 32; // treasury_vault
  const dailyCap = dv.getBigUint64(o, true);
  o += 8;
  const baseStepsReward = dv.getBigUint64(o, true);
  o += 8;
  const baseSleepReward = dv.getBigUint64(o, true);
  o += 8;
  o += 1; // streak_enabled
  o += 2; // streak_bonus_bps
  o += 2; // burn_bps
  const coreMultiplierBps: number[] = [];
  for (let i = 0; i < 5; i++) {
    coreMultiplierBps.push(dv.getUint16(o, true));
    o += 2;
  }
  o += 8 * 4; // core_upgrade_costs
  const shoeXpThresholds: bigint[] = [];
  for (let i = 0; i < 5; i++) {
    shoeXpThresholds.push(dv.getBigUint64(o, true));
    o += 8;
  }
  const paused = data[o]! === 1;
  return { clusterId, attestorPubkey, mint, rewardVault, dailyCap, baseStepsReward, baseSleepReward, coreMultiplierBps, shoeXpThresholds, paused };
}

export async function fetchAccount<T>(conn: Connection, address: PublicKey, decode: (d: Uint8Array) => T): Promise<T | null> {
  const info = await conn.getAccountInfo(address, 'confirmed');
  return info ? decode(new Uint8Array(info.data)) : null;
}

/** TournamentEntry（state.rs）：8 | tournament 32 | wallet 32 | stake u64 | final_steps u64 | rank u32 | group u8 | forfeited | settled | evidence 32 | joined_at i64 | bump */
export type TournamentEntry = { stake: bigint; finalSteps: bigint; rank: number; group: number; forfeited: boolean; settled: boolean; joinedAt: number };

export function decodeTournamentEntry(data: Uint8Array): TournamentEntry {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = 8 + 64;
  const stake = dv.getBigUint64(o, true);
  o += 8;
  const finalSteps = dv.getBigUint64(o, true);
  o += 8;
  const rank = dv.getUint32(o, true);
  o += 4;
  const group = data[o++]!;
  const forfeited = data[o++] === 1;
  const settled = data[o++] === 1;
  o += 32;
  const joinedAt = Number(dv.getBigInt64(o, true));
  return { stake, finalSteps, rank, group, forfeited, settled, joinedAt };
}
