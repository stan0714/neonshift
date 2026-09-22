/** PG-U-04：週界（時區、DST）、接受冪等與每週期一份、有效活動規則（10 分鐘、待審／估算不計、GPS 版本門檻、接受前／截止後不計、48 小時晚到）、同日去重、goal_time 不拆分累加、領取與撤銷／恢復、錢包刪除。 */
import bs58 from "bs58";
import nacl from "tweetnacl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { localDay, localWeekBoundsUtc, QuestService } from "./service.js";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import type { Db } from "../db.js";
import { MemoryStore } from "../store/memory.js";
import { LocalKeypairSigner } from "../signer/index.js";

describe("週界", () => {
  it("Asia/Taipei：週三 → 週一 00:00 +08:00；週日仍屬同週；UTC 週期 7 天", () => {
    const b = localWeekBoundsUtc(new Date("2026-09-16T03:00:00Z"), "Asia/Taipei"); // 週三 11:00 台北
    expect([b.periodStart.toISOString(), b.periodEnd.toISOString()]).toEqual(["2026-09-13T16:00:00.000Z", "2026-09-20T16:00:00.000Z"]);
    expect(localWeekBoundsUtc(new Date("2026-09-20T15:59:00Z"), "Asia/Taipei").periodStart.toISOString()).toBe("2026-09-13T16:00:00.000Z"); // 週日 23:59
    expect(localWeekBoundsUtc(new Date("2026-09-20T16:00:00Z"), "Asia/Taipei").periodStart.toISOString()).toBe("2026-09-20T16:00:00.000Z"); // 週一 00:00
  });
  it("America/New_York DST 週：週一 00:00 EDT = 04:00Z", () => {
    expect(localWeekBoundsUtc(new Date("2026-10-28T12:00:00Z"), "America/New_York").periodStart.toISOString()).toBe("2026-10-26T04:00:00.000Z");
    expect(localDay(new Date("2026-09-14T03:30:00Z"), "America/New_York")).toBe("2026-09-13");
  });
});

