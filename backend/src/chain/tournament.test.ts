import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import { decodeTournament, entryPda, nextWeekId, tournamentPda, weekIdOf } from "./tournament.js";

describe("ISO week_id（SD 3.1）", () => {
  it("year×100+week，跨年週以 ISO 年為準", () => {
    expect(weekIdOf(new Date("2026-09-14T00:00:00Z"))).toBe(2026_38); // 週一
    expect(weekIdOf(new Date("2026-09-20T23:59:59Z"))).toBe(2026_38); // 週日
    expect(weekIdOf(new Date("2026-09-21T00:00:00Z"))).toBe(2026_39);
    expect(weekIdOf(new Date("2027-01-01T12:00:00Z"))).toBe(2026_53); // 2027-01-01 是週五，屬 2026 W53
    expect(weekIdOf(new Date("2024-12-30T00:00:00Z"))).toBe(2025_01); // 週一，屬 2025 W1
    expect(nextWeekId(2026_53, new Date("2027-01-01T12:00:00Z"))).toBe(2027_01);
    expect(nextWeekId(2026_38, new Date("2026-09-14T00:00:00Z"))).toBe(2026_39);
  });
});

describe("Tournament 解碼（與 state.rs 佈局一致）", () => {
  const programId = new PublicKey("6MhVoQHdEpY2hqkaNJMkT2vHWakfnGfEYDgCtJzh6ENA");
  it("PDA 與 App／程式一致；解碼所有欄位", () => {
    const t = tournamentPda(programId, 2026_38);
    const wallet = PublicKey.unique();
    expect(entryPda(programId, t, wallet)).toBeInstanceOf(PublicKey);
    const buf = Buffer.alloc(8 + 4 + 1 + 32 + 8 * 4 + 4 * 5 + 8 * 5 + 4 + 32 + 32 + 4 + 8 * 3 + 2 * 4 + 8 + 1);
    let o = 8;
    buf.writeUInt32LE(2026_38, o); o += 4;
    buf.writeUInt8(3, o); o += 1; // running
    PublicKey.unique().toBuffer().copy(buf, o); o += 32;
    for (const v of [50_000_000n, 500_000_000n, 1_000_000_000n, 600_000_000n]) { buf.writeBigUInt64LE(v, o); o += 8; }
    for (const v of [10, 10, 1, 1, 2]) { buf.writeUInt32LE(v, o); o += 4; }
    for (const v of [775_000_000n, 0n, 325_000_000n, 700_000_000n, 75_000_000n]) { buf.writeBigUInt64LE(v, o); o += 8; }
    buf.writeUInt32LE(0, o); o += 4;
    o += 64; // hashes
    buf.writeUInt32LE(10, o); o += 4;
    for (const v of [1_789_003_600n, 1_789_007_200n, 1_789_180_000n]) { buf.writeBigInt64LE(v, o); o += 8; }
    for (const v of [3, 6000, 4000, 5000]) { buf.writeUInt16LE(v, o); o += 2; }
    buf.writeBigInt64LE(1_789_000_000n, o); o += 8;
    buf.writeUInt8(254, o);
    const v = decodeTournament(t, buf);
    expect(v).toMatchObject({ weekId: 2026_38, status: "running", stakeAmount: 50_000_000n, treasuryInjection: 600_000_000n, entrantCount: 10, groupASize: 1, groupBSize: 2, distributablePool: 775_000_000n, treasuryRemainder: 75_000_000n, minEntrants: 10, startsAt: 1_789_007_200, endsAt: 1_789_180_000, rulesVersion: 3, prizeABps: 6000, loserRefundBps: 5000, createdAt: 1_789_000_000 });
    expect(v.address).toBe(t.toBase58());
  });
});
