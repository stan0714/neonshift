/** PG-M-01／M-02：首次里程碑判定（門檻邊界、不累加、待審／估算／手動不合格、裝置半馬／全馬未開放、同筆全馬解鎖四章、首次＝最早、DNF 不授予、缺賽事時間待審）與 GET /me/milestones 端到端。 */
import bs58 from "bs58";
import nacl from "tweetnacl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { candidatesFromResult, candidatesFromWorkout, resolveMilestones, type MilestoneCandidate } from "./compute.js";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import type { Db } from "../db.js";
import { galleryProjection } from "../gallery/projection.js";
import { decodeAchievement } from "../lib/achievement.js";
import { milestoneAchievementIdOf } from "../pb/achievements.js";
import { LocalKeypairSigner } from "../signer/index.js";
import { MemoryStore } from "../store/memory.js";

const wo = (o: Partial<Parameters<typeof candidatesFromWorkout>[0]> & { sessionId: string; distanceMm: bigint }) => candidatesFromWorkout({ sourceRevision: 1, endedAt: new Date("2026-09-01T01:00:00Z"), sport: "run", environment: "outdoor", origin: "gps", status: "saved", distanceMethod: "gps", pbEligible: true, ...o });
const cats = (c: MilestoneCandidate[]) => c.map((x) => x.category);

