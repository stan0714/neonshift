import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import type { EntryView } from "../chain/tournament.js";
import { buildManifest, canonicalResult, roll, ZERO_HASH } from "./manifest.js";

describe("PG-B-15 settlement manifest（與 tournament_math.rs 同一 canonical／rolling）", () => {
  it("三方向量：Python 產生、Rust rolling_hash_cross_language_vector、TS 皆為 e6f93404…", () => {
    const t = Buffer.alloc(32, 1);
    const items: [number, bigint, bigint, number][] = [[2, 50_000n, 1_789_180_000n, 1], [3, 49_000n, 1_789_180_001n, 2], [4, 0n, 0n, 3]];
    let h: Buffer = ZERO_HASH;
    for (const [w, steps, at, rank] of items) h = roll(h, canonicalResult(t, Buffer.alloc(32, w), steps, at, rank, false));
    expect(h.toString("hex")).toBe("e6f93404e2b0f0aafad67dd3114925b07e0a50373a8e4c90351809f0e8868157");
    expect(canonicalResult(t, Buffer.alloc(32, 2), 12_345n, 1_789_000_000n, 7, true)).toHaveLength(85);
  });

  it("名單 = 全體報名者去掉沒收者；未回報者 0 步、first_reached_at 0 排最後；rank 連續；hash 鏈一致", () => {
    const wallets = Array.from({ length: 5 }, () => PublicKey.unique().toBase58());
    const entry = (wallet: string, forfeited = false): EntryView => ({ wallet, stake: 0n, finalSteps: 0n, rank: 0, group: 0, forfeited, settled: false, joinedAt: 0 });
    const entries = [entry(wallets[0]!), entry(wallets[1]!), entry(wallets[2]!, true), entry(wallets[3]!), entry(wallets[4]!)];
    const t0 = 1_789_000_000;
    const steps = [
      { weekId: 2026_38, wallet: wallets[0]!, verifiedSteps: 10_000, firstReachedAt: new Date((t0 + 500) * 1000), updatedAt: new Date() },
      { weekId: 2026_38, wallet: wallets[1]!, verifiedSteps: 12_000, firstReachedAt: new Date((t0 + 900) * 1000), updatedAt: new Date() },
      { weekId: 2026_38, wallet: wallets[2]!, verifiedSteps: 99_000, firstReachedAt: new Date((t0 + 1) * 1000), updatedAt: new Date() }, // 沒收者：不入榜
      { weekId: 2026_38, wallet: wallets[3]!, verifiedSteps: 10_000, firstReachedAt: new Date((t0 + 400) * 1000), updatedAt: new Date() },
    ];
    const tournament = PublicKey.unique().toBase58();
    const m = buildManifest(2026_38, tournament, entries, steps);
    expect(m.forfeited).toEqual([wallets[2]]);
    expect(m.expected_count).toBe(4);
    expect(m.items.map((i) => [i.rank, i.wallet, i.final_steps, i.first_reached_at])).toEqual([
      [1, wallets[1], 12_000, t0 + 900],
      [2, wallets[3], 10_000, t0 + 400],
      [3, wallets[0], 10_000, t0 + 500],
      [4, wallets[4], 0, 0],
    ]);
    // 逐筆重算 rolling
    let h: Buffer = ZERO_HASH;
    const tb = new PublicKey(tournament).toBuffer();
    for (const it of m.items) {
      h = roll(h, canonicalResult(tb, new PublicKey(it.wallet).toBuffer(), BigInt(it.final_steps), BigInt(it.first_reached_at), it.rank, false));
      expect(it.rolling_hash_hex).toBe(h.toString("hex"));
    }
    expect(m.results_hash_hex).toBe(h.toString("hex"));
    // 空名單：承諾 = 零值
    expect(buildManifest(2026_38, tournament, [entry(wallets[2]!, true)], []).results_hash_hex).toBe(ZERO_HASH.toString("hex"));
  });
});
