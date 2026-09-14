import type { FastifyInstance } from "fastify";

import { requireAuth } from "../auth/routes.js";
import type { AuthService } from "../auth/service.js";
import { ApiError } from "../errors.js";
import type { ClaimService } from "./service.js";

export async function claimRoutes(app: FastifyInstance, opts: { auth: AuthService; claim: ClaimService }) {
  app.post("/attestation/claim", { preHandler: requireAuth(opts.auth) }, async (req, reply) => {
    const key = req.headers["idempotency-key"];
    if (typeof key !== "string") throw new ApiError(400, "VALIDATION", "Idempotency-Key header is required");
    const outcome = await opts.claim.claim(req.auth!.wallet, key, req.body);
    return reply.status(outcome.httpStatus).send(outcome.body);
  });
}
