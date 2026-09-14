import type { FastifyInstance, FastifyRequest } from "fastify";

import { ApiError } from "../errors.js";
import type { AuthService } from "./service.js";

declare module "fastify" {
  interface FastifyRequest {
    auth?: { wallet: string; sessionJti: string };
  }
}

/** 只信任驗證後 JWT 的 sub（SD 4.2） */
export function requireAuth(auth: AuthService) {
  return async (req: FastifyRequest) => {
    const header = req.headers.authorization ?? "";
    const m = /^Bearer\s+(.+)$/i.exec(header);
    if (!m) throw new ApiError(401, "UNAUTHORIZED", "missing bearer token");
    req.auth = await auth.authenticate(m[1]!);
  };
}

export async function authRoutes(app: FastifyInstance, opts: { auth: AuthService }) {
  const { auth } = opts;

  app.post("/auth/nonce", {
    schema: { body: { type: "object", required: ["wallet"], properties: { wallet: { type: "string", minLength: 32, maxLength: 44 } }, additionalProperties: false } },
  }, async (req) => auth.issueNonce((req.body as { wallet: string }).wallet));

  app.post("/auth/verify", {
    schema: {
      body: {
        type: "object",
        required: ["message", "signature_b64"],
        properties: { message: { type: "string", maxLength: 2048 }, signature_b64: { type: "string", maxLength: 128 } },
        additionalProperties: false,
      },
    },
  }, async (req) => {
    const { message, signature_b64 } = req.body as { message: string; signature_b64: string };
    return auth.verify(message, signature_b64);
  });

  app.post("/auth/refresh", {
    schema: { body: { type: "object", required: ["refresh_token"], properties: { refresh_token: { type: "string", maxLength: 128 } }, additionalProperties: false } },
  }, async (req) => auth.refresh((req.body as { refresh_token: string }).refresh_token));

  app.post("/auth/logout", { preHandler: requireAuth(auth) }, async (req, reply) => {
    await auth.logout(req.auth!.sessionJti);
    return reply.status(204).send();
  });
}
