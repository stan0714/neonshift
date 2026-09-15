/** PG-B-11 端到端（inject）：登入 → challenge → claim；idempotency、409、challenge 重放、拒絕碼、signer crash 恢復。 */
import { randomUUID } from "node:crypto";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { challengeMessage } from "../auth/challenge.js";
import { loadConfig } from "../config.js";
import type { Db } from "../db.js";
import { decode } from "../lib/attestation.js";
import { LocalKeypairSigner } from "../signer/index.js";
import { MemoryStore } from "../store/memory.js";
import { requestHashOf } from "./canonical.js";

const db: Db = { pool: null, ping: async () => false, close: async () => {} };
const PROGRAM_ID = "5vTs2vGPuADyCLtxkXpWQpuK25XoTihJ41drGKmfBjAf";

let app: ReturnType<typeof buildApp>;
let store: MemoryStore;
let clock: Date;
let attestor: LocalKeypairSigner;

beforeEach(async () => {
  store = new MemoryStore();
  clock = new Date("2026-09-14T06:00:00Z");
  attestor = LocalKeypairSigner.random();
  app = buildApp({ config: loadConfig({ NODE_ENV: "test", PROGRAM_ID, CLUSTER_ID: "1" }), db, store, now: () => clock, signer: attestor });
  await app.ready();
});
afterEach(async () => app.close());

function buckets(total: number): [number, number][] {
  const out: [number, number][] = [];
  let m = 480;
  for (let left = total; left > 0; left -= 100) out.push([m++, Math.min(100, left)]);
  return out;
}

async function login() {
  const kp = nacl.sign.keyPair();
  const wallet = bs58.encode(kp.publicKey);
  const n = (await app.inject({ method: "POST", url: "/v1/auth/nonce", payload: { wallet } })).json();
  const sig = Buffer.from(nacl.sign.detached(new TextEncoder().encode(n.message), kp.secretKey)).toString("base64");
  const v = (await app.inject({ method: "POST", url: "/v1/auth/verify", payload: { message: n.message, signature_b64: sig } })).json();
  return { kp, wallet, token: v.access_token as string };
}

function stepsBody(total = 9_420) {
  return {
    task_type: "steps",
    task_date: 20_710,
    steps: total,
    sleep_minutes: null,
    step_rate_summary: { bucket_minutes: 1, buckets: buckets(total) },
    data_origins: [{ package: "android", source_kind: "android_legacy", steps: total }],
    sensor_summary: { sample_rate_hz: 50, window_count: 2, window_seconds: 10, step_delta: 34, dominant_freq_hz: 1.87, freq_variance: 0.31, accel_rms: 1.24, gyro_rms: 0.42, zero_crossing_rate: 3.6 },
    motion_summary: null,
    client: { app_version: "0.1.0", device_model: "Seeker", os_api: 36, sdk_extension: 22 },
  };
}

/** App 端流程：算 request_hash → /auth/challenge → 簽章 → 組 claim_authorization */
async function authorize(u: Awaited<ReturnType<typeof login>>, body: Record<string, unknown>) {
  const rh = requestHashOf(body as never);
  const c = (
    await app.inject({
      method: "POST",
      url: "/v1/auth/challenge",
      headers: { authorization: `Bearer ${u.token}` },
      payload: { purpose: "claim", request_hash_b64: rh.toString("base64"), task_date: body.task_date, task_type: body.task_type === "steps" ? 1 : 2 },
    })
  ).json();
  const msg = challengeMessage("claim", Buffer.from(c.challenge_b64, "base64"), rh, c.expires_at);
  const signature_b64 = Buffer.from(nacl.sign.detached(msg, u.kp.secretKey)).toString("base64");
  return { ...body, claim_authorization: { challenge_b64: c.challenge_b64, expires_at: c.expires_at, signature_b64 } };
}

const claim = async (u: { token: string }, key: string, payload: unknown) =>
  app.inject({ method: "POST", url: "/v1/attestation/claim", headers: { authorization: `Bearer ${u.token}`, "idempotency-key": key }, payload: payload as Record<string, unknown> });