describe("探索冊 API", () => {
  const db: Db = { pool: null, ping: async () => false, close: async () => {} };
  let app: ReturnType<typeof buildApp>;
  let store: MemoryStore;
  let clock = new Date("2026-09-16T03:00:00Z"); // 週三
  const mk = (env: Record<string, string> = {}) => { store = new MemoryStore(); app = buildApp({ config: loadConfig({ NODE_ENV: "test", RATE_LIMIT_SENSITIVE_PER_MINUTE: "1000", RATE_LIMIT_PER_MINUTE: "5000", ...env }), db, store, now: () => clock, signer: LocalKeypairSigner.random() }); return app.ready(); };
  beforeEach(async () => { clock = new Date("2026-09-16T03:00:00Z"); users.length = 0; await mk(); });
  afterEach(async () => app.close());
  type U = { wallet: string; h: { authorization: string }; refresh: () => Promise<void> };
  /** 時鐘會跨日推進，token 會過期：clock 改變後呼叫 refresh 以同一把錢包重新登入 */
  async function login(): Promise<U> {
    const kp = nacl.sign.keyPair();
    const wallet = bs58.encode(kp.publicKey);
    const auth = async () => {
      const n = (await app.inject({ method: "POST", url: "/v1/auth/nonce", payload: { wallet } })).json();
      const sig = Buffer.from(nacl.sign.detached(new TextEncoder().encode(n.message), kp.secretKey)).toString("base64");
      const v = (await app.inject({ method: "POST", url: "/v1/auth/verify", payload: { message: n.message, signature_b64: sig } })).json();
      return { authorization: `Bearer ${v.access_token as string}` };
    };
    const u: U = { wallet, h: await auth(), refresh: async () => { u.h = await auth(); } };
    return u;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j = (r: { json: () => unknown }) => r.json() as Record<string, any>;
  const users: U[] = [];
  const loginU = async (): Promise<U> => { const u = await login(); users.push(u); return u; };
  /** Health Connect 匯入（裝置距離 → complete）；start/end ISO */
  const hc = (id: string, start: string, minutes: number, over: Record<string, unknown> = {}) => ({ sport: "walk", intent: "brisk", origin: "health_connect", source_id: "com.example.watch", external_record_id: id, started_at: start, ended_at: new Date(Date.parse(start) + minutes * 60_000).toISOString(), distance_mm: String(minutes * 90_000), distance_method: "device", steps: minutes * 100, ...over });
  const imp = (h: Record<string, string>, sessions: unknown[]) => app.inject({ method: "POST", url: "/v1/workouts/import", headers: h, payload: { sessions } });

  it("接受：模板快照、本地週界、冪等 key；同模板同週再接受回既有；goal_time 需合法分鐘；時區檢查", async () => {
    const u = await loginU();
    let r = await app.inject({ method: "POST", url: "/v1/me/quests/accept", headers: u.h, payload: { template_id: "three_days", timezone: "Asia/Taipei", idempotency_key: "idem-key-1" } });
    expect(r.statusCode).toBe(201);
    const e = j(r).enrollment;
    expect(e).toMatchObject({ template_id: "three_days", template_version: 1, status: "active", period_start: "2026-09-13T16:00:00.000Z", period_end: "2026-09-20T16:00:00.000Z", late_sync_until: "2026-09-22T16:00:00.000Z" });
    r = await app.inject({ method: "POST", url: "/v1/me/quests/accept", headers: u.h, payload: { template_id: "three_days", timezone: "Asia/Taipei", idempotency_key: "idem-key-1" } });
    expect([r.statusCode, j(r).already, j(r).enrollment.enrollment_id]).toEqual([200, true, e.enrollment_id]);
    r = await app.inject({ method: "POST", url: "/v1/me/quests/accept", headers: u.h, payload: { template_id: "three_days", timezone: "Europe/London", idempotency_key: "idem-key-2" } });
    expect([r.statusCode, j(r).already]).toEqual([200, true]); // 同模板同週（不同 key／時區）→ 既有
    expect(j(await app.inject({ method: "POST", url: "/v1/me/quests/accept", headers: u.h, payload: { template_id: "timed_goal", goal: { minutes: 15 }, timezone: "Asia/Taipei", idempotency_key: "idem-key-3" } })).error.code).toBe("VALIDATION");
    expect((await app.inject({ method: "POST", url: "/v1/me/quests/accept", headers: u.h, payload: { template_id: "timed_goal", goal: { minutes: 20 }, timezone: "Mars/Olympus", idempotency_key: "idem-key-4" } })).statusCode).toBe(422);
    expect((await app.inject({ method: "POST", url: "/v1/me/quests/accept", headers: u.h, payload: { template_id: "timed_goal", goal: { minutes: 20 }, timezone: "Asia/Taipei", idempotency_key: "idem-key-5" } })).statusCode).toBe(201);
    const q = j(await app.inject({ method: "GET", url: "/v1/me/quests", headers: u.h }));
    expect(q.templates.map((t: { template_id: string }) => t.template_id)).toEqual(["three_days", "timed_goal"]);
    expect(q.enrollments).toHaveLength(2);
    expect(q.rules).toEqual({ min_active_minutes: 10, late_sync_hours: 48, gps_rewards_enabled: false });
  });

  it("three_days：接受前的活動不計；< 10 分鐘、待審不計；同日兩筆算一天；三天完成 → completed → 領取外觀（冪等）；刪除來源 → 撤銷外觀；重新符合 → 同 receipt 恢復", async () => {
    const u = await loginU();
    await imp(u.h, [hc("before", "2026-09-15T01:00:00Z", 30)]); // 接受前
    const e = j(await app.inject({ method: "POST", url: "/v1/me/quests/accept", headers: u.h, payload: { template_id: "three_days", timezone: "Asia/Taipei", idempotency_key: "idem-key-1" } })).enrollment;
    clock = new Date("2026-09-16T04:00:00Z");
    await Promise.all(users.map((x) => x.refresh()));
    await imp(u.h, [hc("w1", "2026-09-16T03:30:00Z", 30), hc("short", "2026-09-16T05:00:00Z", 8), hc("w1b", "2026-09-16T10:00:00Z", 20), hc("review", "2026-09-17T01:00:00Z", 30, { steps: 200_000 })]); // review：步頻超上限 → needs_review
    let q = j(await app.inject({ method: "GET", url: "/v1/me/quests", headers: u.h }));
    expect(q.enrollments[0].progress).toEqual({ current: 1, target: 3 }); // 9/16 一天（兩筆算一天）
    expect(j(await app.inject({ method: "POST", url: `/v1/me/quests/${e.enrollment_id}/claim`, headers: u.h })).error.code).toBe("QUEST_NOT_COMPLETED");
    await imp(u.h, [hc("w2", "2026-09-17T10:00:00Z", 15), hc("w3", "2026-09-18T10:00:00Z", 12)]);
    q = j(await app.inject({ method: "GET", url: "/v1/me/quests", headers: u.h }));
    expect([q.enrollments[0].status, q.enrollments[0].progress, q.enrollments[0].contributions.map((c: { local_day: string }) => c.local_day)]).toEqual(["completed", { current: 3, target: 3 }, ["2026-09-16", "2026-09-17", "2026-09-18"]]);
    let c = j(await app.inject({ method: "POST", url: `/v1/me/quests/${e.enrollment_id}/claim`, headers: u.h }));
    expect([c.already, c.receipt.cosmetic_id, c.enrollment.status]).toEqual([false, "chapter_01_three_days", "claimed"]);
    const c2 = j(await app.inject({ method: "POST", url: `/v1/me/quests/${e.enrollment_id}/claim`, headers: u.h }));
    expect([c2.already, c2.receipt.receipt_id]).toEqual([true, c.receipt.receipt_id]);
    q = j(await app.inject({ method: "GET", url: "/v1/me/quests", headers: u.h }));
    expect(q.cosmetics).toEqual([{ cosmetic_id: "chapter_01_three_days", receipt_id: c.receipt.receipt_id, status: "active", granted_at: clock.toISOString() }]);
    // 刪除 w3 → 只剩兩天 → 撤銷（receipt 保留、外觀 revoked）
    const w3 = j(await app.inject({ method: "GET", url: "/v1/me/workouts", headers: u.h })).items.find((x: { source: { external_record_id: string } }) => x.source.external_record_id === "w3");
    await app.inject({ method: "DELETE", url: `/v1/me/workouts/${w3.session_id}`, headers: u.h });
    q = j(await app.inject({ method: "GET", url: "/v1/me/quests", headers: u.h }));
    expect([q.enrollments[0].status, q.cosmetics[0].status]).toEqual(["revoked", "revoked"]);
    expect((await store.getQuestReceipt(e.enrollment_id))?.revokeReason).toBe("source_removed_or_corrected");
    // 再補一天 → 重新符合 → 同 receipt 恢復
    await imp(u.h, [hc("w4", "2026-09-19T10:00:00Z", 12)]);
    q = j(await app.inject({ method: "GET", url: "/v1/me/quests", headers: u.h }));
    expect(q.enrollments[0].status).toBe("completed");
    c = j(await app.inject({ method: "POST", url: `/v1/me/quests/${e.enrollment_id}/claim`, headers: u.h }));
    expect([c.already, c.receipt.receipt_id, c.enrollment.status]).toEqual([true, c2.receipt.receipt_id, "claimed"]);
    expect(j(await app.inject({ method: "GET", url: "/v1/me/quests", headers: u.h })).cosmetics[0].status).toBe("active");
    // 錢包刪除清掉探索冊
    await app.inject({ method: "DELETE", url: "/v1/player/data", headers: u.h });
    expect(await store.listQuestEnrollments(u.wallet)).toEqual([]);
    expect(await store.listCosmetics(u.wallet)).toEqual([]);
  });

  it("timed_goal：需目標快照相同分鐘且非暫停時長 ≥ 目標；拆分兩筆不累加；截止後 48 小時內晚到可計、之後不計；過期 → expired", async () => {
    const u = await loginU();
    const e = j(await app.inject({ method: "POST", url: "/v1/me/quests/accept", headers: u.h, payload: { template_id: "timed_goal", goal: { minutes: 20 }, timezone: "Asia/Taipei", idempotency_key: "idem-key-1" } })).enrollment;
    clock = new Date("2026-09-17T04:00:00Z");
    await Promise.all(users.map((x) => x.refresh()));
    await imp(u.h, [hc("a", "2026-09-17T01:00:00Z", 12, { goal: { kind: "time", target: 1200, unit: "s", version: 1 } }), hc("b", "2026-09-17T02:00:00Z", 12, { goal: { kind: "time", target: 1200, unit: "s", version: 1 } }), hc("c", "2026-09-17T03:00:00Z", 25, { goal: { kind: "time", target: 600, unit: "s", version: 1 } })]);
    let q = j(await app.inject({ method: "GET", url: "/v1/me/quests", headers: u.h }));
    expect(q.enrollments[0].progress).toEqual({ current: 0, target: 1 }); // 12+12 不累加；25 分但目標 10 分不符
    await imp(u.h, [hc("d", "2026-09-18T03:00:00Z", 22, { goal: { kind: "time", target: 1200, unit: "s", version: 1 }, paused_ms: "30000" })]);
    q = j(await app.inject({ method: "GET", url: "/v1/me/quests", headers: u.h }));
    expect([q.enrollments[0].status, q.enrollments[0].contributions[0].source.id]).toEqual(["completed", expect.any(String)]);
    // 另一玩家：截止後 47 小時匯入截止前的活動 → 計；49 小時 → 不計並 expired
    clock = new Date("2026-09-16T03:00:00Z");
    await Promise.all(users.map((x) => x.refresh()));
    const v = await loginU();
    const ev = j(await app.inject({ method: "POST", url: "/v1/me/quests/accept", headers: v.h, payload: { template_id: "timed_goal", goal: { minutes: 10 }, timezone: "Asia/Taipei", idempotency_key: "idem-key-v" } })).enrollment;
    clock = new Date("2026-09-22T15:00:00Z"); // 截止 9/20 16:00Z + 47h
    await Promise.all(users.map((x) => x.refresh()));
    await imp(v.h, [hc("late-ok", "2026-09-19T01:00:00Z", 11, { goal: { kind: "time", target: 600, unit: "s", version: 1 } })]);
    expect(j(await app.inject({ method: "GET", url: "/v1/me/quests", headers: v.h })).enrollments[0].status).toBe("completed");
    clock = new Date("2026-09-16T03:00:00Z");
    await Promise.all(users.map((x) => x.refresh()));
    const w = await loginU();
    await app.inject({ method: "POST", url: "/v1/me/quests/accept", headers: w.h, payload: { template_id: "timed_goal", goal: { minutes: 10 }, timezone: "Asia/Taipei", idempotency_key: "idem-key-w" } });
    clock = new Date("2026-09-22T17:00:00Z"); // +49h
    await Promise.all(users.map((x) => x.refresh()));
    await imp(w.h, [hc("late-no", "2026-09-19T01:00:00Z", 11, { goal: { kind: "time", target: 600, unit: "s", version: 1 } })]);
    expect(j(await app.inject({ method: "GET", url: "/v1/me/quests", headers: w.h })).enrollments[0].status).toBe("expired");
    void e; void ev;
  });

  it("PG-U-05 多裝置／重送／更正：同來源重送（same）與另一裝置匯入同 external_record_id 不重複計；revision 更正沿用貢獻並更新 revision；更正成 < 10 分鐘 → 撤銷；改回 → 恢復", async () => {
    const u = await loginU();
    const e = j(await app.inject({ method: "POST", url: "/v1/me/quests/accept", headers: u.h, payload: { template_id: "three_days", timezone: "Asia/Taipei", idempotency_key: "idem-key-m" } })).enrollment;
    clock = new Date("2026-09-18T04:00:00Z");
    await Promise.all(users.map((x) => x.refresh()));
    await imp(u.h, [hc("m1", "2026-09-16T10:00:00Z", 30), hc("m2", "2026-09-17T10:00:00Z", 30), hc("m3", "2026-09-18T01:00:00Z", 30)]);
    let q = j(await app.inject({ method: "GET", url: "/v1/me/quests", headers: u.h }));
    expect(q.enrollments[0].status).toBe("completed");
    await app.inject({ method: "POST", url: `/v1/me/quests/${e.enrollment_id}/claim`, headers: u.h });
    // 重送（same）與第二台裝置（同 source_id＋external_record_id）→ 不重複、不撤銷
    await imp(u.h, [hc("m1", "2026-09-16T10:00:00Z", 30), hc("m2", "2026-09-17T10:00:00Z", 30)]);
    q = j(await app.inject({ method: "GET", url: "/v1/me/quests", headers: u.h }));
    expect([q.enrollments[0].status, q.enrollments[0].contributions.length]).toEqual(["claimed", 3]);
    // 更正 m3（revision 2，仍 ≥ 10 分）→ 貢獻沿用同來源、revision 更新
    await imp(u.h, [hc("m3", "2026-09-18T01:00:00Z", 25, { source_revision: 2 })]);
    q = j(await app.inject({ method: "GET", url: "/v1/me/quests", headers: u.h }));
    expect(q.enrollments[0].contributions.find((c: { local_day: string }) => c.local_day === "2026-09-18").source.revision).toBe(2);
    expect(q.enrollments[0].status).toBe("claimed");
    // 更正 m3 成 8 分鐘（revision 3）→ 失去第三天 → 撤銷；改回 30 分（revision 4）→ 恢復同 receipt
    await imp(u.h, [hc("m3", "2026-09-18T01:00:00Z", 8, { source_revision: 3 })]);
    q = j(await app.inject({ method: "GET", url: "/v1/me/quests", headers: u.h }));
    expect([q.enrollments[0].status, q.cosmetics[0].status]).toEqual(["revoked", "revoked"]);
    await imp(u.h, [hc("m3", "2026-09-18T01:00:00Z", 30, { source_revision: 4 })]);
    q = j(await app.inject({ method: "GET", url: "/v1/me/quests", headers: u.h }));
    expect(q.enrollments[0].status).toBe("completed");
    const c = j(await app.inject({ method: "POST", url: `/v1/me/quests/${e.enrollment_id}/claim`, headers: u.h }));
    expect([c.already, c.enrollment.status]).toEqual([true, "claimed"]);
    expect(j(await app.inject({ method: "GET", url: "/v1/me/quests", headers: u.h })).cosmetics).toHaveLength(1);
  });

  it("XD-01 卡面：模板帶 card（來源／難度／要求／獎勵／開始目標）；enrollment card_state 已接受 → 待驗證 → 進行中 → 可領 → 已領；重複接受同一 enrollment", async () => {
    const u = await loginU();
    let q = j(await app.inject({ method: "GET", url: "/v1/me/quests", headers: u.h }));
    const tpl = q.templates.find((t: { template_id: string }) => t.template_id === "timed_goal");
    expect(tpl.card).toEqual({ source: "system", difficulty: "easy", requirements: { min_active_minutes: 10, sports: ["run", "walk"], gps_counts: false, needs_sync: true }, reward: { kind: "cosmetic", cosmetic_id: "chapter_01_timed_goal" }, start: { goal: { kind: "time", minutes: null } } });
    const a1 = j(await app.inject({ method: "POST", url: "/v1/me/quests/accept", headers: u.h, payload: { template_id: "timed_goal", goal: { minutes: 30 }, timezone: "Asia/Taipei", idempotency_key: "idem-card-1" } }));
    const a2 = j(await app.inject({ method: "POST", url: "/v1/me/quests/accept", headers: u.h, payload: { template_id: "timed_goal", goal: { minutes: 30 }, timezone: "Asia/Taipei", idempotency_key: "idem-card-2" } }));
    expect([a1.enrollment.card_state, a1.enrollment.card.difficulty, a1.enrollment.card.start, a2.already, a2.enrollment.enrollment_id]).toEqual(["accepted", "medium", { goal: { kind: "time", minutes: 30 } }, true, a1.enrollment.enrollment_id]);
    clock = new Date("2026-09-16T04:00:00Z");
    await Promise.all(users.map((x) => x.refresh()));
    // 待審的 35 分鐘（步頻超上限）→ pending_verification，不當進度
    await imp(u.h, [hc("rv", "2026-09-16T03:30:00Z", 35, { sport: "run", intent: "run", steps: 300_000, goal: { kind: "time", target: 1800, unit: "s", version: 1 } })]);
    q = j(await app.inject({ method: "GET", url: "/v1/me/quests", headers: u.h }));
    expect([q.enrollments[0].card_state, q.enrollments[0].pending_review_count, q.enrollments[0].progress]).toEqual(["pending_verification", 1, { current: 0, target: 1 }]);
    // 合格的 35 分鐘、目標快照 30 分 → claimable → claimed
    await imp(u.h, [hc("ok", "2026-09-16T10:00:00Z", 35, { sport: "run", intent: "run", goal: { kind: "time", target: 1800, unit: "s", version: 1 } })]);
    q = j(await app.inject({ method: "GET", url: "/v1/me/quests", headers: u.h }));
    expect(q.enrollments[0].card_state).toBe("claimable");
    const c = j(await app.inject({ method: "POST", url: `/v1/me/quests/${a1.enrollment.enrollment_id}/claim`, headers: u.h }));
    expect(c.enrollment.card_state).toBe("claimed");
    // three_days：一天 → in_progress
    await app.inject({ method: "POST", url: "/v1/me/quests/accept", headers: u.h, payload: { template_id: "three_days", timezone: "Asia/Taipei", idempotency_key: "idem-card-3" } });
    await imp(u.h, [hc("d1", "2026-09-16T12:00:00Z", 20)]);
    q = j(await app.inject({ method: "GET", url: "/v1/me/quests", headers: u.h }));
    expect(q.enrollments.find((e: { template_id: string }) => e.template_id === "three_days").card_state).toBe("in_progress");
  });

  it("GPS 來源：未設定 QUEST_GPS_MIN_RULES_VERSION 不計；設定後版本 ≥ 門檻才計（R-10 品質規則定案前不發獎）", async () => {
    const gps = (id: string, start: string, minutes: number) => ({ sport: "run", environment: "outdoor", origin: "gps", source_id: "cc.neonshift.app/gps", external_record_id: id, started_at: start, ended_at: new Date(Date.parse(start) + minutes * 60_000).toISOString(), distance_mm: String(minutes * 200_000), distance_method: "gps", extras: {} });
    let u = await loginU();
    await app.inject({ method: "POST", url: "/v1/me/quests/accept", headers: u.h, payload: { template_id: "three_days", timezone: "Asia/Taipei", idempotency_key: "idem-key" } });
    clock = new Date("2026-09-18T04:00:00Z");
    await Promise.all(users.map((x) => x.refresh()));
    await imp(u.h, [gps("g1", "2026-09-16T10:00:00Z", 20), gps("g2", "2026-09-17T10:00:00Z", 20), gps("g3", "2026-09-18T01:00:00Z", 20)]);
    expect(j(await app.inject({ method: "GET", url: "/v1/me/quests", headers: u.h })).enrollments[0].progress).toEqual({ current: 0, target: 3 });
    await app.close();
    await mk({ QUEST_GPS_MIN_RULES_VERSION: "1" });
    u = await loginU();
    clock = new Date("2026-09-16T03:00:00Z");
    await Promise.all(users.map((x) => x.refresh()));
    await app.inject({ method: "POST", url: "/v1/me/quests/accept", headers: u.h, payload: { template_id: "three_days", timezone: "Asia/Taipei", idempotency_key: "idem-key" } });
    clock = new Date("2026-09-18T04:00:00Z");
    await Promise.all(users.map((x) => x.refresh()));
    await imp(u.h, [gps("g1", "2026-09-16T10:00:00Z", 20), gps("g2", "2026-09-17T10:00:00Z", 20), gps("g3", "2026-09-18T01:00:00Z", 20)]);
    const q = j(await app.inject({ method: "GET", url: "/v1/me/quests", headers: u.h }));
    expect([q.rules.gps_rewards_enabled, q.enrollments[0].status]).toEqual([true, "completed"]);
  });
});
