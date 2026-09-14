/** PG-B-14 端到端（inject）：current、steps（簽章／單調／窗口／夾限／冪等）、leaderboard（BR-20）、刪除延後。 */
import { randomUUID } from "node:crypto";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { challengeMessage } from "../auth/challenge.js";
import { StaticChainReader } from "../chain/reader.js";
import type { TournamentView } from "../chain/tournament.js";
import { requestHashOf } from "../claim/canonical.js";
import { loadConfig } from "../config.js";
import type { Db } from "../db.js";
import { LocalKeypairSigner } from "../signer/index.js";
import { MemoryStore } from "../store/memory.js";

const db: Db = { pool: null, ping: async () => false, close: async () => {} };
const WEEK = 2026_38;
const CLOCK = Date.UTC(2026, 8, 14, 6); // 2026-09-14T06:00Z，ISO 2026-W38
const STARTS = CLOCK / 1000 - 6 * 3_600; // 六小時前開賽
const ENDS = STARTS + 2 * 86_400;

let app: ReturnType<typeof buildApp>;
let store: MemoryStore;
let chain: StaticChainReader;
let clock: Date;

const tournament = (over: Partial<TournamentView> = {}): TournamentView => ({
  address: "T1", weekId: WEEK, status: "running", vault: "V", stakeAmount: 50_000_000n, totalStaked: 500_000_000n, treasuryInjectionCap: 0n, treasuryInjection: 0n,
  entrantCount: 10, validEntrantCount: 10, forfeitedCount: 0, groupASize: 1, groupBSize: 2, distributablePool: 0n, distributed: 0n, totalRefund: 0n, totalPrize: 0n, treasuryRemainder: 0n,
  resultsSubmitted: 0, resultsHash: Buffer.alloc(32), resultsRollingHash: Buffer.alloc(32), minEntrants: 10, registrationEndsAt: STARTS - 3600, startsAt: STARTS, endsAt: ENDS, rulesVersion: 3, prizeABps: 6000, prizeBBps: 4000, loserRefundBps: 5000, createdAt: STARTS - 7200,
  ...over,
});

beforeEach(async () => {
  store = new MemoryStore();
  chain = new StaticChainReader();
  clock = new Date(CLOCK);
  chain.tournaments.set(WEEK, tournament());
  app = buildApp({ config: loadConfig({ NODE_ENV: "test", PROGRAM_ID: "6MhVoQHdEpY2hqkaNJMkT2vHWakfnGfEYDgCtJzh6ENA" }), db, store, now: () => clock, signer: LocalKeypairSigner.random(), chain });
  await app.ready();
});
afterEach(async () => app.close());

async function login() {
  const kp = nacl.sign.keyPair();
  const wallet = bs58.encode(kp.publicKey);
  const n = (await app.inject({ method: "POST", url: "/v1/auth/nonce", payload: { wallet } })).json();
  const sig = Buffer.from(nacl.sign.detached(new TextEncoder().encode(n.message), kp.secretKey)).toString("base64");
  const v = (await app.inject({ method: "POST", url: "/v1/auth/verify", payload: { message: n.message, signature_b64: sig } })).json();
  return { kp, wallet, token: v.access_token as string };
}
type User = Awaited<ReturnType<typeof login>>;
const bearer = (u: User) => ({ authorization: `Bearer ${u.token}` });

function stepsBody(steps: number, reachedAt: number, buckets?: [number, number][]) {
  return {
    week_id: WEEK,
    steps,
    reached_at: reachedAt,
    data_origins: [{ package: "android", source_kind: "android_legacy", steps }],
    step_rate_summary: { bucket_minutes: 60, buckets: buckets ?? [[0, steps]] },
    client: { app_version: "0.1.0", device_model: "Seeker", os_api: 36, sdk_extension: 22 },
  };
}

async function authorize(u: User, body: Record<string, unknown>, purpose = "tournament_steps") {
  const rh = requestHashOf(body as never);
  const c = (await app.inject({ method: "POST", url: "/v1/auth/challenge", headers: bearer(u), payload: { purpose, request_hash_b64: rh.toString("base64"), task_date: body.week_id, task_type: 1 } })).json();
  const msg = challengeMessage(purpose as "tournament_steps", Buffer.from(c.challenge_b64, "base64"), rh, c.expires_at);
  const signature_b64 = Buffer.from(nacl.sign.detached(msg, u.kp.secretKey)).toString("base64");
  return { ...body, claim_authorization: { challenge_b64: c.challenge_b64, expires_at: c.expires_at, signature_b64 } };
}

const submit = (u: User, payload: unknown, key = randomUUID()) => app.inject({ method: "POST", url: "/v1/tournament/steps", headers: { ...bearer(u), "idempotency-key": key }, payload: payload as Record<string, unknown> });

