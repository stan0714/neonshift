/**
 * PG-SHARE-05：匿名彙總只收允許清單、日期由伺服器決定、OPS 讀 JSON／CSV。
 * 重點是「這張表不可能反查到人」與「計數不得被當成唯一使用者」。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import type { Db } from "../db.js";
import { MemoryStore } from "../store/memory.js";

const db: Db = { pool: null, ping: async () => false, close: async () => {} };
let app: ReturnType<typeof buildApp>;
let store: MemoryStore;
let clock = new Date("2026-09-25T13:00:00Z");
const OPS = { authorization: "Bearer ops-token-for-tests-0001" };

beforeEach(async () => {
  clock = new Date("2026-09-25T13:00:00Z");
  store = new MemoryStore();
  app = buildApp({ config: loadConfig({ NODE_ENV: "test", OPS_TOKEN: "ops-token-for-tests-0001", RATE_LIMIT_PER_MINUTE: "5000" }), db, store, now: () => clock });
  await app.ready();
});
afterEach(async () => app.close());

const post = (payload: unknown, headers: Record<string, string> = {}) => app.inject({ method: "POST", url: "/v1/metrics/share", payload: payload as never, headers });

describe("匿名回報", () => {
  it("收下允許清單內的組合，伺服器自己決定日期", async () => {
    expect((await post({ kind: "workout", source: "summary", event: "landing_view" })).statusCode).toBe(202);
    clock = new Date("2026-09-26T01:00:00Z");
    await post({ kind: "workout", source: "summary", event: "landing_view" });
    expect(await store.listShare("2026-09-25", "2026-09-26")).toEqual([
      { kind: "workout", source: "summary", day: "2026-09-25", eventName: "landing_view", count: 1 },
      { kind: "workout", source: "summary", day: "2026-09-26", eventName: "landing_view", count: 1 },
    ]);
  });

  it("同一組合重複回報就是累加（非唯一事件數）", async () => {
    for (let i = 0; i < 3; i++) await post({ kind: "achievement", source: "mint", event: "landing_view" });
    expect((await store.listShare("2026-09-25", "2026-09-25"))[0]!.count).toBe(3);
  });

  it("source 省略時記為 direct", async () => {
    await post({ kind: "gear", event: "app_open" });
    expect((await store.listShare("2026-09-25", "2026-09-25"))[0]).toMatchObject({ source: "direct", eventName: "app_open" });
  });

  it("清單外的值、夾帶欄位與自訂日期一律拒絕", async () => {
    expect((await post({ kind: "wallet_dump", source: "summary", event: "landing_view" })).statusCode).toBe(422);
    expect((await post({ kind: "workout", source: "ig_story", event: "landing_view" })).statusCode).toBe(422);
    expect((await post({ kind: "workout", source: "summary", event: "wallet_connected" })).statusCode).toBe(422);
    // 不接受 day／referrer／wallet 等任何額外欄位（strict）
    expect((await post({ kind: "workout", source: "summary", event: "landing_view", day: "2020-01-01" })).statusCode).toBe(422);
    expect((await post({ kind: "workout", source: "summary", event: "landing_view", wallet: "abc" })).statusCode).toBe(422);
    expect(await store.listShare("2000-01-01", "2100-01-01")).toEqual([]);
  });

  it("接受 sendBeacon 的 text/plain（CORS 安全清單，不觸發 preflight）", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/metrics/share", headers: { "content-type": "text/plain" }, payload: JSON.stringify({ kind: "passport", source: "passport", event: "landing_view" }) });
    expect(r.statusCode).toBe(202);
    expect((await store.listShare("2026-09-25", "2026-09-25"))[0]).toMatchObject({ kind: "passport", eventName: "landing_view" });
  });

  it("壞掉的 body 不會 500", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/metrics/share", headers: { "content-type": "text/plain" }, payload: "not json" });
    expect(r.statusCode).toBe(400);
  });
});

describe("OPS 讀取", () => {
  beforeEach(async () => {
    await post({ kind: "workout", source: "summary", event: "landing_view" });
    await post({ kind: "workout", source: "summary", event: "landing_view" });
    await post({ kind: "workout", source: "summary", event: "app_open" });
    await post({ kind: "achievement", source: "mint", event: "landing_view" });
  });

  it("沒有 token 不給看", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/ops/metrics/share" })).statusCode).toBe(401);
  });

  it("依 kind／source 匯總，並註明計數不是唯一使用者、不能用於發獎", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/ops/metrics/share", headers: OPS });
    expect(r.statusCode).toBe(200);
    const j = r.json() as { by_kind: Record<string, Record<string, number>>; by_source: Record<string, Record<string, number>>; daily: unknown[]; notes: string[] };
    expect(j.by_kind.workout).toEqual({ landing_view: 2, app_open: 1 });
    expect(j.by_source.mint).toEqual({ landing_view: 1 });
    expect(j.daily).toHaveLength(3);
    expect(j.notes).toContain("counts_are_non_unique_events_reloads_and_crawlers_included");
    expect(j.notes).toContain("not_usable_for_rewards");
    // 資料本身不該出現任何可識別個人的欄位（notes 是說明文字，另外看）
    expect(JSON.stringify({ by_kind: j.by_kind, by_source: j.by_source, daily: j.daily })).not.toMatch(/wallet|\bip\b|referrer|cookie|user_id/i);
  });

  it("CSV 匯出可直接餵報表", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/ops/metrics/share?format=csv", headers: OPS });
    expect(r.headers["content-type"]).toContain("text/csv");
    const lines = r.body.trim().split("\n");
    expect(lines[0]).toBe("kind,source,day,event_name,count");
    expect(lines).toContain("workout,summary,2026-09-25,landing_view,2");
  });

  it("OPS_TOKEN 未設定時整個端點不存在", async () => {
    const bare = buildApp({ config: loadConfig({ NODE_ENV: "test" }), db, store, now: () => clock });
    await bare.ready();
    expect((await bare.inject({ method: "GET", url: "/v1/ops/metrics/share", headers: OPS })).statusCode).toBe(404);
    await bare.close();
  });
});
