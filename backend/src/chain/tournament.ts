/**
 * 鏈上 Tournament／TournamentEntry 的 PDA 與解碼（SD 3.1；佈局以 programs/neonshift-core/src/state.rs 為準）。
 * 後端只讀鏈上狀態，不簽任何交易。
 */
import { PublicKey } from "@solana/web3.js";

export const TOURNAMENT_STATUS = ["draft", "registration", "locked", "running", "settling", "settled", "cancelled"] as const;
export type TournamentStatus = (typeof TOURNAMENT_STATUS)[number];

export type TournamentView = {
  address: string;
  weekId: number;
  status: TournamentStatus;
  vault: string;
  stakeAmount: bigint;
  totalStaked: bigint;
  treasuryInjectionCap: bigint;
  treasuryInjection: bigint;
  entrantCount: number;
  validEntrantCount: number;
  forfeitedCount: number;
  groupASize: number;
  groupBSize: number;
  distributablePool: bigint;
  distributed: bigint;
  totalRefund: bigint;
  totalPrize: bigint;
  treasuryRemainder: bigint;
  resultsSubmitted: number;
  resultsHash: Buffer;
  resultsRollingHash: Buffer;
  minEntrants: number;
  registrationEndsAt: number;
  startsAt: number;
  endsAt: number;
  rulesVersion: number;
  prizeABps: number;
  prizeBBps: number;
  loserRefundBps: number;
  createdAt: number;
};

export function tournamentPda(programId: PublicKey, weekId: number): PublicKey {
  const le = Buffer.alloc(4);
  le.writeUInt32LE(weekId);
  return PublicKey.findProgramAddressSync([Buffer.from("tournament"), le], programId)[0];
}

export function entryPda(programId: PublicKey, tournament: PublicKey, wallet: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("entry"), tournament.toBuffer(), wallet.toBuffer()], programId)[0];
}

export function decodeTournament(address: PublicKey, data: Buffer): TournamentView {
  let o = 8;
  const u8 = () => data.readUInt8(o++);
  const u16 = () => {
    const v = data.readUInt16LE(o);
    o += 2;
    return v;
  };
  const u32 = () => {
    const v = data.readUInt32LE(o);
    o += 4;
    return v;
  };
  const u64 = () => {
    const v = data.readBigUInt64LE(o);
    o += 8;
    return v;
  };
  const i64 = () => {
    const v = data.readBigInt64LE(o);
    o += 8;
    return Number(v);
  };
  const key = () => {
    const v = new PublicKey(data.subarray(o, o + 32)).toBase58();
    o += 32;
    return v;
  };
  const hash = () => {
    const v = Buffer.from(data.subarray(o, o + 32));
    o += 32;
    return v;
  };
  const weekId = u32();
  const statusIdx = u8();
  const status = TOURNAMENT_STATUS[statusIdx];
  if (!status) throw new Error(`unknown tournament status ${statusIdx}`);
  return {
    address: address.toBase58(),
    weekId,
    status,
    vault: key(),
    stakeAmount: u64(),
    totalStaked: u64(),
    treasuryInjectionCap: u64(),
    treasuryInjection: u64(),
    entrantCount: u32(),
    validEntrantCount: u32(),
    forfeitedCount: u32(),
    groupASize: u32(),
    groupBSize: u32(),
    distributablePool: u64(),
    distributed: u64(),
    totalRefund: u64(),
    totalPrize: u64(),
    treasuryRemainder: u64(),
    resultsSubmitted: u32(),
    resultsHash: hash(),
    resultsRollingHash: hash(),
    minEntrants: u32(),
    registrationEndsAt: i64(),
    startsAt: i64(),
    endsAt: i64(),
    rulesVersion: u16(),
    prizeABps: u16(),
    prizeBBps: u16(),
    loserRefundBps: u16(),
    createdAt: i64(),
  };
}

/** ISO week-based year × 100 + ISO week（SD 3.1 `week_id`），以 UTC 計 */
export function weekIdOf(date: Date): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7; // 週一 = 1 … 週日 = 7
  d.setUTCDate(d.getUTCDate() + 4 - day); // 移到本週四，決定 ISO 年
  const isoYear = d.getUTCFullYear();
  const yearStart = Date.UTC(isoYear, 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return isoYear * 100 + week;
}

/** 下一個 week_id（跨年時以下一週四的 ISO 年為準） */
export function nextWeekId(weekId: number, now: Date): number {
  const next = new Date(now.getTime() + 7 * 86_400_000);
  const n = weekIdOf(next);
  return n > weekId ? n : weekId + 1;
}
