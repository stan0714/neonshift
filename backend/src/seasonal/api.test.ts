/**
 * PG-SEASON-01／02 的 API：公開目錄、本人資格、改手機時區不影響判定、
 * 以及「這一版還不能鑄造」必須在回應裡說清楚（設計文件 §4.3）。
 */
import bs58 from "bs58";
import nacl from "tweetnacl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import type { Db } from "../db.js";
import { MemoryStore } from "../store/memory.js";

const db: Db = { pool: null, ping: async () => false, close: async () => {} };
let app: ReturnType<typeof buildApp>;
let store: MemoryStore;
let clock = new Date("2026-09-25T12:00:00Z");

beforeEach(async () => {
  clock = new Date("2026-09-25T12:00:00Z");
  store = new MemoryStore();
  app = buildApp({ config: loadConfig({ NODE_ENV: "test", SEASONAL_FILE: "seasonal/test-campaigns.json", QUEST_GPS_MIN_RULES_VERSION: "2", RATE_LIMIT_PER_MINUTE: "5000" }), db, store, now: () => clock });
  await app.ready();
});
afterEach(async () => app.close());

async function login() {
  const kp = nacl.sign.keyPair();
  const wallet = bs58.encode(kp.publicKey);
  const n = (await app.inject({ method: "POST", url: "/v1/auth/nonce", payload: { wallet } })).json();
  const sig = Buffer.from(nacl.sign.detached(new TextEncoder().encode(n.message), kp.secretKey)).toString("base64");
  const token = (await app.inject({ method: "POST", url: "/v1/auth/verify", payload: { message: n.message, signature_b64: sig } })).json().access_token as string;
  return { wallet, h: { authorization: `Bearer ${token}` } };
}

const addWorkout = (wallet: string, o: { sessionId: string; startedAt: string; endedAt: string; elapsedMs: bigint; importedAt?: string; extras?: Record<string, unknown> }) =>
  store.upsertWorkout(
    {
      sessionId: o.sessionId, wallet, sport: "walk", environment: "outdoor", origin: "gps", intent: "casual", goalSnapshot: null,
      sourceId: "cc.neonshift.app/gps", externalRecordId: o.sessionId, sourceRevision: 1,
      startedAt: new Date(o.startedAt), endedAt: new Date(o.endedAt), elapsedMs: o.elapsedMs, pausedMs: 0n,
      status: "saved", quality: "complete", rulesVersion: 2, distanceMm: 2_000_000n, distanceMethod: "gps",
      steps: null, activeEnergyMkcal: null, energyMethod: null, totalEnergyMkcal: null, stepLengthMm: null,
      pbEligible: true, reviewReasons: [], extras: o.extras ?? {}, requestHash: Buffer.alloc(32),
    },
    new Date(o.importedAt ?? o.endedAt),
  );

describe("公開目錄", () => {
  it("只列已啟用的屆次，附窗口、時區、門檻與來源，並標明尚未開放鑄造", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/seasonal" });
    expect(r.statusCode).toBe(200);
    const j = r.json() as { items: Record<string, unknown>[] };
    expect(j.items).toHaveLength(1); // test-moon-2026 尚未啟用
    expect(j.items[0]).toMatchObject({
      campaign_id: "test-stride-2026",
      theme_id: "test_stride",
      year: 2026,
      prototype: true,
      mint_enabled: false,
      window: { starts_at: "2026-09-25T00:00:00.000Z", ends_at: "2026-09-26T00:00:00.000Z", display_timezone: "UTC", state: "open" },
      rules: { min_moving_minutes: 20, grace_days: 7, single_session: true, gps_counts: true },
    });
    expect((j.items[0]!.source as { url: string }).url).toMatch(/^https:\/\//);
  });

  it("窗口過了就是 grace／closed，不用假裝還開著", async () => {
    clock = new Date("2026-09-27T00:00:00Z");
    expect(((await app.inject({ method: "GET", url: "/v1/seasonal" })).json() as { items: { window: { state: string } }[] }).items[0]!.window.state).toBe("grace");
    clock = new Date("2026-10-04T00:00:01Z");
    expect(((await app.inject({ method: "GET", url: "/v1/seasonal" })).json() as { items: { window: { state: string } }[] }).items[0]!.window.state).toBe("closed");
  });
});

