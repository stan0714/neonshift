/** PG-R-01：匯入驗證與衍生（估算距離、品質、PB 資格）、來源 revision 去重、跨來源可能重複、刪除 tombstone、DELETE /player/data 同步。 */
import bs58 from "bs58";
import nacl from "tweetnacl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import type { Db } from "../db.js";
import { LocalKeypairSigner } from "../signer/index.js";
import { MemoryStore } from "../store/memory.js";
import { derive, workoutInput, intentOf } from "./schema.js";

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
  it("防弊二線：完整性旗標（client_flags 或 extras.integrity.flags 任一）→ needs_review 且不具 PB；未知旗標忽略；5 秒最高速度／移動時間平均超上限；取樣過疏 partial；伺服器原因", () => {
    const gps = { origin: "gps", distance_mm: "5000000", distance_method: "gps" };
    for (const f of ["mock_location", "sustained_speed", "gap_teleport", "clock_drift", "motion_mismatch"]) {
      const d = derive(parse({ ...gps, client_flags: [f] }));
      expect([d.quality, d.status, d.pbEligible]).toEqual(["needs_review", "needs_review", false]);
      expect(d.reviewReasons).toContain(f);
    }
    expect(derive(parse({ ...gps, extras: { integrity: { flags: ["mock_location"] } } })).reviewReasons).toContain("mock_location");
    expect(derive(parse({ ...gps, client_flags: ["totally_unknown"] })).quality).toBe("complete");
    expect(derive(parse({ ...gps, extras: { max_speed_5s_kmh: 40 } })).reviewReasons).toContain("max_speed_5s_exceeds_cap"); // 跑步 > 36
    expect(derive(parse({ ...gps, sport: "walk", intent: "brisk", distance_mm: "3000000", extras: { max_speed_5s_kmh: 14 } })).quality).toBe("complete");
    // 25 分鐘含 15 分鐘暫停：平均含暫停 12 km/h 過關，但移動時間 10 分鐘 5 km ＝ 30 km/h → 超上限
    expect(derive(parse({ ...gps, paused_ms: "900000", extras: { moving_ms: 600_000 } })).reviewReasons).toContain("moving_speed_exceeds_cap");
    const sparse = derive(parse({ ...gps, extras: { moving_ms: 1_500_000, quality: { accepted: 100 } } })); // 1500 s 只有 100 點
    expect([sparse.quality, sparse.pbEligible, sparse.reviewReasons]).toEqual(["partial", false, ["sparse_samples"]]);
    expect(derive(parse({ ...gps, extras: { moving_ms: 1_500_000, quality: { accepted: 1400 } } })).quality).toBe("complete");
    expect(derive(parse(gps), ["overlapping_session"]).status).toBe("needs_review");
    expect(derive(parse(gps), ["daily_cap_exceeded"]).reviewReasons).toEqual(["daily_cap_exceeded"]);
  });
  it("schema：拒絕非有限／負值／未知 sport／多餘欄位；大整數字串", () => {
    expect(workoutInput.safeParse({ ...base, distance_mm: -1 }).success).toBe(false);
    expect(workoutInput.safeParse({ ...base, sport: "cycle" }).success).toBe(false);
    expect(workoutInput.safeParse({ ...base, avg_pace_s_per_km: 300 }).success).toBe(false); // 伺服器衍生欄位不可覆寫
    expect(workoutInput.safeParse({ ...base, distance_mm: "99999999999" }).success).toBe(false); // 超上限
    expect(workoutInput.parse({ ...base, distance_mm: "5000000" }).distance_mm).toBe(5_000_000n);
  });
  it("PG-U-01 intent／goal：缺省 null（跑步可推導 run，走路不自動判定健走）；模式與分類不符拒絕；目標單位／正值檢查", () => {
    expect(workoutInput.parse(base).intent).toBeNull();
    expect(intentOf(workoutInput.parse(base))).toBe("run");
    expect(intentOf(workoutInput.parse({ ...base, sport: "walk" }))).toBeNull();
    expect(workoutInput.parse({ ...base, sport: "walk", intent: "brisk" }).intent).toBe("brisk");
    expect(workoutInput.safeParse({ ...base, sport: "walk", intent: "run" }).success).toBe(false);
    expect(workoutInput.safeParse({ ...base, intent: "brisk" }).success).toBe(false);
    expect(workoutInput.parse({ ...base, goal: { kind: "time", target: 1200, unit: "s", version: 1 } }).goal).toEqual({ kind: "time", target: 1200, unit: "s", version: 1 });
    expect(workoutInput.safeParse({ ...base, goal: { kind: "time", target: 1200, unit: "mm", version: 1 } }).success).toBe(false);
    expect(workoutInput.safeParse({ ...base, goal: { kind: "distance", target: 0, unit: "mm", version: 1 } }).success).toBe(false);
    expect(workoutInput.safeParse({ ...base, goal: { kind: "free", target: 0, unit: "s", version: 1 } }).success).toBe(true);
  });
});

