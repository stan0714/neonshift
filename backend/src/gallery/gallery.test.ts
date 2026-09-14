/** PG-G-01／G-02：投影冪等與 slot 單調；排行、玩家頁、搜尋 API。 */
import bs58 from "bs58";
import nacl from "tweetnacl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import type { Db } from "../db.js";
import type { ChainEventRecord } from "../indexer/indexer.js";
import { LocalKeypairSigner } from "../signer/index.js";
import { MemoryStore } from "../store/memory.js";
import { galleryProjection } from "./projection.js";

const db: Db = { pool: null, ping: async () => false, close: async () => {} };
let app: ReturnType<typeof buildApp>;
let store: MemoryStore;
const now = new Date("2026-09-14T06:00:00Z");

beforeEach(async () => {
  store = new MemoryStore();
  app = buildApp({ config: loadConfig({ NODE_ENV: "test" }), db, store, now: () => now, signer: LocalKeypairSigner.random() });
  await app.ready();
});
afterEach(async () => app.close());

async function login() {
  const kp = nacl.sign.keyPair();
  const wallet = bs58.encode(kp.publicKey);
  const n = (await app.inject({ method: "POST", url: "/v1/auth/nonce", payload: { wallet } })).json();
  const sig = Buffer.from(nacl.sign.detached(new TextEncoder().encode(n.message), kp.secretKey)).toString("base64");
  const v = (await app.inject({ method: "POST", url: "/v1/auth/verify", payload: { message: n.message, signature_b64: sig } })).json();
  return { wallet, token: v.access_token as string };
}
const ev = (name: string, slot: number, payload: Record<string, unknown>, signature = `sig${slot}`): ChainEventRecord => ({ signature, eventIndex: 0, slot, blockhash: "b", name, payload });
const W = () => bs58.encode(nacl.sign.keyPair().publicKey);

describe("galleryProjection", () => {
  it("PlayerInitialized 建立、ClockedIn 更新（舊 slot 不覆寫）、CollectibleClaimed 冪等計數", async () => {
    const w = W();
    await galleryProjection(ev("PlayerInitialized", 10, { wallet: w, shoe_level: 1 }), store, now);
    expect((await store.getGalleryPlayer(w))?.shoeLevel).toBe(1);
    await galleryProjection(ev("ClockedIn", 20, { wallet: w, task_date: 20_710, shoe_level: 2, core_level: 2, xp: "450", streak_days: 3, max_streak_days: 5 }), store, now);
    await galleryProjection(ev("ClockedIn", 15, { wallet: w, task_date: 20_705, shoe_level: 1, core_level: 1, xp: "100", streak_days: 1, max_streak_days: 1 }), store, now); // 較舊 → 忽略
    const p = (await store.getGalleryPlayer(w))!;
    expect([p.shoeLevel, p.xp, p.streakDays, p.maxStreakDays, p.lastTaskDate]).toEqual([2, 450n, 3, 5, 20_710]);
    await galleryProjection(ev("PlayerInitialized", 5, { wallet: w, shoe_level: 1 }), store, now); // 重放不重置
    expect((await store.getGalleryPlayer(w))?.xp).toBe(450n);
    await galleryProjection(ev("CollectibleClaimed", 30, { wallet: w, kind: 1, asset: "A1" }), store, now);
    await galleryProjection(ev("CollectibleClaimed", 30, { wallet: w, kind: 1, asset: "A1" }), store, now);
    await galleryProjection(ev("CollectibleClaimed", 31, { wallet: w, kind: 101, asset: "A2" }), store, now);
    expect((await store.getGalleryPlayer(w))?.collectibleCount).toBe(2);
    expect((await store.listGalleryCollectibles(w)).map((c) => c.kind)).toEqual([1, 101]);
  });
});

describe("gallery API", () => {
  it("排行（等級 → XP → 錢包）、分頁、本人名次；玩家頁含收藏與 is_you；搜尋前綴；404／400", async () => {
    const u = await login();
    const a = W();
    const b = W();
    await galleryProjection(ev("ClockedIn", 1, { wallet: a, task_date: 1, shoe_level: 2, core_level: 2, xp: "500", streak_days: 1, max_streak_days: 1 }), store, now);
    await galleryProjection(ev("ClockedIn", 2, { wallet: b, task_date: 1, shoe_level: 3, core_level: 3, xp: "1600", streak_days: 2, max_streak_days: 7 }), store, now);
    await galleryProjection(ev("ClockedIn", 3, { wallet: u.wallet, task_date: 1, shoe_level: 2, core_level: 2, xp: "900", streak_days: 1, max_streak_days: 1 }), store, now);
    await galleryProjection(ev("CollectibleClaimed", 4, { wallet: b, kind: 102, asset: "AS" }), store, now);
    const h = { authorization: `Bearer ${u.token}` };
    let res = await app.inject({ method: "GET", url: "/v1/gallery/players?limit=2", headers: h });
    expect(res.statusCode).toBe(200);
    let body = res.json();
    expect(body.total).toBe(3);
    expect(body.players.map((p: { wallet: string; rank: number }) => [p.rank, p.wallet])).toEqual([[1, b], [2, u.wallet]]);
    expect(body.next_cursor).toBe("2");
    expect(body.you).toEqual({ rank: 2 });
    expect(body.generated_at).toBe(now.toISOString());
    body = (await app.inject({ method: "GET", url: "/v1/gallery/players?limit=2&cursor=2", headers: h })).json();
    expect(body.players.map((p: { wallet: string }) => p.wallet)).toEqual([a]);
    expect(body.next_cursor).toBeNull();

    res = await app.inject({ method: "GET", url: `/v1/gallery/players/${b}`, headers: h });
    body = res.json();
    expect(body.player).toMatchObject({ rank: 1, shoe_level: 3, xp: "1600", max_streak_days: 7, collectible_count: 1 });
    expect(body.is_you).toBe(false);
    expect(body.collectibles).toEqual([{ kind: 102, asset: "AS", signature: "sig4", claimed_at: now.toISOString() }]);
    expect(Object.keys(body.player)).not.toContain("steps");
    expect((await app.inject({ method: "GET", url: `/v1/gallery/players/${u.wallet}`, headers: h })).json().is_you).toBe(true);
    expect((await app.inject({ method: "GET", url: `/v1/gallery/players/${W()}`, headers: h })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/v1/gallery/players/not-base58!`, headers: h })).statusCode).toBe(400);

    body = (await app.inject({ method: "GET", url: `/v1/gallery/search?q=${b.slice(0, 3)}`, headers: h })).json();
    expect(body.players.map((p: { wallet: string }) => p.wallet)).toContain(b);
    expect((await app.inject({ method: "GET", url: `/v1/gallery/search?q=x`, headers: h })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: `/v1/gallery/players` })).statusCode).toBe(401);
  });
});
