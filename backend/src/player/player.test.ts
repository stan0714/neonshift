import { randomUUID } from "node:crypto";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { StaticChainReader } from "../chain/reader.js";
import { weekIdOf, type TournamentView } from "../chain/tournament.js";
import { loadConfig } from "../config.js";
import type { Db } from "../db.js";
import { LocalKeypairSigner } from "../signer/index.js";
import { MemoryStore } from "../store/memory.js";

const db: Db = { pool: null, ping: async () => false, close: async () => {} };
let app: ReturnType<typeof buildApp>;
let store: MemoryStore;
let clock: Date;
/**
 * 鏈上讀取一律注入 StaticChainReader。
 *
 * `DELETE /player/data` 會問 `tournaments.activeStakedUntil()`（質押事實在鏈上），
 * 設了 PROGRAM_ID 又不注入 chain 的話那一步會打真的 RPC——測試就變成「有沒有網路」的測試，
 * 在離線或 RPC 慢的機器上逾時失敗，而且失敗原因跟這支端點無關。
 */
let chain: StaticChainReader;

const ENDS = Math.floor(Date.parse("2026-09-15T00:00:00Z") / 1000);
const tournament = (over: Partial<TournamentView> = {}): TournamentView => ({
  address: "7Vb2s5wmE3sGqcNNpfkqz3jmA4sm3uyE1DK2TDeR6vE8", weekId: weekIdOf(new Date("2026-09-14T06:00:00Z")), status: "running", vault: "V",
  stakeAmount: 50_000_000n, totalStaked: 500_000_000n, treasuryInjectionCap: 0n, treasuryInjection: 0n,
  entrantCount: 10, validEntrantCount: 10, forfeitedCount: 0, groupASize: 1, groupBSize: 2, distributablePool: 0n, distributed: 0n, totalRefund: 0n, totalPrize: 0n, treasuryRemainder: 0n,
  resultsSubmitted: 0, resultsHash: Buffer.alloc(32), resultsRollingHash: Buffer.alloc(32), minEntrants: 10,
  registrationEndsAt: ENDS - 2 * 86_400, startsAt: ENDS - 86_400, endsAt: ENDS, rulesVersion: 3, prizeABps: 6000, prizeBBps: 4000, loserRefundBps: 5000, createdAt: ENDS - 3 * 86_400,
  ...over,
});

beforeEach(async () => {
  store = new MemoryStore();
  clock = new Date("2026-09-14T06:00:00Z"); // task_date 20710
  chain = new StaticChainReader();
  app = buildApp({ config: loadConfig({ NODE_ENV: "test", PROGRAM_ID: "5vTs2vGPuADyCLtxkXpWQpuK25XoTihJ41drGKmfBjAf" }), db, store, now: () => clock, signer: LocalKeypairSigner.random(), chain });
  await app.ready();
});
afterEach(async () => app.close());

async function login() {
  const kp = nacl.sign.keyPair();
  const wallet = bs58.encode(kp.publicKey);
  const n = (await app.inject({ method: "POST", url: "/v1/auth/nonce", payload: { wallet } })).json();
  const sig = Buffer.from(nacl.sign.detached(new TextEncoder().encode(n.message), kp.secretKey)).toString("base64");
  const v = (await app.inject({ method: "POST", url: "/v1/auth/verify", payload: { message: n.message, signature_b64: sig } })).json();
  return { kp, wallet, token: v.access_token as string, refresh: v.refresh_token as string };
}

function seedAttestation(wallet: string, taskDate: number, taskType: number) {
  const issuedAt = new Date(taskDate * 86_400 * 1000 + 3600_000);
  return store.insertAttestation({ nonce: Buffer.from(randomUUID().replace(/-/g, "").slice(0, 32), "hex"), idempotencyKey: randomUUID(), requestHash: Buffer.alloc(32), wallet, taskDate, taskType, rulesVersion: 3, evidenceHash: Buffer.alloc(32), issuedAt, expiresAt: new Date(issuedAt.getTime() + 600_000) });
}

