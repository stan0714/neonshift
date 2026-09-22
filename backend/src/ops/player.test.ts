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
const clock = new Date("2026-09-22T06:00:00Z");
const OPS = { authorization: "Bearer ops-token-for-tests-0001" };

beforeEach(async () => {
  store = new MemoryStore();
  app = buildApp({ config: loadConfig({ NODE_ENV: "test", OPS_TOKEN: "ops-token-for-tests-0001", PROGRAM_ID: "6MhVoQHdEpY2hqkaNJMkT2vHWakfnGfEYDgCtJzh6ENA" }), db, store, now: () => clock, signer: LocalKeypairSigner.random() });
  await app.ready();
});
afterEach(async () => app.close());
async function login() {
  const kp = nacl.sign.keyPair();
  const wallet = bs58.encode(kp.publicKey);
  const n = (await app.inject({ method: "POST", url: "/v1/auth/nonce", payload: { wallet } })).json();
  const sig = Buffer.from(nacl.sign.detached(new TextEncoder().encode(n.message), kp.secretKey)).toString("base64");
  const v = (await app.inject({ method: "POST", url: "/v1/auth/verify", payload: { message: n.message, signature_b64: sig } })).json();
  return { wallet, h: { authorization: `Bearer ${v.access_token as string}` } };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const j = (r: { json: () => unknown }) => r.json() as Record<string, any>;
const gps = (id: string, day: string, km: number, splitMs: number, extra: Record<string, unknown> = {}) => ({ sport: "run", origin: "gps", source_id: "cc.neonshift.app/gps", external_record_id: id, started_at: `${day}T00:00:00Z`, ended_at: new Date(Date.parse(`${day}T00:00:00Z`) + splitMs * km).toISOString(), distance_mm: String(km * 1_000_000), distance_method: "gps", extras: { splits: Array.from({ length: km }, (_, i) => ({ kind: "split", index: i + 1, distanceMm: 1_000_000, durationMs: splitMs, isPartial: false, uncertain: false })) }, ...extra });

describe("GET /ops/players/:wallet", () => {
  it("需要 OPS_TOKEN；回傳運動（含 review_reasons／pb_eligible）、PB、里程碑、成就、SKR", async () => {
    const u = await login();
    // 一筆完整 5 km（算 PB／首次 5 km）、一筆較晚且帶 gps_gap 的 6 km（不算；若它較早會讓首次 5 km 變 pending_review）
    await app.inject({ method: "POST", url: "/v1/workouts/import", headers: u.h, payload: { sessions: [gps("ok", "2026-09-21", 5, 400_000), gps("gap", "2026-09-22", 6, 400_000, { client_flags: ["gps_gap"] })] } });
    expect((await app.inject({ method: "GET", url: `/v1/ops/players/${u.wallet}` })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/ops/players/not-base58!", headers: OPS })).statusCode).toBe(422);
    const r = await app.inject({ method: "GET", url: `/v1/ops/players/${u.wallet}`, headers: OPS });
    expect(r.statusCode).toBe(200);
    const body = j(r);
    expect(body.wallet).toBe(u.wallet);
    expect(body.workouts).toHaveLength(2);
    const gap = body.workouts.find((w: { session_id: string; review_reasons: string[] }) => w.review_reasons.includes("gps_gap"));
    expect(gap.pb_eligible).toBe(false);
    const ok = body.workouts.find((w: { pb_eligible: boolean }) => w.pb_eligible);
    expect(ok.status).toBe("saved");
    expect(body.personal_bests.map((p: { category: string }) => p.category).sort()).toEqual(["fastest_1k", "fastest_5k", "longest_run"]);
    expect(body.milestones.find((m: { category: string; status: string }) => m.category === "first_5k" && m.status === "eligible")?.first?.source.id).toBe(ok.session_id);
    expect(body.skr).toEqual({ orders: [], entitlements: [] });
    expect(JSON.stringify(body)).not.toMatch(/access_token|refresh_token|route|coordinates/);
  });

  it("OPS_TOKEN 未設定 → 404（不暴露端點）", async () => {
    const app2 = buildApp({ config: loadConfig({ NODE_ENV: "test", PROGRAM_ID: "6MhVoQHdEpY2hqkaNJMkT2vHWakfnGfEYDgCtJzh6ENA" }), db, store: new MemoryStore(), now: () => clock, signer: LocalKeypairSigner.random() });
    await app2.ready();
    expect((await app2.inject({ method: "GET", url: "/v1/ops/players/11111111111111111111111111111111", headers: OPS })).statusCode).toBe(404);
    await app2.close();
  });
});
