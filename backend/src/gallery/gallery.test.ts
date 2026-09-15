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
    // PG-V-02：期末結算切換等級（其餘沿用）；較舊 slot 忽略
    await galleryProjection(ev("EpochSettled", 25, { wallet: w, epoch: 3, points: 0, active_days: 0, level_before: 2, level_after: 1, highest_level: 2, rules_version: 1 }), store, now);
    const q = (await store.getGalleryPlayer(w))!;
    expect([q.shoeLevel, q.coreLevel, q.xp, q.streakDays, q.lastTaskDate]).toEqual([1, 1, 450n, 3, 20_710]);
    await galleryProjection(ev("EpochSettled", 22, { wallet: w, epoch: 2, level_before: 2, level_after: 3, highest_level: 3 }), store, now);
    expect((await store.getGalleryPlayer(w))?.shoeLevel).toBe(1);
    // PG-V-03：歷史最高只增；歷史等級可查（init 當日 Lv1、結算日起 level_after）；重放冪等
    expect((await store.getGalleryPlayer(w))?.highestLevel).toBe(3);
    const settledDay = 20_720;
    await galleryProjection(ev("EpochSettled", 40, { wallet: w, epoch: 4, level_before: 1, level_after: 2, highest_level: 3, settled_at: String(settledDay * 86_400 + 100) }), store, now);
    await galleryProjection(ev("EpochSettled", 40, { wallet: w, epoch: 4, level_before: 1, level_after: 2, highest_level: 3, settled_at: String(settledDay * 86_400 + 100) }), store, now);
    expect((await store.listLevelHistory(w, 10)).filter((h) => h.source === "epoch" && h.epoch === 4)).toHaveLength(1);
    expect((await store.levelAt(w, settledDay))?.activeLevel).toBe(2);
    expect((await store.levelAt(w, settledDay - 1))?.activeLevel).toBe(1); // 結算前一天仍為前一筆
    await galleryProjection(ev("PlayerMigrated", 41, { wallet: w, epoch_anchor: 20_730, active_level: 4, highest_level: 4, rules_version: 1 }), store, now);
    expect((await store.levelAt(w, 20_731))?.activeLevel).toBe(4);
    expect((await store.getGalleryPlayer(w))?.highestLevel).toBe(4);
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
    // PG-V-04：a 曾達 Lv5 後降回 Lv2 → 現役榜仍第 3；Lifetime 榜（歷史最高 → 收藏 → XP）第 1
    await galleryProjection(ev("EpochSettled", 5, { wallet: a, epoch: 3, level_before: 5, level_after: 2, highest_level: 5, settled_at: "1700000000" }), store, now);
    body = (await app.inject({ method: "GET", url: "/v1/gallery/players", headers: h })).json();
    expect(body.board).toBe("active");
    expect(body.players.map((p: { wallet: string; highest_level: number }) => [p.wallet, p.highest_level])).toEqual([[b, 3], [u.wallet, 2], [a, 5]]);
    body = (await app.inject({ method: "GET", url: "/v1/gallery/players?board=lifetime", headers: h })).json();
    expect(body.board).toBe("lifetime");
    expect(body.players.map((p: { wallet: string; rank: number }) => [p.rank, p.wallet])).toEqual([[1, a], [2, b], [3, u.wallet]]);
    expect(body.you).toEqual({ rank: 3 });

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
  it("PG-R-09：玩家頁含已鑄造 PB 成就（Current／Historical／Invalidated、公開同意才有值）；NFT 詳情；退出藝廊後對他人 404、排行排除、本人仍可見；player 刪除後隱藏", async () => {
    const u = await login();
    const h = { authorization: `Bearer ${u.token}` };
    const viewer = await login();
    const hv = { authorization: `Bearer ${viewer.token}` };
    await galleryProjection(ev("ClockedIn", 1, { wallet: u.wallet, task_date: 1, shoe_level: 2, core_level: 2, xp: "500", streak_days: 1, max_streak_days: 1 }), store, now);
    await galleryProjection(ev("ClockedIn", 2, { wallet: viewer.wallet, task_date: 1, shoe_level: 1, core_level: 1, xp: "10", streak_days: 1, max_streak_days: 1 }), store, now);
    // 兩個 PB（Baseline → 改善）；各自成就：舊的公開、新的私密；都鑄造
    const key = "run|fastest_5k|outdoor|device|elapsed|1";
    const d = (id: string, value: bigint, status: "current" | "historical", base: boolean, prev: string | null) => ({ key, discipline: "run" as const, category: "fastest_5k", environment: "outdoor", verificationClass: "device", timingBasis: "elapsed", rulesMajor: 1, value, sourceKind: "workout" as const, sourceId: id, sourceRevision: 1, achievedAt: now, status, isBaseline: base, previousSourceId: prev });
    const pbs = await store.syncPbRevisions(u.wallet, [d("a", 1_600_000n, "historical", true, null), d("b", 1_500_000n, "current", false, "a")], now);
    const { buildMetadata, metadataHashOf, achievementIdOf } = await import("../pb/achievements.js");
    const assetA = W();
    const assetB = W();
    for (const [pb, consent, asset] of [[pbs[0]!, true, assetA], [pbs[1]!, false, assetB]] as const) {
      const id = achievementIdOf(u.wallet, pb.pbId);
      const metadata = buildMetadata(pb, id, consent);
      await store.upsertAchievement({ achievementId: id, wallet: u.wallet, kind: "pb", pbId: pb.pbId, milestoneKey: null, sourceKind: "workout", sourceId: pb.sourceId, category: pb.category, verificationClass: "device", sourceRevision: 1, rulesMajor: 1, publicConsent: consent, metadata, metadataHash: metadataHashOf(metadata), status: "approved", registrySignature: "r", registryUpdatedAt: now, asset: null, mintedSignature: null, mintedAt: null }, now);
      await galleryProjection(ev("AchievementClaimed", 10, { wallet: u.wallet, achievement_id: id, category: 2, verification_class: 2, source_revision: 1, asset }, `mint-${asset}`), store, now);
    }
    let body = (await app.inject({ method: "GET", url: `/v1/gallery/players/${u.wallet}`, headers: hv })).json();
    expect(body.achievements.map((a: Record<string, unknown>) => [a.asset, a.record, a.public, a.value, a.series])).toEqual([[assetA, "historical", true, "26:40", "pb_speed"], [assetB, "current", false, null, "pb_speed"]]);
    const detail = (await app.inject({ method: "GET", url: `/v1/gallery/achievements/${assetA}`, headers: hv })).json();
    expect(detail).toMatchObject({ original_achiever: u.wallet, record: "historical", network: "devnet", explorer_url: expect.stringContaining(assetA) });
    expect((await app.inject({ method: "GET", url: `/v1/gallery/achievements/${W()}`, headers: hv })).statusCode).toBe(404);
    // 撤銷 → Invalidated
    await store.setAchievementStatus(achievementIdOf(u.wallet, pbs[1]!.pbId), "revoked", { registrySignature: "rv" }, now);
    body = (await app.inject({ method: "GET", url: `/v1/gallery/players/${u.wallet}`, headers: hv })).json();
    expect(body.achievements[1].record).toBe("invalidated");
    // 退出藝廊
    expect((await app.inject({ method: "PATCH", url: "/v1/me/gallery-privacy", headers: h, payload: { hidden: true } })).json()).toEqual({ hidden: true });
    expect((await app.inject({ method: "GET", url: `/v1/gallery/players/${u.wallet}`, headers: hv })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/v1/gallery/achievements/${assetA}`, headers: hv })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/v1/gallery/players", headers: hv })).json().total).toBe(1);
    const mine = (await app.inject({ method: "GET", url: `/v1/gallery/players/${u.wallet}`, headers: h })).json();
    expect([mine.is_you, mine.hidden, mine.achievements.length]).toEqual([true, true, 2]);
    await app.inject({ method: "PATCH", url: "/v1/me/gallery-privacy", headers: h, payload: { hidden: false } });
    expect((await app.inject({ method: "GET", url: "/v1/gallery/players", headers: hv })).json().total).toBe(2);
    // 刪除帳號 → 隱藏；已鑄造成就仍存在於資料（鏈上事實）但不展示
    await app.inject({ method: "DELETE", url: "/v1/player/data", headers: h });
    expect((await app.inject({ method: "GET", url: `/v1/gallery/players/${u.wallet}`, headers: hv })).statusCode).toBe(404);
    expect((await store.listAchievements(u.wallet)).length).toBe(2);
  });
});
