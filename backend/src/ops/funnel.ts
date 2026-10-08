/**
 * XD-07 量測（mobile-differentiation 6）：任務漏斗（接受→開始→合格完成→領取，每步分母分開）與玩家概況／粗略留存。
 * - 只回計數與錯誤碼類資訊：不含錢包、路線、健康數字、邀請 token。
 * - 「開始」＝接受後有任何一筆運動（不論是否合格），「合格完成」＝伺服器判定 completed／claimed。
 * - D7／D30 以 players.first_seen／last_seen 粗估（last_seen 於首見後 ≥7／≥30 天）；只是觀察值，不作成效宣稱（試辦前不得引用）。
 * - 曝光（任務卡顯示次數）不在伺服器端計；App 未做事件上報（隱私預設），漏斗自「接受」起算。
 * OPS_TOKEN 未設定時 404。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { ApiError } from "../errors.js";
import type { Store } from "../store/types.js";

export async function opsFunnelRoutes(app: FastifyInstance, opts: { store: Store; now: () => Date }) {
  const ops = (req: FastifyRequest) => {
    const token = app.config.OPS_TOKEN;
    if (!token) throw new ApiError(404, "NOT_FOUND", "not found");
    if (req.headers.authorization !== `Bearer ${token}`) throw new ApiError(401, "UNAUTHORIZED", "ops token required");
  };
  app.get("/ops/metrics/funnel", async (req) => {
    ops(req);
    const q = z.object({ since: z.coerce.date().optional(), until: z.coerce.date().optional() }).parse(req.query ?? {});
    const now = opts.now();
    const since = q.since ?? new Date(now.getTime() - 30 * 86_400_000);
    const until = q.until ?? now;
    if (until <= since) throw new ApiError(422, "VALIDATION", "until must be after since");
    const [funnel, players] = await Promise.all([opts.store.questFunnel(since, until), opts.store.playerCohortStats(since, now)]);
    return {
      as_of: now.toISOString(), since: since.toISOString(), until: until.toISOString(),
      quest_funnel: funnel.map((r) => ({ template_id: r.templateId, accepted: r.accepted, started: r.started, completed: r.completed, claimed: r.claimed, revoked: r.revoked, expired: r.expired, rates: { start: rate(r.started, r.accepted), complete: rate(r.completed, r.started), claim: rate(r.claimed, r.completed) } })),
      players,
      notes: ["counts_only_no_wallets", "exposure_not_tracked_funnel_starts_at_accept", "retention_is_observational_last_seen_based", "test_and_retry_traffic_not_excluded"],
    };
  });
}
const rate = (n: number, d: number) => (d > 0 ? Number((n / d).toFixed(3)) : null);
