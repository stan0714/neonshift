import { randomUUID } from "node:crypto";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { challengeMessage } from "../auth/challenge.js";
import { requestHashOf } from "../claim/canonical.js";
import { loadConfig } from "../config.js";
import type { Db } from "../db.js";
import { LocalKeypairSigner } from "../signer/index.js";
import { MemoryStore } from "../store/memory.js";
import { Alerts } from "./alerts.js";
import { Metrics } from "./metrics.js";

const db: Db = { pool: null, ping: async () => false, close: async () => {} };
let app: ReturnType<typeof buildApp>;
let store: MemoryStore;
const webhookCalls: unknown[] = [];

beforeEach(async () => {
  store = new MemoryStore();
  webhookCalls.length = 0;
  app = buildApp({
    config: loadConfig({ NODE_ENV: "test", PROGRAM_ID: "5vTs2vGPuADyCLtxkXpWQpuK25XoTihJ41drGKmfBjAf", RATE_LIMIT_SENSITIVE_PER_MINUTE: "3", ALERT_WEBHOOK_URL: "https://hooks.example/x", METRICS_TOKEN: "m" }),
    db,
    store,
    signer: LocalKeypairSigner.random(),
    alertFetch: (async (_url: unknown, init?: RequestInit) => {
      webhookCalls.push(JSON.parse(String(init?.body)));
      return new Response("ok");
    }) as typeof fetch,
  });
  await app.ready();
});
afterEach(async () => app.close());

describe("PG-B-18 速率限制、稽核、指標、告警", () => {
  it("敏感端點每分鐘上限；超過回 429 統一格式", async () => {
    const wallet = bs58.encode(nacl.sign.keyPair().publicKey);
    for (let i = 0; i < 3; i++) expect((await app.inject({ method: "POST", url: "/v1/auth/nonce", payload: { wallet } })).statusCode).toBe(200);
    const blocked = await app.inject({ method: "POST", url: "/v1/auth/nonce", payload: { wallet } });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toEqual({ error: { code: "RATE_LIMITED", message: "too many requests" } });
  });

  it("/metrics 需 token；輸出請求計數與延遲直方圖", async () => {
    expect((await app.inject({ method: "GET", url: "/metrics" })).statusCode).toBe(401);
    await app.inject({ method: "GET", url: "/healthz" });
    const m = await app.inject({ method: "GET", url: "/metrics", headers: { authorization: "Bearer m" } });
    expect(m.statusCode).toBe(200);
    expect(m.body).toMatch(/neonshift_http_requests_total\{route="\/healthz",status="200"\} 1/);
    expect(m.body).toMatch(/neonshift_api_latency_ms_count \d+/);
  });

  it("重放嘗試超過每日 10 次 → 告警 webhook 一次；指標累加", async () => {
    const kp = nacl.sign.keyPair();
    const wallet = bs58.encode(kp.publicKey);
    const n = (await app.inject({ method: "POST", url: "/v1/auth/nonce", payload: { wallet } })).json();
    const sig = Buffer.from(nacl.sign.detached(new TextEncoder().encode(n.message), kp.secretKey)).toString("base64");
    const token = (await app.inject({ method: "POST", url: "/v1/auth/verify", payload: { message: n.message, signature_b64: sig } })).json().access_token as string;
    const body = { task_type: "sleep", task_date: 20_710, steps: null, sleep_minutes: 450, sleep_sessions: [], step_rate_summary: null, data_origins: [], sensor_summary: null, motion_summary: null, client: { app_version: "0.1.0", device_model: "Seeker", os_api: 36, sdk_extension: 22 } };
    const rh = requestHashOf(body as never);
    const c = (await app.inject({ method: "POST", url: "/v1/auth/challenge", headers: { authorization: `Bearer ${token}` }, payload: { purpose: "claim", request_hash_b64: rh.toString("base64"), task_date: 20_710, task_type: 2 } })).json();
    const msg = challengeMessage("claim", Buffer.from(c.challenge_b64, "base64"), rh, c.expires_at);
    const payload = { ...body, claim_authorization: { challenge_b64: c.challenge_b64, expires_at: c.expires_at, signature_b64: Buffer.from(nacl.sign.detached(msg, kp.secretKey)).toString("base64") } };
    // 直接呼叫 service 以避開速率限制，模擬 12 次重放
    const claim = app.claim;
    await claim.claim(wallet, randomUUID(), payload);
    for (let i = 0; i < 12; i++) await claim.claim(wallet, randomUUID(), payload).catch(() => {});
    expect(app.metrics.get("neonshift_replay_attempts_total")).toBe(12);
    expect(webhookCalls).toHaveLength(1);
    expect(webhookCalls[0]).toMatchObject({ kind: "REPLAY_WALLET", detail: { wallet, n: 11 } });
    expect(app.metrics.get("neonshift_attestations_issued_total", { task: "sleep" })).toBe(1);
  });

  it("簽發量超過 15 分鐘基線 3 倍 → ISSUANCE_SPIKE 告警（每小時一次）", async () => {
    const metrics = new Metrics();
    const fired: unknown[] = [];
    const alerts = new Alerts({ warn: (o: unknown) => fired.push(o), error: () => {}, info: () => {} } as never, metrics, { issuanceSpikeFactor: 3, replayPerWalletPerDay: 10 });
    const t0 = Date.parse("2026-09-14T06:00:00Z");
    for (let i = 0; i < 10; i++) alerts.onIssued(t0 + i * 1000);
    expect(fired).toHaveLength(0);
    for (let i = 0; i < 60; i++) alerts.onIssued(t0 + 10_000 + i * 100);
    expect(fired.length).toBe(1);
    expect(metrics.get("neonshift_alerts_total", { kind: "ISSUANCE_SPIKE" })).toBe(1);
  });
});
