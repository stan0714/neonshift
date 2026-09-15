/**
 * 藝廊 API（PG-G-02，SD 11A、FR-13）：全站排行、任意玩家公開頁、地址前綴搜尋。
 * 只回鏈上公開推導資料（等級／XP／連續／收藏），絕不含健康數值；需 JWT（SD 4.2）。
 */
import type { FastifyInstance } from "fastify";

import { requireAuth } from "../auth/routes.js";
import type { AuthService } from "../auth/service.js";
import { ApiError } from "../errors.js";
import type { Achievement, PbRevision } from "../store/types.js";
import type { GalleryPlayer, Store } from "../store/types.js";

const base58 = /^[1-9A-HJ-NP-Za-km-z]{1,44}$/;
export const GALLERY_PAGE = 50;

const view = (p: GalleryPlayer, rank: number | null) => ({
  rank,
  wallet: p.wallet,
  shoe_level: p.shoeLevel,
  core_level: p.coreLevel,
  xp: p.xp.toString(),
  streak_days: p.streakDays,
  max_streak_days: p.maxStreakDays,
  last_task_date: p.lastTaskDate,
  collectible_count: p.collectibleCount,
  updated_at: p.updatedAt.toISOString(),
});

export async function galleryRoutes(app: FastifyInstance, opts: { auth: AuthService; store: Store; now: () => Date }) {
  const { auth, store, now } = opts;

  app.get("/gallery/players", { preHandler: requireAuth(auth) }, async (req) => {
    const q = req.query as { limit?: string; cursor?: string };
    const limit = Math.min(GALLERY_PAGE, Math.max(1, Number(q.limit ?? GALLERY_PAGE) || GALLERY_PAGE));
    const offset = Math.max(0, Number(q.cursor ?? 0) || 0);
    const [rows, total, you] = await Promise.all([store.listGalleryPlayers(limit, offset), store.countGalleryPlayers(), store.galleryRankOf(req.auth!.wallet)]);
    return {
      generated_at: now().toISOString(),
      total,
      next_cursor: offset + rows.length < total ? String(offset + rows.length) : null,
      players: rows.map((p, i) => view(p, offset + i + 1)),
      you: you === null ? null : { rank: you },
    };
  });

  app.get("/gallery/search", { preHandler: requireAuth(auth) }, async (req) => {
    const q = String((req.query as { q?: string }).q ?? "").trim();
    if (q.length < 2 || !base58.test(q)) throw new ApiError(400, "VALIDATION", "q must be a base58 prefix of at least 2 characters");
    const rows = await store.searchGalleryPlayers(q, 20);
    return { players: await Promise.all(rows.map(async (p) => view(p, await store.galleryRankOf(p.wallet)))) };
  });

  app.get("/gallery/players/:wallet", { preHandler: requireAuth(auth) }, async (req) => {
    const wallet = (req.params as { wallet: string }).wallet;
    if (!base58.test(wallet) || wallet.length < 32) throw new ApiError(400, "VALIDATION", "wallet must be a base58 address");
    const isYou = wallet === req.auth!.wallet;
    // PG-R-09：退出藝廊者對他人 404（只停止展示，不代表鏈上資料消失）
    if (!isYou && (await store.isGalleryHidden(wallet))) throw new ApiError(404, "NOT_FOUND", "player not found");
    const p = await store.getGalleryPlayer(wallet);
    if (!p) throw new ApiError(404, "NOT_FOUND", "player not found");
    const [rank, collectibles, achievements, pbs] = await Promise.all([store.galleryRankOf(wallet), store.listGalleryCollectibles(wallet), store.listAchievements(wallet), store.listPbRevisions(wallet)]);
    return {
      player: view(p, rank),
      is_you: isYou,
      hidden: isYou ? await store.isGalleryHidden(wallet) : false,
      collectibles: collectibles.map((c) => ({ kind: c.kind, asset: c.asset, signature: c.signature, claimed_at: c.claimedAt.toISOString() })),
      achievements: achievements.filter((a) => a.mintedSignature !== null).map((a) => publicAchievement(a, pbs)),
    };
  });

  /** NFT 詳情（activity-running-gallery 6.2）：作品、系列、原達成者、鑄造日期、來源、Current／Historical／Invalidated；精確值只在公開同意時 */
  app.get("/gallery/achievements/:asset", { preHandler: requireAuth(auth) }, async (req) => {
    const asset = (req.params as { asset: string }).asset;
    if (!base58.test(asset) || asset.length < 32) throw new ApiError(400, "VALIDATION", "asset must be a base58 address");
    const a = await store.getAchievementByAsset(asset);
    if (!a || a.mintedSignature === null) throw new ApiError(404, "NOT_FOUND", "achievement not found");
    if (a.wallet !== req.auth!.wallet && (await store.isGalleryHidden(a.wallet))) throw new ApiError(404, "NOT_FOUND", "achievement not found");
    const pbs = await store.listPbRevisions(a.wallet);
    return { ...publicAchievement(a, pbs), original_achiever: a.wallet, metadata: a.metadata, network: "devnet", explorer_url: `https://explorer.solana.com/address/${asset}?cluster=devnet` };
  });

  /** 藝廊展示偏好（PG-R-09）：退出只停止展示 */
  app.get("/me/gallery-privacy", { preHandler: requireAuth(auth) }, async (req) => ({ hidden: await store.isGalleryHidden(req.auth!.wallet) }));
  app.patch("/me/gallery-privacy", { preHandler: requireAuth(auth) }, async (req) => {
    const hidden = (req.body as { hidden?: unknown } | undefined)?.hidden;
    if (typeof hidden !== "boolean") throw new ApiError(422, "VALIDATION", "hidden (boolean) is required");
    await store.setGalleryHidden(req.auth!.wallet, hidden, now());
    return { hidden };
  });
}

