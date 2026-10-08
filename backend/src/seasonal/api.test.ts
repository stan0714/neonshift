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
    // PG-SEASON-04：領取由 SEASONAL_MINT_ENABLED 控制，預設關 → 回應要明說還沒開放
    expect(j.notes).toContain("eligibility_only_mint_not_open");
    expect(j.notes).not.toContain("mint_open");
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

/**
 * PG-SEASON-04：領取（mint intent）。
 *
 * 這一段要釘住的是「開關關著時不能簽出任何證明」與「主題／年份在 metadata、不在鏈上 category」。
 * 鏈上只有一個 seasonal category（14），唯一性靠 achievement_id，所以每年新增主題不必改程式。
 */
describe("領取意圖（PG-SEASON-04）", () => {
  const OPS = { authorization: "Bearer ops-token-for-tests-0001" };
  /** sessionId 用 UUID：DELETE /me/workouts/:id 只收 UUID，撤銷那一題要真的刪得掉 */
  const SESSION = "11111111-2222-4333-8444-555555555555";
  const eligible = (wallet: string) => addWorkout(wallet, { sessionId: SESSION, startedAt: "2026-09-25T08:00:00Z", endedAt: "2026-09-25T08:25:00Z", elapsedMs: 1_500_000n });

  const withMint = async () => {
    await app.close();
    store = new MemoryStore();
    app = buildApp({
      config: loadConfig({ NODE_ENV: "test", SEASONAL_FILE: "seasonal/test-campaigns.json", QUEST_GPS_MIN_RULES_VERSION: "2", RATE_LIMIT_PER_MINUTE: "5000", SEASONAL_MINT_ENABLED: "true", OPS_TOKEN: "ops-token-for-tests-0001", PROGRAM_ID: "6MhVoQHdEpY2hqkaNJMkT2vHWakfnGfEYDgCtJzh6ENA" }),
      db, store, now: () => clock,
    });
    await app.ready();
  };
  const intent = (wallet: { h: Record<string, string> }, consent = false, id = "test-stride-2026") =>
    app.inject({ method: "POST", url: `/v1/me/seasonal/${id}/intent`, headers: wallet.h, payload: { public_consent: consent } });

  it("開關關著（預設）→ 拒絕，而且不留下任何成就列", async () => {
    const u = await login();
    await eligible(u.wallet);
    const r = await intent(u);
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe("SEASONAL_MINT_NOT_OPEN");
    expect(await store.listAchievements(u.wallet)).toEqual([]);
  });

  it("開關開著但還沒達標 → 拒絕（不能先建一枚等著）", async () => {
    await withMint();
    const u = await login();
    await addWorkout(u.wallet, { sessionId: "short", startedAt: "2026-09-25T08:00:00Z", endedAt: "2026-09-25T08:15:00Z", elapsedMs: 900_000n });
    const r = await intent(u);
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe("SEASONAL_NOT_ELIGIBLE");
    expect(await store.listAchievements(u.wallet)).toEqual([]);
  });

  it("達標 → 建立 kind=seasonal 的待核准成就；主題與年份在 metadata，達標日期預設不寫", async () => {
    await withMint();
    const u = await login();
    await eligible(u.wallet);
    const r = await intent(u);
    expect(r.statusCode).toBe(200);
    const j = r.json() as { status: string; proof: unknown; metadata_preview: { name: string; attributes: { trait_type: string; value: string }[]; properties: Record<string, unknown> } };
    expect(j.status).toBe("pending_registry"); // 還沒上鏈 registry → 不簽證明
    expect(j.proof).toBeNull();
    const attrs = Object.fromEntries(j.metadata_preview.attributes.map((a) => [a.trait_type, a.value]));
    expect(j.metadata_preview.name).toBe("NeonShift · Test Stride 2026");
    expect(attrs).toMatchObject({ Series: "Seasonal Footprints", Edition: "Test Stride 2026", Theme: "Test Stride", Year: "2026" });
    expect(attrs.Window).toMatch(/2026-09-25 → 2026-09-25 \(UTC\)/); // 窗口是公開資訊
    expect(attrs.Earned).toBeUndefined(); // 自己哪天達標預設不公開
    expect(j.metadata_preview.properties).toMatchObject({ campaign_id: "test-stride-2026", theme_id: "test_stride", year: 2026, public: false });
    // metadata 不含 Activity ID、起終點或錢包
    expect(JSON.stringify(j.metadata_preview)).not.toMatch(new RegExp(`${SESSION}|lat|lon|wallet`));

    const rows = await store.listAchievements(u.wallet);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "seasonal", category: "seasonal", verificationClass: "device", milestoneKey: "seasonal|test-stride-2026", sourceKind: "workout", sourceId: SESSION, status: "pending_registry" });
  });

  it("逐次同意才寫入達標日期；重複呼叫沿用同一枚（每玩家每屆一枚）", async () => {
    await withMint();
    const u = await login();
    await eligible(u.wallet);
    const first = (await intent(u)).json() as { achievement: { achievement_id: string } };
    const again = (await intent(u, true)).json() as { achievement: { achievement_id: string }; metadata_preview: { attributes: { trait_type: string; value: string }[] } };
    expect(again.achievement.achievement_id).toBe(first.achievement.achievement_id);
    expect(again.metadata_preview.attributes.map((a) => a.trait_type)).toContain("Earned");
    expect(await store.listAchievements(u.wallet)).toHaveLength(1);
  });

  it("核准後簽出的證明用 category 14（整個系列共用），不是主題各一個", async () => {
    await withMint();
    const u = await login();
    await eligible(u.wallet);
    const id = ((await intent(u)).json() as { achievement: { achievement_id: string } }).achievement.achievement_id;
    const pending = (await app.inject({ method: "GET", url: "/v1/ops/achievements/pending", headers: OPS })).json() as { items: { achievement_id: string; category_code: number; class_code: number }[] };
    expect(pending.items.find((x) => x.achievement_id === id)).toMatchObject({ category_code: 14, class_code: 2 });
    (await app.inject({ method: "POST", url: `/v1/ops/achievements/${id}/registry`, headers: OPS, payload: { status: "approved", signature: "s".repeat(64) } })).statusCode;
    const approved = (await intent(u)).json() as { status: string; proof: { args: { category: number; achievement_id: string } } | null };
    expect(approved.status).toBe("approved");
    expect(approved.proof?.args).toMatchObject({ category: 14, achievement_id: id });
  });

  it("來源運動消失 → 標記撤銷，不鑄第二枚；恢復後沿用同一枚", async () => {
    await withMint();
    const u = await login();
    await eligible(u.wallet);
    const id = ((await intent(u)).json() as { achievement: { achievement_id: string } }).achievement.achievement_id;
    expect((await app.inject({ method: "DELETE", url: `/v1/me/workouts/${SESSION}`, headers: u.h })).statusCode).toBe(204);
    const after = await store.listAchievements(u.wallet);
    expect(after).toHaveLength(1);
    expect(after[0]!.status).toBe("revoke_pending");
    // 刪除是 tombstone（BR-40），同一個 session id 不會復活；真實情況是重新匯入成另一筆。
    // 那時候**同一個 achievement_id** 要恢復（key 是屆次不是來源），不能變成第二枚。
    const again = "22222222-3333-4444-8555-666666666666";
    await addWorkout(u.wallet, { sessionId: again, startedAt: "2026-09-25T09:00:00Z", endedAt: "2026-09-25T09:25:00Z", elapsedMs: 1_500_000n });
    const back = (await intent(u)).json() as { achievement: { achievement_id: string; status: string; source: { id: string } | null } };
    expect(back.achievement.achievement_id).toBe(id);
    expect(back.achievement.status).toBe("pending_registry");
    expect(back.achievement.source?.id).toBe(again);
    expect(await store.listAchievements(u.wallet)).toHaveLength(1);
  });
});