describe("compute", () => {
  it("門檻邊界：4,999.999／5,000、9,999.999／10,000、21,097.499／21,097.5、42,194.999／42,195 m（整數毫米，不四捨五入）", () => {
    expect(cats(wo({ sessionId: "a", distanceMm: 4_999_999n }))).toEqual([]);
    expect(cats(wo({ sessionId: "a", distanceMm: 5_000_000n }))).toEqual(["first_5k"]);
    expect(cats(wo({ sessionId: "a", distanceMm: 9_999_999n }))).toEqual(["first_5k"]);
    expect(cats(wo({ sessionId: "a", distanceMm: 10_000_000n }))).toEqual(["first_5k", "first_10k"]);
    expect(cats(wo({ sessionId: "a", distanceMm: 21_097_499n }))).toEqual(["first_5k", "first_10k"]);
    expect(cats(wo({ sessionId: "a", distanceMm: 21_097_500n }))).toEqual(["first_5k", "first_10k", "first_half"]);
    expect(cats(wo({ sessionId: "a", distanceMm: 42_194_999n }))).toEqual(["first_5k", "first_10k", "first_half"]);
    expect(cats(wo({ sessionId: "a", distanceMm: 42_195_000n }))).toEqual(["first_5k", "first_10k", "first_half", "first_marathon"]);
  });
  it("裝置來源：5K／10K 可領；半馬／全馬 device_pending；待審／非 pb_eligible → needs_review；估算距離／手動 → 不合格；走路／已刪除無候選", () => {
    const full = wo({ sessionId: "m", distanceMm: 42_195_000n });
    expect(full.map((c) => [c.category, c.eligible, c.reason])).toEqual([["first_5k", true, null], ["first_10k", true, null], ["first_half", false, "device_pending"], ["first_marathon", false, "device_pending"]]);
    expect(wo({ sessionId: "r", distanceMm: 5_000_000n, status: "needs_review" })[0]).toMatchObject({ eligible: false, reason: "needs_review" });
    expect(wo({ sessionId: "r", distanceMm: 5_000_000n, pbEligible: false })[0]).toMatchObject({ eligible: false, reason: "needs_review" });
    expect(wo({ sessionId: "e", distanceMm: 5_000_000n, distanceMethod: "estimated" })[0]).toMatchObject({ eligible: false, reason: "estimated" });
    expect(wo({ sessionId: "h", distanceMm: 5_000_000n, origin: "manual" })[0]).toMatchObject({ eligible: false, reason: "manual" });
    expect(wo({ sessionId: "w", distanceMm: 5_000_000n, sport: "walk" })).toEqual([]);
    expect(wo({ sessionId: "d", distanceMm: 5_000_000n, status: "deleted" })).toEqual([]);
  });
  it("主辦方結果：FINISHED 才有 first_finish；正式距離 ≥ 門檻解鎖距離章（半馬／全馬開放）；DNF／DNS／DQ 無；缺賽事時間 → missing_time 待審；walk 只有 first_finish", () => {
    const at = new Date("2026-10-03T00:00:00Z");
    const m = candidatesFromResult({ revisionId: "r1", discipline: "run", finishStatus: "finished", distanceM: 42195, eventAt: at });
    expect(cats(m)).toEqual(["first_finish", "first_5k", "first_10k", "first_half", "first_marathon"]);
    expect(m.every((c) => c.eligible && c.verificationClass === "organizer" && c.achievedAt === at)).toBe(true);
    expect(cats(candidatesFromResult({ revisionId: "r2", discipline: "run", finishStatus: "finished", distanceM: 21097.5, eventAt: at }))).toEqual(["first_finish", "first_5k", "first_10k", "first_half"]);
    expect(cats(candidatesFromResult({ revisionId: "r3", discipline: "run", finishStatus: "finished", distanceM: 21090, eventAt: at }))).toEqual(["first_finish", "first_5k", "first_10k"]); // 21.09 km ≠ 半馬
    for (const st of ["dnf", "dns", "dq"]) expect(candidatesFromResult({ revisionId: "x", discipline: "run", finishStatus: st, distanceM: 42195, eventAt: at })).toEqual([]);
    expect(candidatesFromResult({ revisionId: "r4", discipline: "run", finishStatus: "finished", distanceM: 5000, eventAt: null }).map((c) => [c.category, c.eligible, c.reason])).toEqual([["first_finish", false, "missing_time"], ["first_5k", false, "missing_time"]]);
    expect(cats(candidatesFromResult({ revisionId: "r5", discipline: "walk", finishStatus: "finished", distanceM: 10000, eventAt: at }))).toEqual(["first_finish"]);
  });
  it("resolve：首次＝最早 achieved_at（同時間依 sourceId）；不累加兩次 3 km；待審來源只標 pending_review；目錄固定 9 張＋室內附加；同筆全馬同時解鎖四章引用同一來源", () => {
    const early = wo({ sessionId: "b", distanceMm: 5_000_000n, endedAt: new Date("2026-08-01T00:00:00Z") });
    const late = wo({ sessionId: "a", distanceMm: 6_000_000n, endedAt: new Date("2026-09-01T00:00:00Z") });
    const same = wo({ sessionId: "c", distanceMm: 5_500_000n, endedAt: new Date("2026-08-01T00:00:00Z") });
    const res = resolveMilestones([...late, ...early, ...same]);
    expect(res).toHaveLength(9);
    const k5 = res.find((m) => m.key === "first_5k|outdoor|device")!;
    expect(k5.status).toBe("eligible");
    expect(k5.first?.sourceId).toBe("b"); // 同時間 b < c
    expect(res.find((m) => m.key === "first_10k|outdoor|device")?.status).toBe("locked");
    expect(res.find((m) => m.key === "first_half|outdoor|organizer")?.status).toBe("locked");
    // 兩次 3 km 不累加
    expect(resolveMilestones([...wo({ sessionId: "x", distanceMm: 3_000_000n }), ...wo({ sessionId: "y", distanceMm: 3_000_000n })]).every((m) => m.status === "locked")).toBe(true);
    // 只有待審來源
    const pr = resolveMilestones(wo({ sessionId: "p", distanceMm: 5_000_000n, status: "needs_review" })).find((m) => m.key === "first_5k|outdoor|device")!;
    expect(pr).toMatchObject({ status: "pending_review", first: null });
    expect(pr.pending?.sourceId).toBe("p");
    // 裝置全馬：5K／10K eligible、半馬／全馬 device_pending；室內附加一張
    const dev = resolveMilestones([...wo({ sessionId: "m", distanceMm: 42_195_000n }), ...wo({ sessionId: "i", distanceMm: 5_000_000n, environment: "indoor" })]);
    expect(dev).toHaveLength(10);
    expect(dev.find((m) => m.key === "first_marathon|outdoor|device")?.status).toBe("device_pending");
    expect(dev.find((m) => m.key === "first_5k|indoor|device")?.status).toBe("eligible");
    // 主辦方全馬：四章＋first_finish 同一來源
    const org = resolveMilestones(candidatesFromResult({ revisionId: "r1", discipline: "run", finishStatus: "finished", distanceM: 42195, eventAt: new Date("2026-10-03T00:00:00Z") }));
    const unlocked = org.filter((m) => m.verificationClass === "organizer" && m.status === "eligible");
    expect(unlocked.map((m) => m.category).sort()).toEqual(["first_10k", "first_5k", "first_finish", "first_half", "first_marathon"]);
    expect(new Set(unlocked.map((m) => m.first!.sourceId)).size).toBe(1);
  });
});

