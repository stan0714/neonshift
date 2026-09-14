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
    await pool.query("DELETE FROM auth_sessions; DELETE FROM auth_challenges; DELETE FROM players;");
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
});
