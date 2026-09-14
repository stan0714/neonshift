/**
 * PostgresStore 整合測試：需要 TEST_DATABASE_URL（已套用 migrations）。
 * scripts/test-all.sh 與 CI 會提供；本機未設定時整檔略過。
 */
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MemoryStore } from "./memory.js";
import { PostgresStore } from "./postgres.js";
import type { Store } from "./types.js";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("PostgresStore 與 MemoryStore 行為一致", () => {
  let pool: pg.Pool;
  let stores: { name: string; store: Store }[];

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    await pool.query("DELETE FROM gallery_collectibles; DELETE FROM gallery_players; DELETE FROM chain_cursor; DELETE FROM chain_events; DELETE FROM tournament_steps; DELETE FROM claim_results; DELETE FROM attestations; DELETE FROM health_snapshots; DELETE FROM auth_sessions; DELETE FROM auth_challenges; DELETE FROM players;");
    stores = [
      { name: "postgres", store: new PostgresStore(pool) },
      { name: "memory", store: new MemoryStore() },
    ];
  });
  afterAll(async () => {
    await pool?.end();
  });

  it("challenge 只能消耗一次，過期不可消耗", async () => {
    for (const { name, store } of stores) {
      const now = new Date();
      const hash = randomBytes(32);
      await store.insertChallenge({ nonceHash: hash, wallet: "w" + randomUUID().slice(0, 8), purpose: "login", requestHash: null, taskDate: null, taskType: null, expiresAt: new Date(now.getTime() + 60_000), usedAt: null });
      expect(await store.consumeChallenge(hash, now), name).not.toBeNull();
      expect(await store.consumeChallenge(hash, now), name).toBeNull();

      const expired = randomBytes(32);
      await store.insertChallenge({ nonceHash: expired, wallet: "w", purpose: "login", requestHash: null, taskDate: null, taskType: null, expiresAt: new Date(now.getTime() - 1), usedAt: null });
      expect(await store.consumeChallenge(expired, now), name).toBeNull();
    }
  });

  it("並發消耗同一 challenge 只有一個成功（原子 UPDATE）", async () => {
    const store = stores[0]!.store;
    const now = new Date();
    const hash = randomBytes(32);
    await store.insertChallenge({ nonceHash: hash, wallet: "w", purpose: "login", requestHash: null, taskDate: null, taskType: null, expiresAt: new Date(now.getTime() + 60_000), usedAt: null });
    const results = await Promise.all(Array.from({ length: 8 }, () => store.consumeChallenge(hash, now)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("session 輪替與 family 撤銷", async () => {
    for (const { name, store } of stores) {
      const now = new Date();
      const wallet = "w" + randomUUID().slice(0, 8);
      await store.upsertPlayer(wallet, now);
      const family = randomUUID();
      const a = { jti: randomUUID(), familyId: family, wallet, refreshHash: randomBytes(32), expiresAt: new Date(now.getTime() + 60_000), usedAt: null, rotatedTo: null, revokedAt: null };
      const b = { ...a, jti: randomUUID(), refreshHash: randomBytes(32) };
      await store.insertSession(a);
      await store.insertSession(b);
      await store.rotateSession(a.jti, b.jti, now);
      expect((await store.getSession(a.jti))?.rotatedTo, name).toBe(b.jti);
      expect((await store.getSessionByRefreshHash(b.refreshHash))?.jti, name).toBe(b.jti);
      expect(await store.revokeFamily(family, now), name).toBe(2);
      expect((await store.getSession(b.jti))?.revokedAt, name).not.toBeNull();
      expect(await store.revokeFamily(family, now), name).toBe(0);
    }
  });

  it("upsertPlayer 更新 last_seen 且保留 first_seen", async () => {
    for (const { name, store } of stores) {
      const wallet = "w" + randomUUID().slice(0, 8);
      const t1 = new Date("2026-09-14T00:00:00Z");
      const t2 = new Date("2026-09-14T01:00:00Z");
      const p1 = await store.upsertPlayer(wallet, t1);
      const p2 = await store.upsertPlayer(wallet, t2);
      expect(p1.firstSeenAt.getTime(), name).toBe(t1.getTime());
      expect(p2.firstSeenAt.getTime(), name).toBe(t1.getTime());
      expect(p2.lastSeenAt.getTime(), name).toBe(t2.getTime());
    }
  });

  it("claim idempotency：beginClaim 只有一個取得處理權；complete 後回既有；release 只刪 processing", async () => {
    for (const { name, store } of stores) {
      const now = new Date();
      const wallet = "w" + randomUUID().slice(0, 8);
      await store.upsertPlayer(wallet, now);
      const key = randomUUID();
      const rh = randomBytes(32);
      const results = await Promise.all(Array.from({ length: 6 }, () => store.beginClaim(wallet, key, rh, now)));
      expect(results.filter((r) => r.acquired), name).toHaveLength(1);
      expect(results.filter((r) => !r.acquired && r.existing?.status === "processing"), name).toHaveLength(5);
      await store.completeClaim(wallet, key, "succeeded", 200, { ok: true }, now);
      const again = await store.beginClaim(wallet, key, rh, now);
      expect(again.existing?.status, name).toBe("succeeded");
      expect(again.existing?.response, name).toEqual({ ok: true });
      await store.releaseClaim(wallet, key);
      expect((await store.beginClaim(wallet, key, rh, now)).acquired, name).toBe(false);
    }
  });

  it("deletePlayerData：撤銷 session、刪 snapshot（CASCADE decision）／attestation／claim_results，並標記 deleted_at；歷史只回本人", async () => {
    for (const { name, store } of stores) {
      const now = new Date();
      const wallet = "w" + randomUUID().slice(0, 8);
      await store.upsertPlayer(wallet, now);
      await store.insertSession({ jti: randomUUID(), familyId: randomUUID(), wallet, refreshHash: randomBytes(32), expiresAt: new Date(now.getTime() + 1000), usedAt: null, rotatedTo: null, revokedAt: null });
      const sid = await store.insertHealthSnapshot({ wallet, taskDate: 20_710, taskType: 1, attributedSteps: 1, sleepMinutes: null, sourceSummary: [], stepRateSummary: null, sleepOverlapMinutes: null, sensorSummary: null, motionSummary: null, clientInfo: {}, inputHash: randomBytes(32) });
      await store.insertRiskDecision({ snapshotId: sid, rulesVersion: 3, riskScore: 0, matchedRules: [], decision: "pass", rejectCode: null });
      await store.ensureRuleSet({ rulesVersion: 3, rulesHash: randomBytes(32), config: {} }).catch(() => {});
      await store.insertAttestation({ nonce: randomBytes(16), idempotencyKey: randomUUID(), requestHash: randomBytes(32), wallet, taskDate: 20_710, taskType: 1, rulesVersion: 3, evidenceHash: randomBytes(32), issuedAt: now, expiresAt: new Date(now.getTime() + 600_000) });
      await store.beginClaim(wallet, randomUUID(), randomBytes(32), now);
      expect(await store.listHistory(wallet, 20_700), name).toHaveLength(1);
      const r = await store.deletePlayerData(wallet, now, null);
      expect(r, name).toMatchObject({ deferred: false, deleted: { snapshots: 1, attestations: 1, claimResults: 1, sessions: 1 } });
      expect(await store.listHistory(wallet, 20_700), name).toHaveLength(0);
      expect((await store.getPlayer(wallet))?.deletedAt, name).not.toBeNull();
      // 重新登入（upsert）視為新同意
      expect((await store.upsertPlayer(wallet, now)).deletedAt, name).toBeNull();
    }
  });

  it("tournament_steps：單調不減 upsert、BR-20 排序（步數 DESC → 先達成 ASC → 錢包 C 序）、名次", async () => {
    for (const { name, store } of stores) {
      const week = 2026_38;
      const t0 = new Date("2026-09-12T00:00:00Z");
      const [a, b, c] = ["9zzz", "7aaa", "7abb"]; // C collation：7aaa < 7abb < 9zzz
      expect((await store.upsertTournamentSteps(week, a, 10_000, new Date(t0.getTime() + 500_000), t0)).changed).toBe(true);
      const lower = await store.upsertTournamentSteps(week, a, 9_000, new Date(t0.getTime() + 900_000), t0);
      expect(lower.changed).toBe(false);
      expect(lower.row.verifiedSteps).toBe(10_000);
      expect(lower.row.firstReachedAt?.getTime()).toBe(t0.getTime() + 500_000);
      await store.upsertTournamentSteps(week, b, 10_000, new Date(t0.getTime() + 400_000), t0);
      await store.upsertTournamentSteps(week, c, 10_000, new Date(t0.getTime() + 500_000), t0);
      const rows = await store.listTournamentSteps(week, 10);
      expect(rows.map((r) => r.wallet), name).toEqual([b, c, a]);
      expect(await store.rankOf(week, a), name).toBe(3);
      expect(await store.rankOf(week, "none"), name).toBeNull();
      expect(await store.countTournamentSteps(week), name).toBe(3);
      await store.upsertTournamentSteps(week, a, 12_000, new Date(t0.getTime() + 600_000), t0);
      expect(await store.rankOf(week, a), name).toBe(1);
      expect((await store.getTournamentSteps(week, a))?.verifiedSteps).toBe(12_000);
    }
  });

  it("chain_events：冪等寫入、pending 依 slot、finalize／orphan、游標 upsert、redeemed_sig 回填一次", async () => {
    for (const { name, store } of stores) {
      const now = new Date("2026-09-14T00:00:00Z");
      const wallet = "W" + name;
      const nonce = Buffer.from(("ab".repeat(16)).slice(0, 32), "hex");
      await store.upsertPlayer(wallet, now);
      await store.insertAttestation({ nonce, idempotencyKey: "11111111-1111-4111-8111-11111111111" + (name === "postgres" ? "1" : "2"), requestHash: Buffer.alloc(32), wallet, taskDate: 20_710, taskType: 1, rulesVersion: 3, evidenceHash: Buffer.alloc(32), issuedAt: now, expiresAt: now });
      await store.insertChainEvent({ signature: "s1", eventIndex: 0, slot: 20, blockhash: "b", commitment: "confirmed", eventName: "ClockedIn", payload: { wallet, nonce: nonce.toString("hex") } }, now);
      await store.insertChainEvent({ signature: "s1", eventIndex: 0, slot: 999, blockhash: "x", commitment: "confirmed", eventName: "Other", payload: {} }, now); // 冪等
      await store.insertChainEvent({ signature: "s0", eventIndex: 0, slot: 10, blockhash: "b", commitment: "confirmed", eventName: "PlayerInitialized", payload: { wallet } }, now);
      const pending = await store.listPendingChainEvents(10);
      expect(pending.map((p) => p.signature), name).toEqual(["s0", "s1"]);
      expect(pending[1]!.eventName).toBe("ClockedIn");
      await store.finalizeChainEvent("s1", 0);
      await store.markChainEventOrphaned("s0", 0, now);
      expect(await store.listPendingChainEvents(10), name).toHaveLength(0);
      expect((await store.listChainEvents({ finalizedOnly: true }, 10)).map((e) => e.signature), name).toEqual(["s1"]);
      expect((await store.listChainEvents({ eventName: "ClockedIn", wallet }, 10)), name).toHaveLength(1);
      expect(await store.backfillRedeemedSig(nonce, "s1"), name).toBe(true);
      expect(await store.backfillRedeemedSig(nonce, "s9"), name).toBe(false); // 已回填不覆寫
      expect(await store.backfillRedeemedSig(Buffer.alloc(16, 7), "s1"), name).toBe(false);
      expect((await store.listHistory(wallet, 0))[0]!.redeemedSig, name).toBe("s1");
      await store.setCursor("c", "s1", 20);
      await store.setCursor("c", "s2", 30);
      expect(await store.getCursor("c"), name).toEqual({ signature: "s2", slot: 30 });
    }
  });

  it("purgeExpired：只刪 cutoff 前資料（CASCADE 判定）；listDueDeletions／markDeletionDone", async () => {
    for (const { name, store } of stores) {
      const now = new Date("2026-10-15T00:00:00Z");
      const old = new Date("2026-09-10T00:00:00Z");
      const wallet = "R" + name;
      await store.upsertPlayer(wallet, old);
      const sid = await store.insertHealthSnapshot({ wallet, taskDate: 1, taskType: 1, attributedSteps: 1, sleepMinutes: null, sourceSummary: [], stepRateSummary: null, sleepOverlapMinutes: null, sensorSummary: null, motionSummary: null, clientInfo: {}, inputHash: Buffer.alloc(32), createdAt: old });
      await store.insertRiskDecision({ snapshotId: sid, rulesVersion: 3, riskScore: 0, matchedRules: [], decision: "pass", rejectCode: null });
      await store.insertHealthSnapshot({ wallet, taskDate: 2, taskType: 1, attributedSteps: 1, sleepMinutes: null, sourceSummary: [], stepRateSummary: null, sleepOverlapMinutes: null, sensorSummary: null, motionSummary: null, clientInfo: {}, inputHash: Buffer.alloc(32), createdAt: now });
      await store.upsertTournamentSteps(2026_36, wallet, 1, old, old);
      const r = await store.purgeExpired(new Date("2026-09-15T00:00:00Z"), now);
      expect(r.snapshots, name).toBe(1);
      expect(r.tournamentSteps, name).toBe(1);
      await store.deletePlayerData(wallet, now, new Date("2026-10-16T00:00:00Z"));
      expect(await store.listDueDeletions(now), name).toEqual([]);
      expect(await store.listDueDeletions(new Date("2026-10-17T00:00:00Z")), name).toEqual([wallet]);
      await store.markDeletionDone(wallet);
      expect(await store.listDueDeletions(new Date("2026-10-17T00:00:00Z")), name).toEqual([]);
    }
  });

  it("gallery：slot 單調 upsert、收藏冪等計數、排行（等級 → XP → 錢包 C 序）、搜尋", async () => {
    for (const { name, store } of stores) {
      const now = new Date("2026-09-14T00:00:00Z");
      const [a, b, c] = [`G${name}aaa`, `G${name}bbb`, `G${name}ccc`];
      await store.upsertGalleryPlayer({ wallet: a, shoeLevel: 2, coreLevel: 2, xp: 500n, streakDays: 1, maxStreakDays: 1, lastTaskDate: 1, slot: 10 }, now);
      await store.upsertGalleryPlayer({ wallet: a, shoeLevel: 1, coreLevel: 1, xp: 100n, streakDays: 1, maxStreakDays: 1, lastTaskDate: 1, slot: 5 }, now); // 舊 slot 忽略
      await store.upsertGalleryPlayer({ wallet: b, shoeLevel: 3, coreLevel: 3, xp: 1600n, streakDays: 2, maxStreakDays: 7, lastTaskDate: 2, slot: 11 }, now);
      await store.upsertGalleryPlayer({ wallet: c, shoeLevel: 2, coreLevel: 2, xp: 500n, streakDays: 1, maxStreakDays: 1, lastTaskDate: 1, slot: 12 }, now);
      expect((await store.getGalleryPlayer(a))?.xp, name).toBe(500n);
      expect(await store.insertGalleryCollectible({ wallet: b, kind: 1, asset: "A", signature: "s", slot: 1, claimedAt: now }), name).toBe(true);
      expect(await store.insertGalleryCollectible({ wallet: b, kind: 1, asset: "A", signature: "s", slot: 1, claimedAt: now }), name).toBe(false);
      expect((await store.getGalleryPlayer(b))?.collectibleCount, name).toBe(1);
      expect((await store.listGalleryPlayers(10, 0)).map((p) => p.wallet), name).toEqual([b, a, c]);
      expect(await store.galleryRankOf(c), name).toBe(3);
      expect(await store.countGalleryPlayers(), name).toBe(3);
      expect((await store.searchGalleryPlayers(`G${name}b`, 10)).map((p) => p.wallet), name).toEqual([b]);
      expect((await store.listGalleryCollectibles(b)).map((x) => x.kind), name).toEqual([1]);
    }
  });
});
