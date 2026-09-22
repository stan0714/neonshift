/** XD-03 成就護照：PB／里程碑（eligible 與 pending_review）／探索任務彙整；來源分類；撤銷後 validity=revoked 且 NFT 留作歷史；needs_review 不標 valid；不含健康數字／路線。 */
import bs58 from "bs58";
import nacl from "tweetnacl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import type { Db } from "../db.js";
import { LocalKeypairSigner } from "../signer/index.js";
import { MemoryStore } from "../store/memory.js";

const db: Db = { pool: null, ping: async () => false, close: async () => {} };
let app: ReturnType<typeof buildApp>;
let store: MemoryStore;
let clock = new Date("2026-09-16T03:00:00Z");
const OPS = { authorization: "Bearer ops-token-for-tests-0001" };

beforeEach(async () => {
  clock = new Date("2026-09-16T03:00:00Z");
  store = new MemoryStore();
  app = buildApp({ config: loadConfig({ NODE_ENV: "test", OPS_TOKEN: "ops-token-for-tests-0001", PROGRAM_ID: "6MhVoQHdEpY2hqkaNJMkT2vHWakfnGfEYDgCtJzh6ENA", RATE_LIMIT_SENSITIVE_PER_MINUTE: "1000" }), db, store, now: () => clock, signer: LocalKeypairSigner.random() });
  await app.ready();
});
afterEach(async () => app.close());
async function login() {
  const kp = nacl.sign.keyPair();
  const wallet = bs58.encode(kp.publicKey);
  const auth = async () => {
    const n = (await app.inject({ method: "POST", url: "/v1/auth/nonce", payload: { wallet } })).json();
    const sig = Buffer.from(nacl.sign.detached(new TextEncoder().encode(n.message), kp.secretKey)).toString("base64");
    const v = (await app.inject({ method: "POST", url: "/v1/auth/verify", payload: { message: n.message, signature_b64: sig } })).json();
    return { authorization: `Bearer ${v.access_token as string}` };
  };
  return { wallet, h: await auth() };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const j = (r: { json: () => unknown }) => r.json() as Record<string, any>;
const gps = (id: string, day: string, km: number, splitMs: number, extra: Record<string, unknown> = {}) => ({ sport: "run", origin: "gps", source_id: "cc.neonshift.app/gps", external_record_id: id, started_at: `${day}T00:00:00Z`, ended_at: new Date(Date.parse(`${day}T00:00:00Z`) + splitMs * km).toISOString(), distance_mm: String(km * 1_000_000), distance_method: "gps", extras: { splits: Array.from({ length: km }, (_, i) => ({ kind: "split", index: i + 1, distanceMm: 1_000_000, durationMs: splitMs, isPartial: false, uncertain: false })) }, ...extra });

describe("GET /me/passport", () => {
  it("彙整 PB、里程碑（eligible／pending）、探索任務；來源分類與 validity；撤銷後 NFT 留歷史", async () => {
    const u = await login();
    // 5 km 完整 → PB 三項＋首次 5 km eligible；之後一筆 10 km 帶 gps_gap → 首次 10 km pending_review（不得標 valid）
    await app.inject({ method: "POST", url: "/v1/workouts/import", headers: u.h, payload: { sessions: [gps("w5", "2026-09-10", 5, 330_000), gps("w10", "2026-09-12", 10, 330_000, { client_flags: ["gps_gap"] })] } });
    let r = j(await app.inject({ method: "GET", url: "/v1/me/passport", headers: u.h }));
    expect(r.trust_note).toMatch(/not_hardware_proof/);
    const kinds = r.entries.map((e: { kind: string; category: string; validity: string; source_class: string }) => `${e.kind}:${e.category}:${e.validity}:${e.source_class}`);
    expect(kinds).toEqual(expect.arrayContaining(["pb:fastest_5k:valid:device", "pb:longest_run:valid:device", "milestone:first_5k:valid:device", "milestone:first_10k:pending:pending"]));
    const m10 = r.entries.find((e: { category: string }) => e.category === "first_10k");
    expect([m10.reason, m10.nft, m10.public]).toEqual(["needs_review", null, false]);
    expect(JSON.stringify(r)).not.toMatch(/"lat"|"lon"|"steps"|"route"|"heart_rate"|distance_mm/); // "milestone"／"longest_run" 含 lon／lat 字樣，只查欄位名
    // 首次 5 km 申請鑄造（公開）→ nft.pending_registry、public=true；撤銷 → validity=revoked、nft 仍列出
    const m5 = r.entries.find((e: { category: string }) => e.category === "first_5k");
    const intent = j(await app.inject({ method: "POST", url: "/v1/me/milestones/mint-intent", headers: u.h, payload: { key: "first_5k|unknown|device", public_consent: true } }));
    expect(intent.error).toBeUndefined();
    r = j(await app.inject({ method: "GET", url: "/v1/me/passport", headers: u.h }));
    const m5b = r.entries.find((e: { id: string }) => e.id === m5.id);
    expect([m5b.nft.status, m5b.public, m5b.validity]).toEqual(["pending_registry", true, "valid"]);
    await app.inject({ method: "POST", url: `/v1/ops/achievements/${m5b.nft.achievement_id}/registry`, headers: OPS, payload: { status: "revoked", signature: "x".repeat(40) } });
    r = j(await app.inject({ method: "GET", url: "/v1/me/passport", headers: u.h }));
    const m5c = r.entries.find((e: { id: string }) => e.id === m5.id);
    expect([m5c.validity, m5c.nft.status, m5c.nft.achievement_id]).toEqual(["revoked", "revoked", m5b.nft.achievement_id]);
    expect(r.counts.revoked).toBe(1);
    expect(r.counts.pending).toBeGreaterThanOrEqual(1);
  });

  it("未登入 401", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/me/passport" })).statusCode).toBe(401);
  });
});