async function enteredUser() {
  const u = await login();
  chain.entries.add(`${WEEK}:${u.wallet}`);
  return u;
}

describe("GET /tournament/current", () => {
  it("回鏈上賽事、報名狀態與本人步數；本週已結束則看下一週；沒有賽事回 null", async () => {
    const u = await enteredUser();
    let res = await app.inject({ method: "GET", url: "/v1/tournament/current", headers: bearer(u) });
    expect(res.statusCode).toBe(200);
    let body = res.json();
    expect(body.tournament).toMatchObject({ week_id: WEEK, status: "running", stake_amount: "50000000", group_a_size: 1, group_b_size: 2, registration_open: false, settlement: null });
    expect(body.player).toEqual({ joined: true, verified_steps: 0, rank: null });
    expect(body.server_time).toBe(Math.floor(clock.getTime() / 1000));

    chain.tournaments.set(WEEK, tournament({ status: "settled", endsAt: Math.floor(clock.getTime() / 1000) - 10, distributablePool: 775_000_000n, resultsSubmitted: 10 }));
    chain.tournaments.set(2026_39, tournament({ weekId: 2026_39, status: "registration", registrationEndsAt: Math.floor(clock.getTime() / 1000) + 3600 }));
    body = (await app.inject({ method: "GET", url: "/v1/tournament/current", headers: bearer(u) })).json();
    expect(body.tournament.week_id).toBe(2026_39);
    expect(body.tournament.registration_open).toBe(true);
    expect(body.player.joined).toBe(false);

    chain.tournaments.clear();
    body = (await app.inject({ method: "GET", url: "/v1/tournament/current", headers: bearer(u) })).json();
    expect(body.tournament).toBeNull();
    expect((await app.inject({ method: "GET", url: "/v1/tournament/current" })).statusCode).toBe(401);
  });
});

describe("POST /tournament/steps", () => {
  it("需錢包簽章 challenge（purpose tournament_steps）；成功寫入 verified_steps、first_reached_at 與名次", async () => {
    const u = await enteredUser();
    const body = stepsBody(12_000, STARTS + 3600);
    // 無 challenge → 400 schema；用 claim 的 challenge → 401 mismatch（domain 不同 → 簽章不符）
    expect((await submit(u, body)).statusCode).toBe(400);
    const wrong = await authorize(u, { ...body, task_date: WEEK, task_type: "steps" } as never, "claim");
    delete (wrong as { task_date?: number }).task_date;
    delete (wrong as { task_type?: string }).task_type;
    expect((await submit(u, wrong)).statusCode).toBe(401);
    const res = await submit(u, await authorize(u, body));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ week_id: WEEK, verified_steps: 12_000, submitted_steps: 12_000, accepted: true, first_reached_at: new Date((STARTS + 3600) * 1000).toISOString(), rank: 1 });
  });

  it("單調不減：較低步數不覆寫，first_reached_at 保留；較高步數更新", async () => {
    const u = await enteredUser();
    await submit(u, await authorize(u, stepsBody(12_000, STARTS + 3600)));
    let res = await submit(u, await authorize(u, stepsBody(9_000, STARTS + 7200)));
    expect(res.json()).toMatchObject({ verified_steps: 12_000, submitted_steps: 9_000, accepted: false, first_reached_at: new Date((STARTS + 3600) * 1000).toISOString() });
    res = await submit(u, await authorize(u, stepsBody(15_000, STARTS + 10_000)));
    expect(res.json()).toMatchObject({ verified_steps: 15_000, accepted: true, first_reached_at: new Date((STARTS + 10_000) * 1000).toISOString() });
  });

  it("未報名 403、非 Running 409、不存在 404、reached_at 窗外／未來 422", async () => {
    const u = await login();
    expect((await submit(u, await authorize(u, stepsBody(1, STARTS + 1)))).json().error.code).toBe("NOT_ENTERED");
    chain.entries.add(`${WEEK}:${u.wallet}`);
    expect((await submit(u, await authorize(u, stepsBody(1, STARTS - 1)))).json().error.code).toBe("OUTSIDE_WINDOW");
    expect((await submit(u, await authorize(u, stepsBody(1, ENDS)))).json().error.code).toBe("OUTSIDE_WINDOW");
    expect((await submit(u, await authorize(u, stepsBody(1, Math.floor(clock.getTime() / 1000) + 120)))).json().error.code).toBe("OUTSIDE_WINDOW");
    chain.tournaments.set(WEEK, tournament({ status: "settling" }));
    expect((await submit(u, await authorize(u, stepsBody(1, STARTS + 1)))).json().error.code).toBe("TOURNAMENT_NOT_RUNNING");
    chain.tournaments.delete(WEEK);
    expect((await submit(u, await authorize(u, stepsBody(1, STARTS + 1)))).statusCode).toBe(404);
  });

  it("夾限：非允許來源排除、每小時桶 > 15,000 夾限、桶總和需等於歸因步數、桶超出窗口拒絕", async () => {
    const u = await enteredUser();
    // 兩小時桶：20,000 + 5,000 → 15,000 + 5,000 = 20,000
    let body = stepsBody(25_000, STARTS + 7200, [[0, 20_000], [1, 5_000]]);
    expect((await submit(u, await authorize(u, body))).json().verified_steps).toBe(20_000);
    // 第三方來源不計
    body = { ...stepsBody(30_000, STARTS + 8000, [[0, 15_000], [1, 10_000]]), data_origins: [{ package: "a", source_kind: "android_legacy", steps: 25_000 }, { package: "fit", source_kind: "third_party", steps: 5_000 }] };
    expect((await submit(u, await authorize(u, body))).json().verified_steps).toBe(25_000);
    // 桶不等於歸因
    body = stepsBody(1_000, STARTS + 9000, [[0, 999]]);
    expect((await submit(u, await authorize(u, body))).statusCode).toBe(400);
    // 桶超出 48 小時窗
    body = stepsBody(1_000, STARTS + 9000, [[48, 1_000]]);
    expect((await submit(u, await authorize(u, body))).json().error.message).toMatch(/outside the tournament window/);
    // 天數上限 80,000
    body = stepsBody(100_000, STARTS + 9000, Array.from({ length: 10 }, (_, i) => [i, 10_000] as [number, number]));
    expect((await submit(u, await authorize(u, body))).json().verified_steps).toBe(80_000);
  });

  it("冪等：同 key 回同結果、不同 payload 409；challenge 只能用一次", async () => {
    const u = await enteredUser();
    const key = randomUUID();
    const payload = await authorize(u, stepsBody(5_000, STARTS + 100));
    const a = await submit(u, payload, key);
    const b = await submit(u, payload, key);
    expect(b.statusCode).toBe(200);
    expect(b.json()).toEqual(a.json());
    expect((await submit(u, await authorize(u, stepsBody(6_000, STARTS + 200)), key)).json().error.code).toBe("IDEMPOTENCY_CONFLICT");
    // 重放同一 challenge（新 key）→ 401
    expect((await submit(u, payload)).json().error.code).toBe("CHALLENGE_INVALID");
  });
});