describe("GET /me/milestones", () => {
  const db: Db = { pool: null, ping: async () => false, close: async () => {} };
  let app: ReturnType<typeof buildApp>;
  let store: MemoryStore;
  const clock = new Date("2026-09-14T06:00:00Z");
  beforeEach(async () => {
    store = new MemoryStore();
    app = buildApp({ config: loadConfig({ NODE_ENV: "test", OPS_TOKEN: "ops-token-for-tests-0001" }), db, store, now: () => clock, signer: LocalKeypairSigner.random() });
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
  const gps = (id: string, day: string, km: number) => ({ sport: "run", environment: "outdoor", origin: "gps", source_id: "cc.neonshift.app/gps", external_record_id: id, started_at: `${day}T00:00:00Z`, ended_at: `${day}T01:00:00Z`, distance_mm: String(Math.round(km * 1_000_000)), distance_method: "gps", extras: {} });

  it("匯入 5 km → first_5k 可領；再匯入更早 12 km → first_5k 改引用更早筆（同 key 不重發）、first_10k 可領；刪除來源 → 回落；主辦方全馬（賽事時間）→ organizer 五章同一來源；更正 DNF → 鎖回", async () => {
    const u = await login();
    let m = j(await app.inject({ method: "GET", url: "/v1/me/milestones", headers: u.h }));
    expect(m.items).toHaveLength(9);
    expect(m.items.every((x: { status: string }) => x.status === "locked")).toBe(true);
    await app.inject({ method: "POST", url: "/v1/workouts/import", headers: u.h, payload: { sessions: [gps("w1", "2026-09-05", 5)] } });
    m = j(await app.inject({ method: "GET", url: "/v1/me/milestones", headers: u.h }));
    const item = (k: string) => m.items.find((x: { key: string }) => x.key === k);
    expect(item("first_5k|outdoor|device")).toMatchObject({ status: "eligible", threshold_mm: "5000000" });
    expect(m.imported_since).toBe("2026-09-05T00:00:00.000Z");
    const w1 = item("first_5k|outdoor|device").first.source.id;
    await app.inject({ method: "POST", url: "/v1/workouts/import", headers: u.h, payload: { sessions: [gps("w0", "2026-08-20", 12)] } });
    m = j(await app.inject({ method: "GET", url: "/v1/me/milestones", headers: u.h }));
    const w0 = item("first_10k|outdoor|device").first.source.id;
    expect(item("first_5k|outdoor|device").first.source.id).toBe(w0); // 更早資料只修正關聯，不再發第二枚
    expect(m.unlocked_by_source).toEqual([{ kind: "workout", id: w0, categories: ["first_5k", "first_10k"] }]);
    await app.inject({ method: "DELETE", url: `/v1/me/workouts/${w0}`, headers: u.h });
    m = j(await app.inject({ method: "GET", url: "/v1/me/milestones", headers: u.h }));
    expect(item("first_5k|outdoor|device").first.source.id).toBe(w1);
    expect(item("first_10k|outdoor|device").status).toBe("locked");
    // 主辦方全馬
    const owner = await login();
    const org = j(await app.inject({ method: "POST", url: "/v1/partner/orgs", headers: { authorization: "Bearer ops-token-for-tests-0001" }, payload: { name: "Club", slug: "club", owner_wallet: owner.wallet } }));
    const ev = j(await app.inject({ method: "POST", url: "/v1/partner/events", headers: owner.h, payload: { org_id: org.org_id, slug: "city-marathon", title: "City Marathon", timezone: "UTC", starts_at: "2026-10-03T00:00:00Z", ends_at: "2026-10-03T08:00:00Z", capacity: 10 } }));
    const rev = j(await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/rule-revisions`, headers: owner.h, payload: { rules: {} } }));
    await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/publish`, headers: owner.h, payload: { revision_id: rev.revision_id } });
    await app.inject({ method: "POST", url: `/v1/events/${ev.event_id}/registrations`, headers: u.h, payload: { accepted_rule_revision: rev.revision_id } });
    const HEAD = "participant_ref,discipline,division,finish_status,distance_m,elapsed_ms,rank";
    const imp = j(await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/result-imports`, headers: owner.h, payload: { csv: `${HEAD}\n${u.wallet},run,,finished,42195,15000000,1` } }));
    await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/result-imports/${imp.import_id}/publish`, headers: owner.h, payload: {} });
    m = j(await app.inject({ method: "GET", url: "/v1/me/milestones", headers: u.h }));
    for (const k of ["first_finish", "first_5k", "first_10k", "first_half", "first_marathon"]) expect(item(`${k}|outdoor|organizer`)).toMatchObject({ status: "eligible", first: { achieved_at: "2026-10-03T00:00:00.000Z", distance_mm: "42195000" } });
    const src = m.unlocked_by_source.find((s: { kind: string }) => s.kind === "result");
    expect(src.categories).toHaveLength(5);
    expect(item("first_marathon|outdoor|device").status).toBe("locked"); // 裝置組不受影響
    // 更正 DNF → 全部鎖回
    const fix = j(await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/result-imports`, headers: owner.h, payload: { csv: `${HEAD}\n${u.wallet},run,,dnf,30000,0,` } }));
    await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/result-imports/${fix.import_id}/publish`, headers: owner.h, payload: { reason: "chip error" } });
    m = j(await app.inject({ method: "GET", url: "/v1/me/milestones", headers: u.h }));
    expect(m.items.filter((x: { verification_class: string }) => x.verification_class === "organizer").every((x: { status: string }) => x.status === "locked")).toBe(true);
  });
});

