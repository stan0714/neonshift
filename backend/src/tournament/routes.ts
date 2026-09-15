import type { FastifyInstance } from "fastify";

import { requireAuth } from "../auth/routes.js";
import type { AuthService } from "../auth/service.js";
import { ApiError } from "../errors.js";
import type { TournamentService } from "./service.js";

/** PG-B-14：`/tournament/current`、`/tournament/steps`、`/tournament/{weekId}/leaderboard` */
export async function tournamentRoutes(app: FastifyInstance, opts: { auth: AuthService; tournaments: TournamentService }) {
  const { auth, tournaments } = opts;

  app.get("/tournament/current", { preHandler: requireAuth(auth) }, async (req) => tournaments.current(req.auth!.wallet));

  app.get("/tournament/:weekId/leaderboard", { preHandler: requireAuth(auth) }, async (req) => {
    const weekId = Number((req.params as { weekId: string }).weekId);
    if (!Number.isInteger(weekId) || weekId < 2026_01 || weekId > 2100_53) throw new ApiError(400, "VALIDATION", "weekId must be ISO year×100+week");
    return tournaments.leaderboard(weekId, req.auth!.wallet);
  });

  /** ops：結算 manifest（OPS_TOKEN；未設定時 404，不暴露端點） */
  app.get("/tournament/:weekId/manifest", async (req, reply) => {
    const token = app.config.OPS_TOKEN;
    if (!token) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "not found" } });
    if (req.headers.authorization !== `Bearer ${token}`) return reply.status(401).send({ error: { code: "UNAUTHORIZED", message: "ops token required" } });
    const weekId = Number((req.params as { weekId: string }).weekId);
    if (!Number.isInteger(weekId) || weekId < 2026_01 || weekId > 2100_53) throw new ApiError(400, "VALIDATION", "weekId must be ISO year×100+week");
    return tournaments.manifest(weekId);
  });

  app.post("/tournament/steps", { preHandler: requireAuth(auth), config: { rateLimit: { max: app.config.RATE_LIMIT_SENSITIVE_PER_MINUTE, timeWindow: "1 minute" } } }, async (req, reply) => {
    const key = req.headers["idempotency-key"];
    if (typeof key !== "string") throw new ApiError(400, "VALIDATION", "Idempotency-Key header is required");
    const outcome = await tournaments.submitSteps(req.auth!.wallet, key, req.body);
    return reply.status(outcome.httpStatus).send(outcome.body);
  });
}
