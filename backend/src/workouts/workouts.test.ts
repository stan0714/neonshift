/** PG-R-01：匯入驗證與衍生（估算距離、品質、PB 資格）、來源 revision 去重、跨來源可能重複、刪除 tombstone、DELETE /player/data 同步。 */
import bs58 from "bs58";
import nacl from "tweetnacl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import type { Db } from "../db.js";
import { LocalKeypairSigner } from "../signer/index.js";
import { MemoryStore } from "../store/memory.js";
import { derive, workoutInput } from "./schema.js";

const db: Db = { pool: null, ping: async () => false, close: async () => {} };
let app: ReturnType<typeof buildApp>;
let store: MemoryStore;
const clock = new Date("2026-09-14T06:00:00Z");

beforeEach(async () => {
  store = new MemoryStore();
  app = buildApp({ config: loadConfig({ NODE_ENV: "test" }), db, store, now: () => clock, signer: LocalKeypairSigner.random() });
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
const base = { sport: "run", origin: "health_connect", source_id: "com.example.watch", external_record_id: "rec-1", started_at: "2026-09-14T00:00:00Z", ended_at: "2026-09-14T00:25:00Z" };

describe("derive（活動 4／3.2）", () => {
  const parse = (o: Record<string, unknown>) => workoutInput.parse({ ...base, ...o });
  it("量測距離 5 km／1500 s → complete、配速 300 s/km、PB 資格；走路不具 PB 資格", () => {
    const d = derive(parse({ distance_mm: "5000000", distance_method: "device", steps: 6000 })); // 240 步／分 < 250 上限
    expect([d.quality, d.avgPaceSPerKm, d.avgSpeedKmh, d.pbEligible]).toEqual(["complete", 300, 12, true]);
    expect(derive(parse({ sport: "walk", distance_mm: 3000000, distance_method: "device" })).pbEligible).toBe(false);
  });
  it("估算：steps × 校準步長（每一步）→ estimated、不具 PB 資格；無校準不套通用步長 → partial", () => {
    const d = derive(parse({ steps: 6000, step_length_mm: 780 }));
    expect([d.distanceMm, d.distanceMethod, d.quality, d.pbEligible]).toEqual([4_680_000n, "estimated", "estimated", false]);
    const p = derive(parse({ steps: 6000 }));
    expect([p.distanceMm, p.quality]).toEqual([null, "partial"]);
  });
  it("步頻／速度超上限 → needs_review；Total 熱量冒充 Active 標記；手動不具資格；結束早於開始 invalid", () => {
    expect(derive(parse({ steps: 20000 })).quality).toBe("needs_review");
    expect(derive(parse({ distance_mm: 20_000_000, distance_method: "gps" })).reviewReasons).toContain("speed_exceeds_cap"); // 48 km/h
    expect(derive(parse({ distance_mm: 5_000_000, distance_method: "device", active_energy_mkcal: "300000", energy_method: "total" })).reviewReasons).toContain("active_energy_labelled_total");
    const m = derive(parse({ origin: "manual", distance_mm: 5_000_000, distance_method: "device" }));
    expect([m.quality, m.pbEligible]).toEqual(["partial", false]);
    expect(derive(parse({ ended_at: "2026-09-13T23:00:00Z" })).status).toBe("invalid");
    expect(derive(parse({ paused_ms: "2000000" })).reviewReasons).toEqual(["paused_exceeds_elapsed"]);
  });
  it("schema：拒絕非有限／負值／未知 sport／多餘欄位；大整數字串", () => {
    expect(workoutInput.safeParse({ ...base, distance_mm: -1 }).success).toBe(false);
    expect(workoutInput.safeParse({ ...base, sport: "cycle" }).success).toBe(false);
    expect(workoutInput.safeParse({ ...base, avg_pace_s_per_km: 300 }).success).toBe(false); // 伺服器衍生欄位不可覆寫
    expect(workoutInput.safeParse({ ...base, distance_mm: "99999999999" }).success).toBe(false); // 超上限
    expect(workoutInput.parse({ ...base, distance_mm: "5000000" }).distance_mm).toBe(5_000_000n);
  });
});

describe("POST /workouts/import、/me/workouts", () => {
  it("匯入 → 201；同 revision 重送 same 200；舊 revision stale；新 revision 取代（revision+1）；清單／明細；刪除 tombstone 擋重建", async () => {
    const u = await login();
    let r = await app.inject({ method: "POST", url: "/v1/workouts/import", headers: u.h, payload: { sessions: [{ ...base, distance_mm: "5000000", distance_method: "device", steps: 6000, active_energy_mkcal: "320000", energy_method: "device" }] } });
    expect(r.statusCode).toBe(201);
    const s1 = j(r).results[0];
    expect(s1.outcome).toBe("created");
    expect(s1.session.metrics).toMatchObject({ distance: { value_mm: "5000000", method: "device" }, avg_pace_s_per_km: 300, active_energy: { value_mkcal: "320000", method: "device" } });
    expect(s1.session.elapsed_ms).toBe("1500000");
    r = await app.inject({ method: "POST", url: "/v1/workouts/import", headers: u.h, payload: { sessions: [{ ...base, distance_mm: "5000000", distance_method: "device" }] } });
    expect([r.statusCode, j(r).results[0].outcome]).toEqual([200, "same"]);
    r = await app.inject({ method: "POST", url: "/v1/workouts/import", headers: u.h, payload: { sessions: [{ ...base, source_revision: 2, distance_mm: "5100000", distance_method: "device" }] } });
    const s2 = j(r).results[0];
    expect([s2.outcome, s2.session.session_id, s2.session.revision, s2.session.metrics.distance.value_mm]).toEqual(["superseded", s1.session.session_id, 2, "5100000"]);
    r = await app.inject({ method: "POST", url: "/v1/workouts/import", headers: u.h, payload: { sessions: [{ ...base, source_revision: 1, distance_mm: "5000000", distance_method: "device" }] } });
    expect(j(r).results[0].outcome).toBe("stale");
    const list = j(await app.inject({ method: "GET", url: "/v1/me/workouts", headers: u.h }));
    expect(list.items).toHaveLength(1);
    expect(j(await app.inject({ method: "GET", url: `/v1/me/workouts/${s1.session.session_id}`, headers: u.h })).source.source_revision).toBe(2);
    // 他人看不到
    const v = await login();
    expect((await app.inject({ method: "GET", url: `/v1/me/workouts/${s1.session.session_id}`, headers: v.h })).statusCode).toBe(404);
    // 刪除 → 清單空；同 revision 重送回 deleted，不重建；更新的 revision 可重建
    expect((await app.inject({ method: "DELETE", url: `/v1/me/workouts/${s1.session.session_id}`, headers: u.h })).statusCode).toBe(204);
    expect(j(await app.inject({ method: "GET", url: "/v1/me/workouts", headers: u.h })).items).toHaveLength(0);
    r = await app.inject({ method: "POST", url: "/v1/workouts/import", headers: u.h, payload: { sessions: [{ ...base, source_revision: 2, distance_mm: "5100000", distance_method: "device" }] } });
    expect(j(r).results[0].outcome).toBe("deleted");
    r = await app.inject({ method: "POST", url: "/v1/workouts/import", headers: u.h, payload: { sessions: [{ ...base, source_revision: 3, distance_mm: "5100000", distance_method: "device" }] } });
    expect(j(r).results[0].outcome).toBe("superseded");
    expect(j(await app.inject({ method: "GET", url: "/v1/me/workouts", headers: u.h })).items).toHaveLength(1);
  });

  it("跨來源同場（重疊 ≥ 50%）：第二筆標 possible_duplicate_of，不合併；invalid 列不入庫；DELETE /player/data 清掉全部", async () => {
    const u = await login();
    const r = await app.inject({ method: "POST", url: "/v1/workouts/import", headers: u.h, payload: { sessions: [
      { ...base, distance_mm: "5000000", distance_method: "device" },
      { ...base, origin: "gps", source_id: "neonshift", external_record_id: "local-1", started_at: "2026-09-14T00:01:00Z", ended_at: "2026-09-14T00:24:00Z", distance_mm: "4900000", distance_method: "gps" },
      { ...base, external_record_id: "bad", ended_at: "2026-09-13T00:00:00Z" },
    ] } });
    const res = j(r).results;
    expect(res.map((x: { outcome: string }) => x.outcome)).toEqual(["created", "created", "invalid"]);
    expect(res[1].session.possible_duplicate_of).toBe(res[0].session.session_id);
    expect(res[0].session.possible_duplicate_of).toBeNull();
    expect(j(await app.inject({ method: "GET", url: "/v1/me/workouts", headers: u.h })).items).toHaveLength(2);
    // 超過 50 筆拒絕
    expect((await app.inject({ method: "POST", url: "/v1/workouts/import", headers: u.h, payload: { sessions: Array.from({ length: 51 }, (_, i) => ({ ...base, external_record_id: `x${i}` })) } })).statusCode).toBe(422);
    await app.inject({ method: "DELETE", url: "/v1/player/data", headers: u.h });
    expect(await store.listWorkouts(u.wallet, 10, 0)).toEqual([]);
  });
});