describe("PG-B-11 POST /attestation/claim", () => {
  it("成功：回 164-byte attestation，簽章可驗、綁定 program／cluster／wallet／task，不含金額與風險分數；DB 有 snapshot／decision／attestation", async () => {
    const u = await login();
    const payload = await authorize(u, stepsBody());
    const res = await claim(u, randomUUID(), payload);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.rules_version).toBe(3);
    expect(body.effective_value).toBe(9_420);
    expect(body.score).toBeUndefined();
    expect(body.threshold).toBeUndefined();
    const message = Buffer.from(body.attestation.message_b64, "base64");
    const signature = Buffer.from(body.attestation.signature_b64, "base64");
    expect(message).toHaveLength(164);
    expect(nacl.sign.detached.verify(message, signature, await attestor.publicKey())).toBe(true);
    expect(body.attestation.attestor_pubkey).toBe(bs58.encode(await attestor.publicKey()));
    const f = decode(message);
    expect(bs58.encode(f.programId)).toBe(PROGRAM_ID);
    expect(f.clusterId).toBe(1);
    expect(bs58.encode(f.wallet)).toBe(u.wallet);
    expect(f.taskDate).toBe(20_710);
    expect(f.taskType).toBe(1);
    expect(Number(f.expiry - f.issuedAt)).toBe(600);
    expect(store.snapshots).toHaveLength(1);
    expect(store.decisions[0]).toMatchObject({ decision: "pass", rulesVersion: 3 });
    expect(store.attestations.size).toBe(1);
    expect(store.ruleSets.get(3)).toBeTruthy();
  });

  it("idempotency：同 key 同 payload 回原回應（同一簽章，不重簽）；同 key 不同 payload 409；challenge 只用一次", async () => {
    const u = await login();
    const payload = await authorize(u, stepsBody());
    const key = randomUUID();
    const a = await claim(u, key, payload);
    const b = await claim(u, key, payload);
    expect(b.statusCode).toBe(200);
    expect(b.json()).toEqual(a.json());
    expect(store.attestations.size).toBe(1);

    const conflict = await claim(u, key, { ...payload, steps: 9_421 });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("IDEMPOTENCY_CONFLICT");

    // 新 key 重送同一 payload：challenge 已消耗 → 拒絕
    const replay = await claim(u, randomUUID(), payload);
    expect(replay.statusCode).toBe(401);
    expect(replay.json().error.code).toBe("CHALLENGE_INVALID");
  });

  it("拒絕：422 帶拒絕碼與 rules_version，不含分數；結果也被 idempotency 保存；有效值供 UI", async () => {
    const u = await login();
    const payload = await authorize(u, stepsBody(7_999));
    const key = randomUUID();
    const res = await claim(u, key, payload);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: { code: "TASK_NOT_MET", message: expect.any(String), rules_version: 3, effective_value: 7_999 } });
    expect(store.attestations.size).toBe(0);
    expect(store.decisions[0]).toMatchObject({ decision: "reject", rejectCode: "TASK_NOT_MET" });
    const again = await claim(u, key, payload);
    expect(again.statusCode).toBe(422);
  });

  it("challenge 綁定：payload 改動（request_hash 不同）→ 簽章對不上 → 401 且不落 snapshot", async () => {
    const u = await login();
    const payload = await authorize(u, stepsBody());
    const tampered = { ...payload, steps: 20_000 };
    const res = await claim(u, randomUUID(), tampered);
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("CHALLENGE_BAD_SIGNATURE");
    expect(store.snapshots).toHaveLength(0);
    // 失敗後同 key 可再用（處理權已釋放）
    expect(store.claimResults.size).toBe(0);
  });

  it("桶總和與來源不一致 → 400，不簽發", async () => {
    const u = await login();
    const body = stepsBody();
    body.step_rate_summary.buckets = [[480, 100]];
    const res = await claim(u, randomUUID(), await authorize(u, body));
    expect(res.statusCode).toBe(400);
    expect(store.attestations.size).toBe(0);
  });

  it("身分：無 token 401；缺 Idempotency-Key 400；schema 錯誤 400；JWT 的 wallet 才是主體", async () => {
    const u = await login();
    expect((await app.inject({ method: "POST", url: "/v1/attestation/claim", payload: {} })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/v1/attestation/claim", headers: { authorization: `Bearer ${u.token}` }, payload: {} })).statusCode).toBe(400);
    const bad = await claim(u, randomUUID(), { ...stepsBody(), task_type: "cycling" });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe("VALIDATION");
  });

  it("signer 成功後 process crash（completeClaim 前）：同 key 重試不會回 processing 卡死", async () => {
    const u = await login();
    const payload = await authorize(u, stepsBody());
    const key = randomUUID();
    const original = store.completeClaim.bind(store);
    store.completeClaim = async () => {
      throw new Error("simulated crash before persisting result");
    };
    const first = await claim(u, key, payload);
    expect(first.statusCode).toBe(500);
    store.completeClaim = original;
    // 處理權已釋放；但 challenge 已消耗，client 需重新取得 challenge 再以新 key 送
    expect(store.claimResults.size).toBe(0);
    const retry = await claim(u, key, payload);
    expect(retry.statusCode).toBe(401);
    expect(retry.json().error.code).toBe("CHALLENGE_INVALID");
  });

  it("GET /rules/version 公開版本與 hash", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/rules/version" });
    expect(r.json()).toMatchObject({ rules_version: 3, rules_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) });
  });
});
