/**
 * Player API（PG-B-12／B-13，SD 4.1）。
 * - GET /player/history?days=30：只回保留期內（≤ 30 天）的打卡紀錄；`redeemed_signature` 由 indexer 回填（B-16）
 * - DELETE /player/data：撤銷 session、停止新處理、刪除健康摘要與衍生資料；有進行中已質押賽事時延後
 *   至結算完成且總保留不超過 30 天，回 202 與 `deletion_due_at`（BR-25）。鏈上資料無法刪除，回應明說。
 */
import type { FastifyInstance } from "fastify";

import { requireAuth } from "../auth/routes.js";
import type { AuthService } from "../auth/service.js";
import { ApiError } from "../errors.js";
import type { Store } from "../store/types.js";

export const RETENTION_DAYS = 30;
const SECONDS_PER_DAY = 86_400;

export async function playerRoutes(app: FastifyInstance, opts: { auth: AuthService; store: Store; now: () => Date }) {
  const { auth, store, now } = opts;

  app.get("/player/history", { preHandler: requireAuth(auth) }, async (req) => {
    const raw = (req.query as { days?: string }).days ?? String(RETENTION_DAYS);
    const days = Number(raw);
    if (!Number.isInteger(days) || days < 1 || days > RETENTION_DAYS) throw new ApiError(400, "VALIDATION", `days must be 1..${RETENTION_DAYS}`);
    const today = Math.floor(now().getTime() / 1000 / SECONDS_PER_DAY);
    const since = today - days + 1;
    const items = await store.listHistory(req.auth!.wallet, since);
    return {
      days,
      retention_days: RETENTION_DAYS,
      items: items.map((i) => ({
        task_date: i.taskDate,
        task_type: i.taskType === 1 ? "steps" : "sleep",
        issued_at: i.issuedAt.toISOString(),
        expires_at: i.expiresAt.toISOString(),
        redeemed_signature: i.redeemedSig,
      })),
    };
  });

  app.delete("/player/data", { preHandler: requireAuth(auth) }, async (req, reply) => {
    const wallet = req.auth!.wallet;
    const t = now();
    let deferUntil: Date | null = null;
    if (await store.hasActiveStakedTournament(wallet)) {
      // 最長保留至賽事完成，且不得突破 30 天（以請求時間起算）；B-14 接入後改為賽事 ends_at 與上限取小
      deferUntil = new Date(t.getTime() + RETENTION_DAYS * SECONDS_PER_DAY * 1000);
    }
    const result = await store.deletePlayerData(wallet, t, deferUntil);
    if (result.deferred) {
      return reply.status(202).send({
        status: "scheduled",
        deletion_due_at: result.deletionDueAt!.toISOString(),
        note: "Sessions revoked and new processing stopped. Settlement summaries for your active staked tournament are kept until it settles, never beyond the retention limit. Onchain records (wallet, transactions) are public and cannot be deleted.",
      });
    }
    return reply.status(204).send();
  });
}