describe("PG-M-02 里程碑鑄造：穩定 key、registry、更正與終身防重領", () => {
  const db: Db = { pool: null, ping: async () => false, close: async () => {} };
  const PROGRAM = "6MhVoQHdEpY2hqkaNJMkT2vHWakfnGfEYDgCtJzh6ENA";
  const OPS = { authorization: "Bearer ops-token-for-tests-0001" };
  let app: ReturnType<typeof buildApp>;
  let store: MemoryStore;
  let signer: LocalKeypairSigner;
  const clock = new Date("2026-09-14T06:00:00Z");
  beforeEach(async () => {
    store = new MemoryStore();
    signer = LocalKeypairSigner.random();
    app = buildApp({ config: loadConfig({ NODE_ENV: "test", OPS_TOKEN: "ops-token-for-tests-0001", PROGRAM_ID: PROGRAM }), db, store, now: () => clock, signer });
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
  const gps = (id: string, day: string, km: number) => ({ sport: "run", environment: "outdoor", origin: "gps", source_id: "cc.neonshift.app/gps", external_record_id: id, started_at: `${day}T00:00:00Z`, ended_at: `${day}T01:00:00Z`, distance_mm: String(Math.round(km * 1_000_000)), distance_method: "gps", extras: {} });
  const KEY = "first_5k|outdoor|device";
  const ASSET = bs58.encode(Buffer.alloc(32, 7));

  it("未達標 409；達標 → pending_registry（metadata 不含精確值）；ops 核准 → 證明 category 7；更早回填 → 同 id 換來源回 pending；刪除來源 → revoke_pending；重新達標 → 同 id 恢復", async () => {
    const u = await login();
    expect(j(await app.inject({ method: "POST", url: "/v1/me/milestones/mint-intent", headers: u.h, payload: { key: KEY, public_consent: false } })).error.code).toBe("MILESTONE_NOT_ELIGIBLE");
    expect((await app.inject({ method: "POST", url: "/v1/me/milestones/mint-intent", headers: u.h, payload: { key: "bad key", public_consent: false } })).statusCode).toBe(422);
    await app.inject({ method: "POST", url: "/v1/workouts/import", headers: u.h, payload: { sessions: [gps("w1", "2026-09-05", 5.2)] } });
    let it = j(await app.inject({ method: "POST", url: "/v1/me/milestones/mint-intent", headers: u.h, payload: { key: KEY, public_consent: false } }));
    const id = milestoneAchievementIdOf(u.wallet, KEY);
    expect(it.achievement).toMatchObject({ achievement_id: id, kind: "milestone", milestone_key: KEY, pb_id: null, category: "first_5k", verification_class: "device", status: "pending_registry" });
    expect(it.proof).toBeNull();
    expect(it.fee_estimate_lamports).toBeGreaterThan(0);
    const attrs = it.metadata_preview.attributes as { trait_type: string; value: string }[];
    expect(attrs.map((a) => a.trait_type)).toEqual(["Series", "Milestone", "Verification", "Environment", "Rules", "Threshold"]); // 無 Distance／Achieved
    expect(it.metadata_preview.image).toBe("https://neonshift.cc/nft/achievements/milestones/first_5k-device.svg");
    // 公開同意 → 含距離與日期，hash 改變，仍同一 id
    it = j(await app.inject({ method: "POST", url: "/v1/me/milestones/mint-intent", headers: u.h, payload: { key: KEY, public_consent: true } }));
    expect(it.achievement.achievement_id).toBe(id);
    expect((it.metadata_preview.attributes as { trait_type: string; value: string }[]).slice(-2)).toEqual([{ trait_type: "Distance", value: "5.200 km" }, { trait_type: "Achieved", value: "2026-09-05" }]);
    const w1 = it.achievement.source.id;
    // ops 核准 → 證明
    const pending = j(await app.inject({ method: "GET", url: "/v1/ops/achievements/pending", headers: OPS })).items;
    expect(pending[0]).toMatchObject({ achievement_id: id, category_code: 7, class_code: 2, desired_status: "approved" });
    await app.inject({ method: "POST", url: `/v1/ops/achievements/${id}/registry`, headers: OPS, payload: { status: "approved", signature: "5".repeat(64) } });
    it = j(await app.inject({ method: "POST", url: "/v1/me/milestones/mint-intent", headers: u.h, payload: { key: KEY, public_consent: true } }));
    expect(it.status).toBe("approved");
    const p = decodeAchievement(Buffer.from(it.proof.message_b64, "base64"));
    expect([p.category, p.verificationClass, p.rulesVersion, Buffer.from(p.achievementId).toString("hex")]).toEqual([7, 2, 1, id]);
    expect(nacl.sign.detached.verify(new Uint8Array(Buffer.from(it.proof.message_b64, "base64")), new Uint8Array(Buffer.from(it.proof.signature_b64, "base64")), await signer.publicKey())).toBe(true);
    // 更早回填 6 km → 首次改引用更早筆：同 id、來源換、metadata 重建 → pending_registry（不再發第二枚）
    await app.inject({ method: "POST", url: "/v1/workouts/import", headers: u.h, payload: { sessions: [gps("w0", "2026-08-01", 6)] } });
    let items = j(await app.inject({ method: "GET", url: "/v1/me/achievements", headers: u.h })).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ achievement_id: id, status: "pending_registry" });
    expect(items[0].source.id).not.toBe(w1);
    const w0 = items[0].source.id;
    // 刪除兩筆來源 → revoke_pending → ops revoked；重新達標 → 同 id 回 pending_registry
    await app.inject({ method: "DELETE", url: `/v1/me/workouts/${w0}`, headers: u.h });
    await app.inject({ method: "DELETE", url: `/v1/me/workouts/${w1}`, headers: u.h });
    items = j(await app.inject({ method: "GET", url: "/v1/me/achievements", headers: u.h })).items;
    expect(items[0].status).toBe("revoke_pending");
    await app.inject({ method: "POST", url: `/v1/ops/achievements/${id}/registry`, headers: OPS, payload: { status: "revoked", signature: "6".repeat(64) } });
    expect(j(await app.inject({ method: "POST", url: "/v1/me/milestones/mint-intent", headers: u.h, payload: { key: KEY, public_consent: true } })).error.code).toBe("MILESTONE_NOT_ELIGIBLE");
    await app.inject({ method: "POST", url: "/v1/workouts/import", headers: u.h, payload: { sessions: [gps("w2", "2026-09-10", 5)] } });
    items = j(await app.inject({ method: "GET", url: "/v1/me/achievements", headers: u.h })).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ achievement_id: id, status: "pending_registry", source: { kind: "workout" } });
  });

  it("已鑄造：來源刪除 → revoke_pending 但 minted 保留；重新達標 → 回 minted 並更新來源（不鑄第二枚）；來源更正只更新來源欄位、metadata 快照不動；藝廊投影 kind=milestone", async () => {
    const u = await login();
    await app.inject({ method: "POST", url: "/v1/workouts/import", headers: u.h, payload: { sessions: [gps("w1", "2026-09-05", 5)] } });
    await app.inject({ method: "POST", url: "/v1/me/milestones/mint-intent", headers: u.h, payload: { key: KEY, public_consent: false } });
    const id = milestoneAchievementIdOf(u.wallet, KEY);
    await app.inject({ method: "POST", url: `/v1/ops/achievements/${id}/registry`, headers: OPS, payload: { status: "approved", signature: "5".repeat(64) } });
    await galleryProjection({ signature: "sigMint", slot: 100, eventIndex: 0, name: "AchievementClaimed", payload: { wallet: u.wallet, achievement_id: id, category: 7, verification_class: 2, source_revision: 1, asset: ASSET }, status: "finalized", observedAt: clock, finalizedAt: clock } as never, store as never, clock);
    let a = j(await app.inject({ method: "GET", url: "/v1/me/achievements", headers: u.h })).items[0];
    expect([a.status, a.minted, a.asset]).toEqual(["minted", true, ASSET]);
    const hashMinted = a.metadata_hash;
    const w1 = a.source.id;
    // 更早回填 → 已鑄造只更新來源，metadata／狀態不動
    await app.inject({ method: "POST", url: "/v1/workouts/import", headers: u.h, payload: { sessions: [gps("w0", "2026-08-01", 7)] } });
    a = j(await app.inject({ method: "GET", url: "/v1/me/achievements", headers: u.h })).items[0];
    expect([a.status, a.metadata_hash]).toEqual(["minted", hashMinted]);
    expect(a.source.id).not.toBe(w1);
    // 刪除全部來源 → revoke_pending（minted 事實保留）
    await app.inject({ method: "DELETE", url: `/v1/me/workouts/${a.source.id}`, headers: u.h });
    await app.inject({ method: "DELETE", url: `/v1/me/workouts/${w1}`, headers: u.h });
    a = j(await app.inject({ method: "GET", url: "/v1/me/achievements", headers: u.h })).items[0];
    expect([a.status, a.minted, a.asset]).toEqual(["revoke_pending", true, ASSET]);
    expect(j(await app.inject({ method: "GET", url: `/v1/gallery/achievements/${ASSET}`, headers: u.h }))).toMatchObject({ kind: "milestone", series: "genesis_distance", record: "invalidated" });
    // 重新達標 → 回 minted、來源更新；仍只有一筆
    await app.inject({ method: "POST", url: "/v1/workouts/import", headers: u.h, payload: { sessions: [gps("w3", "2026-09-12", 5)] } });
    const items = j(await app.inject({ method: "GET", url: "/v1/me/achievements", headers: u.h })).items;
    expect(items).toHaveLength(1);
    expect([items[0].status, items[0].minted, items[0].metadata_hash]).toEqual(["minted", true, hashMinted]);
    expect(j(await app.inject({ method: "POST", url: "/v1/me/milestones/mint-intent", headers: u.h, payload: { key: KEY, public_consent: false } })).status).toBe("minted");
    expect(j(await app.inject({ method: "GET", url: `/v1/gallery/achievements/${ASSET}`, headers: u.h }))).toMatchObject({ kind: "milestone", record: "current", name: "NeonShift · First Spark (Device)", original_achiever: u.wallet });
  });
});