describe("PG-B-12 GET /player/history", () => {
  it("只回本人、保留期內（days ≤ 30）的紀錄，最新在前；days 超界 400", async () => {
    const u = await login();
    const other = await login();
    await seedAttestation(u.wallet, 20_710, 1);
    await seedAttestation(u.wallet, 20_709, 2);
    await seedAttestation(u.wallet, 20_710 - 30, 1); // 31 天前，超出 30 天窗
    await seedAttestation(other.wallet, 20_710, 1);
    const res = await app.inject({ method: "GET", url: "/v1/player/history?days=30", headers: { authorization: `Bearer ${u.token}` } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.retention_days).toBe(30);
    expect(body.items.map((i: { task_date: number; task_type: string }) => [i.task_date, i.task_type])).toEqual([[20_710, "steps"], [20_709, "sleep"]]);
    expect(body.items[0].redeemed_signature).toBeNull();
    expect(body.items[0].amount).toBeNull();
    expect(body.total_earned).toBe("0");
    // finalized ClockedIn 事件 → 金額／XP／簽章回填到對應紀錄
    await store.insertChainEvent({ signature: "sigA", eventIndex: 0, slot: 1, blockhash: "b", commitment: "finalized", eventName: "ClockedIn", payload: { wallet: u.wallet, task_date: 20_710, task_type: 1, amount: "10000000", xp: "100", shoe_level: 1 } }, new Date());
    await store.insertChainEvent({ signature: "sigB", eventIndex: 0, slot: 2, blockhash: "b", commitment: "confirmed", eventName: "ClockedIn", payload: { wallet: u.wallet, task_date: 20_709, task_type: 2, amount: "5000000", xp: "150", shoe_level: 1 } }, new Date());
    const again = (await app.inject({ method: "GET", url: "/v1/player/history?days=30", headers: { authorization: `Bearer ${u.token}` } })).json();
    expect(again.items[0]).toMatchObject({ task_date: 20_710, amount: "10000000", xp: 100, redeemed_signature: "sigA" });
    expect(again.items[1].amount).toBeNull(); // 只認 finalized
    expect(again.total_earned).toBe("10000000");
    expect((await app.inject({ method: "GET", url: "/v1/player/history?days=31", headers: { authorization: `Bearer ${u.token}` } })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/v1/player/history" })).statusCode).toBe(401);
  });
});

describe("PG-B-13 DELETE /player/data（BR-25）", () => {
  it("無賽事：204；session 立即撤銷、健康摘要／判定／attestation／idempotency 全部刪除；舊 token 與 refresh 失效", async () => {
    const u = await login();
    await seedAttestation(u.wallet, 20_710, 1);
    const sid = await store.insertHealthSnapshot({ wallet: u.wallet, taskDate: 20_710, taskType: 1, attributedSteps: 9000, sleepMinutes: null, sourceSummary: [], stepRateSummary: null, sleepOverlapMinutes: null, sensorSummary: null, motionSummary: null, clientInfo: {}, inputHash: Buffer.alloc(32) });
    await store.insertRiskDecision({ snapshotId: sid, rulesVersion: 3, riskScore: 0, matchedRules: [], decision: "pass", rejectCode: null });
    await store.beginClaim(u.wallet, randomUUID(), Buffer.alloc(32), clock);

    const res = await app.inject({ method: "DELETE", url: "/v1/player/data", headers: { authorization: `Bearer ${u.token}` } });
    expect(res.statusCode).toBe(204);
    expect(store.snapshots).toHaveLength(0);
    expect(store.decisions).toHaveLength(0);
    expect(store.attestations.size).toBe(0);
    expect(store.claimResults.size).toBe(0);
    expect(store.players.get(u.wallet)?.deletedAt).not.toBeNull();

    const after = await app.inject({ method: "GET", url: "/v1/player/history", headers: { authorization: `Bearer ${u.token}` } });
    expect(after.statusCode).toBe(401);
    const refresh = await app.inject({ method: "POST", url: "/v1/auth/refresh", payload: { refresh_token: u.refresh } });
    expect(refresh.statusCode).toBe(401);
    expect(refresh.json().error.code).toBe("REFRESH_REVOKED");
  });

  it("刪除後重新 SIWS 登入視為新同意，可再使用；舊資料不會復原", async () => {
    const u = await login();
    await seedAttestation(u.wallet, 20_710, 1);
    await app.inject({ method: "DELETE", url: "/v1/player/data", headers: { authorization: `Bearer ${u.token}` } });
    const n = (await app.inject({ method: "POST", url: "/v1/auth/nonce", payload: { wallet: u.wallet } })).json();
    const sig = Buffer.from(nacl.sign.detached(new TextEncoder().encode(n.message), u.kp.secretKey)).toString("base64");
    const v = await app.inject({ method: "POST", url: "/v1/auth/verify", payload: { message: n.message, signature_b64: sig } });
    expect(v.statusCode).toBe(200);
    const hist = await app.inject({ method: "GET", url: "/v1/player/history", headers: { authorization: `Bearer ${v.json().access_token}` } });
    expect(hist.json().items).toHaveLength(0);
  });

  it("鏈上有進行中的質押：延後到賽事 ends_at，不是一律 30 天", async () => {
    const u = await login();
    const weekId = weekIdOf(clock);
    chain.tournaments.set(weekId, tournament({ weekId }));
    chain.entries.add(`${weekId}:${u.wallet}`);
    const res = await app.inject({ method: "DELETE", url: "/v1/player/data", headers: { authorization: `Bearer ${u.token}` } });
    expect(res.statusCode).toBe(202);
    // 質押鎖到賽事結束就好；30 天是上限不是預設值
    expect(res.json().deletion_due_at).toBe(new Date(ENDS * 1000).toISOString());
    expect((await app.inject({ method: "GET", url: "/v1/player/history", headers: { authorization: `Bearer ${u.token}` } })).statusCode).toBe(401);
  });

  it("有進行中已質押賽事：202 與 deletion_due_at（≤ 30 天），session 仍立即撤銷", async () => {
    const u = await login();
    store.hasActiveStakedTournament = async () => true;
    const res = await app.inject({ method: "DELETE", url: "/v1/player/data", headers: { authorization: `Bearer ${u.token}` } });
    expect(res.statusCode).toBe(202);
    const due = Date.parse(res.json().deletion_due_at);
    expect(due - clock.getTime()).toBeLessThanOrEqual(30 * 86_400_000);
    expect(res.json().note).toMatch(/cannot be deleted/);
    expect((await app.inject({ method: "GET", url: "/v1/player/history", headers: { authorization: `Bearer ${u.token}` } })).statusCode).toBe(401);
  });
});