describe("GET /tournament/:weekId/leaderboard（BR-20）", () => {
  it("步數 DESC → 先達成 ASC → 錢包位元組序；含 generated_at 與本人名次", async () => {
    const a = await enteredUser();
    const b = await enteredUser();
    const c = await enteredUser();
    const d = await enteredUser();
    await submit(a, await authorize(a, stepsBody(10_000, STARTS + 500)));
    await submit(b, await authorize(b, stepsBody(10_000, STARTS + 400)));
    await submit(c, await authorize(c, stepsBody(12_000, STARTS + 900)));
    await submit(d, await authorize(d, stepsBody(10_000, STARTS + 500)));
    const res = await app.inject({ method: "GET", url: `/v1/tournament/${WEEK}/leaderboard`, headers: bearer(a) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.generated_at).toBe(clock.toISOString());
    expect(body.total_players).toBe(4);
    const tie = [a.wallet, d.wallet].sort((x, y) => Buffer.compare(Buffer.from(x, "ascii"), Buffer.from(y, "ascii")));
    expect(body.entries.map((e: { wallet: string }) => e.wallet)).toEqual([c.wallet, b.wallet, ...tie]);
    expect(body.entries.map((e: { rank: number }) => e.rank)).toEqual([1, 2, 3, 4]);
    expect(body.you).toEqual({ rank: tie.indexOf(a.wallet) + 3, verified_steps: 10_000 });
    expect((await app.inject({ method: "GET", url: `/v1/tournament/202640/leaderboard`, headers: bearer(a) })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/v1/tournament/999999/leaderboard`, headers: bearer(a) })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: `/v1/tournament/abc/leaderboard`, headers: bearer(a) })).statusCode).toBe(400);
  });
});

describe("BR-25：刪除個資遇進行中已質押賽事", () => {
  it("已報名且賽事未結算 → 202，deletion_due_at = 賽事 ends_at（不超過 30 天）", async () => {
    const u = await enteredUser();
    const res = await app.inject({ method: "DELETE", url: "/v1/player/data", headers: bearer(u) });
    expect(res.statusCode).toBe(202);
    expect(res.json().deletion_due_at).toBe(new Date(ENDS * 1000).toISOString());
    // 未報名 → 204
    const v = await login();
    expect((await app.inject({ method: "DELETE", url: "/v1/player/data", headers: bearer(v) })).statusCode).toBe(204);
  });
});
