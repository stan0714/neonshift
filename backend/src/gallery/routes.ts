/**
 * 藝廊 API（PG-G-02，SD 11A、FR-13）：全站排行、任意玩家公開頁、地址前綴搜尋。
 * 只回鏈上公開推導資料（等級／XP／連續／收藏），絕不含健康數值；需 JWT（SD 4.2）。
 */
import type { FastifyInstance } from "fastify";

import { requireAuth } from "../auth/routes.js";
import type { AuthService } from "../auth/service.js";
import { ApiError } from "../errors.js";
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
    const p = await store.getGalleryPlayer(wallet);
    if (!p) throw new ApiError(404, "NOT_FOUND", "player not found");
    const [rank, collectibles] = await Promise.all([store.galleryRankOf(wallet), store.listGalleryCollectibles(wallet)]);
    return {
      player: view(p, rank),
      is_you: wallet === req.auth!.wallet,
      collectibles: collectibles.map((c) => ({ kind: c.kind, asset: c.asset, signature: c.signature, claimed_at: c.claimedAt.toISOString() })),
    };
  });
}
