/** 鏈上帳戶解碼（SD 3.1）；佈局與 programs/neonshift-core/src/state.rs 一致 */
import type { Connection, PublicKey } from '@solana/web3.js';

export type PlayerProfile = {
  wallet: PublicKey;
  coreLevel: number;
  shoeLevel: number;
  xp: bigint;
  lastTaskDate: number;
  streakDays: number;
  claimedToday: bigint;
  todayDate: number;
};

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
  const claimedToday = dv.getBigUint64(o, true);
  o += 8;
  const todayDate = dv.getUint32(o, true);
  return { wallet, coreLevel, shoeLevel, xp, lastTaskDate, streakDays, claimedToday, todayDate };
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
