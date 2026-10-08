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
  app = buildApp({ config: loadConfig({ NODE_ENV: "test", OPS_TOKEN: "ops-token-for-tests-0001", RATE_LIMIT_SENSITIVE_PER_MINUTE: "1000", RATE_LIMIT_PER_MINUTE: "5000" }), db, store, now: () => clock, signer: LocalKeypairSigner.random() });
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
const hc = (id: string, start: string, minutes: number) => ({ sport: "walk", intent: "brisk", origin: "health_connect", source_id: "com.example.watch", external_record_id: id, started_at: start, ended_at: new Date(Date.parse(start) + minutes * 60_000).toISOString(), distance_mm: String(minutes * 90_000), distance_method: "device", steps: minutes * 100 });

describe("GET /ops/metrics/funnel", () => {
  it("接受→開始→完成→領取 分母分開；只回計數；需 OPS_TOKEN", async () => {
    const a = await login(); const b = await login(); const c = await login();
    for (const u of [a, b, c]) await app.inject({ method: "POST", url: "/v1/me/quests/accept", headers: u.h, payload: { template_id: "three_days", timezone: "Asia/Taipei", idempotency_key: `k-${u.wallet.slice(0, 8)}` } });
    // a：三天完成並領取；b：只運動一天（started）；c：沒動
    await app.inject({ method: "POST", url: "/v1/workouts/import", headers: a.h, payload: { sessions: [hc("a1", "2026-09-16T04:00:00Z", 20), hc("a2", "2026-09-17T04:00:00Z", 20), hc("a3", "2026-09-18T04:00:00Z", 20)] } });
    await app.inject({ method: "POST", url: "/v1/workouts/import", headers: b.h, payload: { sessions: [hc("b1", "2026-09-16T05:00:00Z", 20)] } });
    const qa = j(await app.inject({ method: "GET", url: "/v1/me/quests", headers: a.h }));
    await app.inject({ method: "POST", url: `/v1/me/quests/${qa.enrollments[0].enrollment_id}/claim`, headers: a.h });
    expect((await app.inject({ method: "GET", url: "/v1/ops/metrics/funnel" })).statusCode).toBe(401);
    // cohort＝since 起 7 天內首見的玩家：since 設昨天，三人都在 cohort；D7／D30 需時間經過，現為 0
    const r = j(await app.inject({ method: "GET", url: "/v1/ops/metrics/funnel?since=2026-09-15T00:00:00Z", headers: OPS }));
    expect(r.quest_funnel).toEqual([{ template_id: "three_days", accepted: 3, started: 2, completed: 1, claimed: 1, revoked: 0, expired: 0, rates: { start: 0.667, complete: 0.5, claim: 1 } }]);
    expect(r.players).toMatchObject({ players: 3, new7d: 3, active7d: 3, cohort: { size: 3, retainedD7: 0, retainedD30: 0 } });
    expect(JSON.stringify(r)).not.toContain(a.wallet);
    expect(r.notes).toContain("counts_only_no_wallets");
  });
});