describe("本人資格", () => {
  it("未登入不給", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/me/seasonal" })).statusCode).toBe(401);
  });

  it("沒有合格運動 → locked，進度顯示還差多少", async () => {
    const u = await login();
    await addWorkout(u.wallet, { sessionId: "short", startedAt: "2026-09-25T08:00:00Z", endedAt: "2026-09-25T08:15:00Z", elapsedMs: 900_000n });
    const j = (await app.inject({ method: "GET", url: "/v1/me/seasonal", headers: u.h })).json() as { items: { status: string; progress: { best_moving_ms: number; required_ms: number }; first: unknown }[]; notes: string[] };
    expect(j.items[0]).toMatchObject({ status: "locked", first: null, progress: { best_moving_ms: 900_000, required_ms: 1_200_000 } });
    expect(j.notes).toContain("eligibility_only_no_mint_path_yet");
  });

  it("窗口內走滿 20 分 → eligible，並指回是哪一次運動", async () => {
    const u = await login();
    await addWorkout(u.wallet, { sessionId: "ok", startedAt: "2026-09-25T08:00:00Z", endedAt: "2026-09-25T08:25:00Z", elapsedMs: 1_500_000n });
    const j = (await app.inject({ method: "GET", url: "/v1/me/seasonal", headers: u.h })).json() as { items: { status: string; first: { source: { id: string; kind: string }; moving_ms: number } }[] };
    expect(j.items[0]!.status).toBe("eligible");
    expect(j.items[0]!.first).toMatchObject({ source: { kind: "workout", id: "ok" }, moving_ms: 1_500_000 });
  });

  it("改手機時區不改資格：判定只用 UTC 瞬間，不看裝置回報的時區", async () => {
    const u = await login();
    await addWorkout(u.wallet, { sessionId: "tz", startedAt: "2026-09-25T23:40:00Z", endedAt: "2026-09-25T23:59:59Z", elapsedMs: 1_199_000n, extras: { recorded_time_zone: "Pacific/Kiritimati" } });
    const first = (await app.inject({ method: "GET", url: "/v1/me/seasonal", headers: u.h })).json() as { items: { status: string; progress: { best_moving_ms: number } }[] };
    expect(first.items[0]).toMatchObject({ status: "locked", progress: { best_moving_ms: 1_199_000 } }); // 差 1 秒
    // 同一筆再匯入一次，只是換了裝置時區標記 → 結果不變
    await addWorkout(u.wallet, { sessionId: "tz", startedAt: "2026-09-25T23:40:00Z", endedAt: "2026-09-25T23:59:59Z", elapsedMs: 1_199_000n, extras: { recorded_time_zone: "Etc/GMT+12" } });
    const again = (await app.inject({ method: "GET", url: "/v1/me/seasonal", headers: u.h })).json() as { items: { status: string }[] };
    expect(again.items[0]!.status).toBe("locked");
  });

  it("別人的運動不會讓我取得資格", async () => {
    const a = await login();
    const b = await login();
    await addWorkout(a.wallet, { sessionId: "mine", startedAt: "2026-09-25T08:00:00Z", endedAt: "2026-09-25T08:30:00Z", elapsedMs: 1_800_000n });
    expect(((await app.inject({ method: "GET", url: "/v1/me/seasonal", headers: a.h })).json() as { items: { status: string }[] }).items[0]!.status).toBe("eligible");
    expect(((await app.inject({ method: "GET", url: "/v1/me/seasonal", headers: b.h })).json() as { items: { status: string }[] }).items[0]!.status).toBe("locked");
  });

  it("活動結束後補同步仍算（7 天寬限內），超過就不算", async () => {
    // 先把時鐘推到寬限期內再登入（token 有效期短，先登入會過期）
    clock = new Date("2026-10-03T00:00:00Z");
    const u = await login();
    await addWorkout(u.wallet, { sessionId: "late", startedAt: "2026-09-25T08:00:00Z", endedAt: "2026-09-25T08:30:00Z", elapsedMs: 1_800_000n, importedAt: "2026-10-02T23:00:00Z" });
    const inGrace = (await app.inject({ method: "GET", url: "/v1/me/seasonal", headers: u.h })).json() as { items: { status: string; window?: unknown }[] };
    expect(inGrace.items[0]!.status).toBe("eligible");
    const u2 = await login();
    await addWorkout(u2.wallet, { sessionId: "tooLate", startedAt: "2026-09-25T08:00:00Z", endedAt: "2026-09-25T08:30:00Z", elapsedMs: 1_800_000n, importedAt: "2026-10-04T00:00:01Z" });
    expect(((await app.inject({ method: "GET", url: "/v1/me/seasonal", headers: u2.h })).json() as { items: { status: string; reason: string | null }[] }).items[0]!.status).toBe("locked");
  });

  it("回應裡沒有任何可鑄造欄位：不讓 App 把已達標當成已取得 NFT", async () => {
    const u = await login();
    await addWorkout(u.wallet, { sessionId: "ok", startedAt: "2026-09-25T08:00:00Z", endedAt: "2026-09-25T08:25:00Z", elapsedMs: 1_500_000n });
    const body = (await app.inject({ method: "GET", url: "/v1/me/seasonal", headers: u.h })).body;
    expect(body).not.toMatch(/achievement_id|mintable|minted|proof|asset/);
    expect(body).toContain('"mint_enabled":false');
  });
});