describe("POST /workouts/import、/me/workouts", () => {
  it("防弊二線（route）：同錢包時間重疊的另一筆 → overlapping_session needs_review；同批重疊亦算；不同錢包不互相影響", async () => {
    const u = await login();
    const a = { ...base, external_record_id: "ov-1", distance_mm: "5000000", distance_method: "device" };
    let r = await app.inject({ method: "POST", url: "/v1/workouts/import", headers: u.h, payload: { sessions: [a] } });
    expect(r.statusCode).toBe(201);
    expect(r.json().results[0].session.status).toBe("saved");
    // 與 ov-1 重疊（00:10～00:30）
    r = await app.inject({ method: "POST", url: "/v1/workouts/import", headers: u.h, payload: { sessions: [{ ...a, external_record_id: "ov-2", started_at: "2026-09-14T00:10:00Z", ended_at: "2026-09-14T00:30:00Z" }] } });
    expect(r.json().results[0].session.status).toBe("needs_review");
    expect(r.json().results[0].session.review_reasons).toContain("overlapping_session");
    // 不重疊（01:00～01:20）→ saved；同批兩筆互相重疊 → 第二筆標
    r = await app.inject({ method: "POST", url: "/v1/workouts/import", headers: u.h, payload: { sessions: [{ ...a, external_record_id: "ov-3", started_at: "2026-09-14T01:00:00Z", ended_at: "2026-09-14T01:20:00Z" }, { ...a, external_record_id: "ov-4", started_at: "2026-09-14T01:10:00Z", ended_at: "2026-09-14T01:30:00Z" }] } });
    expect(r.json().results.map((x: { session: { status: string } }) => x.session.status)).toEqual(["saved", "needs_review"]);
    // 同一筆重送（同 external_record_id）不會自己跟自己重疊
    r = await app.inject({ method: "POST", url: "/v1/workouts/import", headers: u.h, payload: { sessions: [a] } });
    expect(r.json().results[0].outcome).toBe("same");
    const v = await login();
    r = await app.inject({ method: "POST", url: "/v1/workouts/import", headers: v.h, payload: { sessions: [a] } });
    expect(r.json().results[0].session.status).toBe("saved");
  });
  it("匯入 → 201；同 revision 重送 same 200；舊 revision stale；新 revision 取代（revision+1）；清單／明細；刪除 tombstone 擋重建", async () => {
    const u = await login();
    let r = await app.inject({ method: "POST", url: "/v1/workouts/import", headers: u.h, payload: { sessions: [{ ...base, distance_mm: "5000000", distance_method: "device", steps: 6000, active_energy_mkcal: "320000", energy_method: "device" }] } });
    expect(r.statusCode).toBe(201);
    const s1 = j(r).results[0];
    expect(s1.outcome).toBe("created");
    expect(s1.session.metrics).toMatchObject({ distance: { value_mm: "5000000", method: "device" }, avg_pace_s_per_km: 300, active_energy: { value_mkcal: "320000", method: "device" } });
    expect(s1.session.elapsed_ms).toBe("1500000");
    expect([s1.session.intent, s1.session.goal]).toEqual(["run", null]); // PG-U-01：跑步推導 run
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

  it("PG-LINK-04 日誌查詢：[from,to) 月份範圍、sport／intent／source／status 篩選、asc 由舊到新、游標分頁穩定不重複不漏列；舊參數不變", async () => {
    const u = await login();
    const mk = (id: string, day: string, extra: Record<string, unknown> = {}) => ({ ...base, external_record_id: id, started_at: `2026-09-${day}T01:00:00Z`, ended_at: `2026-09-${day}T01:25:00Z`, ...extra });
    await app.inject({ method: "POST", url: "/v1/workouts/import", headers: u.h, payload: { sessions: [mk("a", "19"), mk("b", "17"), mk("c", "18", { sport: "walk", intent: "brisk" }), mk("d", "02", { origin: "gps", source_id: "cc.neonshift.app/gps", distance_mm: "5000000", distance_method: "gps" }), { ...base, external_record_id: "e", started_at: "2026-08-31T23:00:00Z", ended_at: "2026-08-31T23:20:00Z" }] } });
    const ids = (r: { json: () => unknown }) => j(r).items.map((x: { source: { external_record_id: string } }) => x.source.external_record_id);
    // 舊參數：由新到舊、無 next_cursor
    let r = await app.inject({ method: "GET", url: "/v1/me/workouts", headers: u.h });
    expect(ids(r)).toEqual(["a", "c", "b", "d", "e"]);
    expect(j(r).next_cursor).toBeNull();
    // 九月 [from,to)：8/31 排除；asc 由舊到新
    r = await app.inject({ method: "GET", url: "/v1/me/workouts?from=2026-09-01T00:00:00Z&to=2026-10-01T00:00:00Z&order=asc", headers: u.h });
    expect(ids(r)).toEqual(["d", "b", "c", "a"]);
    expect(j(r).total).toBe(4);
    // 篩選
    expect(ids(await app.inject({ method: "GET", url: "/v1/me/workouts?sport=walk&order=asc", headers: u.h }))).toEqual(["c"]);
    expect(ids(await app.inject({ method: "GET", url: "/v1/me/workouts?intent=brisk&order=asc", headers: u.h }))).toEqual(["c"]);
    expect(ids(await app.inject({ method: "GET", url: "/v1/me/workouts?source=gps&order=asc", headers: u.h }))).toEqual(["d"]);
    expect(ids(await app.inject({ method: "GET", url: "/v1/me/workouts?source=imported&order=asc", headers: u.h }))).toEqual(["e", "b", "c", "a"]);
    expect(ids(await app.inject({ method: "GET", url: "/v1/me/workouts?status=saved&order=asc", headers: u.h })).length).toBeGreaterThan(0);
    // 游標分頁：limit 2 → 三頁，不重複不漏列
    r = await app.inject({ method: "GET", url: "/v1/me/workouts?order=asc&limit=2", headers: u.h });
    const p1 = ids(r); const c1 = j(r).cursor ?? j(r).next_cursor;
    r = await app.inject({ method: "GET", url: `/v1/me/workouts?order=asc&limit=2&cursor=${c1}`, headers: u.h });
    const p2 = ids(r); const c2 = j(r).next_cursor;
    r = await app.inject({ method: "GET", url: `/v1/me/workouts?order=asc&limit=2&cursor=${c2}`, headers: u.h });
    const p3 = ids(r);
    expect([...p1, ...p2, ...p3]).toEqual(["e", "d", "b", "c", "a"]);
    expect(j(r).next_cursor).toBeNull();
    expect((await app.inject({ method: "GET", url: "/v1/me/workouts?order=sideways", headers: u.h })).statusCode).toBeGreaterThanOrEqual(400);
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

it('更正運動數值或移除 extras 不得更換已保存的 route 背景', async () => {
  const u = await login();
  const send = (source_revision: number, extras: Record<string, unknown>) => app.inject({ method: 'POST', url: '/v1/workouts/import', headers: u.h, payload: { sessions: [{ ...base, source_revision, distance_mm: '5000000', distance_method: 'device', extras }] } });
  const first = j(await send(1, { route_appearance: { version: 1, layer: 'ocean' } })).results[0].session;
  const changed = j(await send(2, { route_appearance: { version: 1, layer: 'snow' }, moving_ms: 1200000 })).results[0].session;
  expect(changed.session_id).toBe(first.session_id);
  expect(changed.extras).toMatchObject({ route_appearance: { version: 1, layer: 'ocean' }, moving_ms: 1200000 });
  const omitted = j(await send(3, {})).results[0].session;
  expect(omitted.extras.route_appearance).toEqual({ version: 1, layer: 'ocean' });
});