/** 公開投影：類別、系列、驗證等級、狀態；精確值只有 public_consent 時（來自 canonical metadata） */
function publicAchievement(a: Achievement, pbs: PbRevision[]) {
  const pb = a.kind === "pb" ? pbs.find((p) => p.pbId === a.pbId) : null;
  const invalid = a.status === "revoked" || a.status === "revoke_pending";
  // PG-M-02 里程碑：有效即 current（沒有「被超越」的歷史概念）；來源失效 → invalidated
  const record: "current" | "historical" | "invalidated" = a.kind === "milestone" || a.kind === "event" ? (invalid ? "invalidated" : "current") : invalid || !pb || pb.status === "invalidated" ? "invalidated" : pb.status === "current" ? "current" : "historical";
  const attrs = (a.metadata.attributes as { trait_type: string; value: string }[] | undefined) ?? [];
  const valueAttr = attrs.find((x) => x.trait_type === "Time" || x.trait_type === "Distance");
  return {
    achievement_id: a.achievementId,
    asset: a.asset,
    kind: a.kind,
    series: a.kind === "event" ? a.category : a.kind === "milestone" ? (a.category === "first_finish" ? "first_finish" : "genesis_distance") : a.category === "longest_run" ? "pb_distance" : "pb_speed",
    event: a.kind === "event" ? { title: ((a.metadata.attributes as { trait_type: string; value: string }[] | undefined) ?? []).find((x) => x.trait_type === "Event")?.value ?? null, event_id: (a.metadata.properties as { event_id?: string } | undefined)?.event_id ?? null } : null,
    category: a.category,
    verification_class: a.verificationClass,
    environment: (attrs.find((x) => x.trait_type === "Environment")?.value as string | undefined) ?? "outdoor",
    record,
    public: a.publicConsent,
    value: a.publicConsent && valueAttr ? valueAttr.value : null,
    // 活動章的活動日期為公開資訊；其餘精確日期只在公開同意時
    achieved_on: a.kind === "event" ? ((attrs.find((x) => x.trait_type === "Event date")?.value as string | undefined) ?? null) : a.publicConsent ? ((attrs.find((x) => x.trait_type === "Achieved")?.value as string | undefined) ?? null) : null,
    image: a.metadata.image as string,
    name: a.metadata.name as string,
    minted_at: a.mintedAt?.toISOString() ?? null,
    minted_signature: a.mintedSignature,
    metadata_uri: `/v1/nft/achievements/${a.achievementId}.json`,
  };
}
