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
    await pool.query("DELETE FROM claim_results; DELETE FROM attestations; DELETE FROM health_snapshots; DELETE FROM auth_sessions; DELETE FROM auth_challenges; DELETE FROM players;");
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
});
