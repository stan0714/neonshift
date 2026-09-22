/**
 * ops：單一玩家診斷摘要（OPS_TOKEN）。真機驗收／評審支援時，不必查 DB 就能回答
 * 「這筆運動為什麼沒算 PB／首次 5 km」「成就卡在哪個狀態」「SKR 訂單怎麼了」。
 * 只回公開摘要與狀態欄位（無路線、無原始健康資料、無 token）；OPS_TOKEN 未設定時整個端點 404。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";

import { ApiError } from "../errors.js";
import { MilestoneService, milestoneView } from "../milestones/service.js";
import { achievementView } from "../pb/achievements.js";
import { PersonalBestService, pbView } from "../pb/service.js";
import type { Store } from "../store/types.js";
import { workoutView } from "../workouts/routes.js";

export async function opsPlayerRoutes(app: FastifyInstance, opts: { store: Store; pbs: PersonalBestService; milestones: MilestoneService; now: () => Date }) {
  const { store, pbs, milestones, now } = opts;
  const ops = (req: FastifyRequest) => {
    const token = app.config.OPS_TOKEN;
    if (!token) throw new ApiError(404, "NOT_FOUND", "not found");
    if (req.headers.authorization !== `Bearer ${token}`) throw new ApiError(401, "UNAUTHORIZED", "ops token required");
  };

  app.get("/ops/players/:wallet", async (req) => {
    ops(req);
    const wallet = (req.params as { wallet: string }).wallet;
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) throw new ApiError(422, "VALIDATION", "wallet must be base58");
    const [player, workouts, pbRows, ms, achievements, levelHistory, skrOrders, skrEntitlements] = await Promise.all([
      store.getPlayer(wallet),
      store.listWorkouts(wallet, 200, 0),
      pbs.recompute(wallet),
      milestones.resolve(wallet),
      store.listAchievements(wallet),
      store.listLevelHistory(wallet, 20),
      store.listSkrOrders(wallet, 20),
      store.listSkrEntitlements(wallet),
    ]);
    return {
      as_of: now().toISOString(),
      wallet,
      player: player ? { first_seen_at: player.firstSeenAt.toISOString(), last_seen_at: player.lastSeenAt.toISOString(), deleted_at: player.deletedAt?.toISOString() ?? null } : null,
      level_history: levelHistory.map((h) => ({ effective_from_date: h.effectiveFromDate, active_level: h.activeLevel, highest_level: h.highestLevel, epoch: h.epoch, source: h.source })),
      // 每筆運動附「為什麼不算」：status／quality／review_reasons／pb_eligible 一眼可見
      workouts: workouts.map((w) => {
        const v = workoutView(w);
        return { session_id: v.session_id, started_at: v.started_at, sport: v.sport, origin: v.source.origin, environment: v.environment, status: v.status, quality: v.quality, review_reasons: w.reviewReasons, pb_eligible: w.pbEligible, distance_mm: w.distanceMm?.toString() ?? null, distance_method: w.distanceMethod, elapsed_ms: w.elapsedMs.toString(), revision: w.revision, possible_duplicate_of: w.possibleDuplicateOf, deleted_at: w.deletedAt?.toISOString() ?? null };
      }),
      personal_bests: pbRows.filter((p) => p.status === "current").map(pbView),
      milestones: ms.resolutions.map(milestoneView),
      achievements: achievements.map((a) => ({ ...achievementView(a), wallet: undefined })),
      skr: {
        orders: skrOrders.map((o) => ({ order_id: o.orderId, sku: o.sku, network: o.network, status: o.status, amount: o.amount.toString(), signature: o.signature, failure_reason: o.failureReason, expires_at: o.expiresAt.toISOString(), created_at: o.createdAt.toISOString() })),
        entitlements: skrEntitlements.map((e) => ({ cosmetic_id: e.cosmeticId, status: e.status, order_id: e.orderId, granted_at: e.grantedAt.toISOString() })),
      },
    };
  });
}
