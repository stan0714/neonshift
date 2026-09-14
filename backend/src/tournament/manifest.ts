/**
 * 結算 manifest（PG-B-15，SD 6.2）：把排行榜轉成鏈上 `submit_results_batch` 需要的連續排名，
 * 並以與 `programs/neonshift-core/src/tournament_math.rs` 完全相同的 canonical bytes（85 bytes）與
 * SHA-256 rolling hash 產生 `begin_settlement` 的承諾值。三方向量見 manifest.test.ts。
 * - 名單 = 鏈上全部 TournamentEntry 去掉已沒收者（未回報步數者以 0 步排最後）。
 * - 排序 = BR-20（steps DESC → first_reached_at ASC → wallet base58 位元組序）。
 * - `first_reached_at` 無紀錄者以 0 編碼（鏈上只納入 hash，不影響金額）。
 */
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";

import type { EntryView } from "../chain/tournament.js";
import { compareLeaderboard } from "../store/leaderboard.js";
import type { TournamentStepsRow } from "../store/types.js";

export type ManifestItem = { rank: number; wallet: string; final_steps: number; first_reached_at: number; canonical_hex: string; rolling_hash_hex: string };
export type Manifest = { week_id: number; tournament: string; expected_count: number; results_hash_hex: string; forfeited: string[]; items: ManifestItem[] };

export const ZERO_HASH: Buffer = Buffer.alloc(32);

export function canonicalResult(tournament: Buffer, wallet: Buffer, finalSteps: bigint, firstReachedAt: bigint, rank: number, forfeited: boolean): Buffer {
  const out = Buffer.alloc(85);
  tournament.copy(out, 0);
  wallet.copy(out, 32);
  out.writeBigUInt64LE(finalSteps, 64);
  out.writeBigInt64LE(firstReachedAt, 72);
  out.writeUInt32LE(rank, 80);
  out.writeUInt8(forfeited ? 1 : 0, 84);
  return out;
}

export function roll(prev: Buffer, canonical: Buffer): Buffer {
  return createHash("sha256").update(prev).update(canonical).digest();
}

export function buildManifest(weekId: number, tournamentAddress: string, entries: EntryView[], steps: TournamentStepsRow[]): Manifest {
  const byWallet = new Map(steps.map((s) => [s.wallet, s]));
  const forfeited = entries.filter((e) => e.forfeited).map((e) => e.wallet);
  const rows: TournamentStepsRow[] = entries
    .filter((e) => !e.forfeited)
    .map((e) => byWallet.get(e.wallet) ?? { weekId, wallet: e.wallet, verifiedSteps: 0, firstReachedAt: null, updatedAt: new Date(0) });
  rows.sort(compareLeaderboard);
  const t = new PublicKey(tournamentAddress).toBuffer();
  let rolling: Buffer = ZERO_HASH;
  const items: ManifestItem[] = rows.map((r, i) => {
    const rank = i + 1;
    const firstReachedAt = r.firstReachedAt ? Math.floor(r.firstReachedAt.getTime() / 1000) : 0;
    const canonical = canonicalResult(t, new PublicKey(r.wallet).toBuffer(), BigInt(r.verifiedSteps), BigInt(firstReachedAt), rank, false);
    rolling = roll(rolling, canonical);
    return { rank, wallet: r.wallet, final_steps: r.verifiedSteps, first_reached_at: firstReachedAt, canonical_hex: canonical.toString("hex"), rolling_hash_hex: rolling.toString("hex") };
  });
  return { week_id: weekId, tournament: tournamentAddress, expected_count: items.length, results_hash_hex: rolling.toString("hex"), forfeited, items };
}
