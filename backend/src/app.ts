import Fastify, { type FastifyError, type FastifyInstance } from "fastify";

import { randomBytes } from "node:crypto";

import { authRoutes } from "./auth/routes.js";
import { AuthService } from "./auth/service.js";
import { type AppConfig } from "./config.js";
import { type Db } from "./db.js";
import { ApiError, notFound } from "./errors.js";
import { MemoryStore } from "./store/memory.js";
import { PostgresStore } from "./store/postgres.js";
import type { Store } from "./store/types.js";

export type AppDeps = { config: AppConfig; db: Db; store?: Store; now?: () => Date };

export const API_PREFIX = "/v1";

/**
 * Fastify 骨架（PG-B-01，SD 2.2／4.1）。
 * - 結構化 log，並 redact Authorization／cookie（SD 4.2：不得記錄 JWT）
 * - body 上限、統一錯誤格式、`/healthz`（liveness）與 `/readyz`（DB）
 * - 業務路由掛在 `/v1`，由後續 PG-B 項目以 plugin 註冊
 */
export function buildApp({ config, db, store, now }: AppDeps): FastifyInstance {
  const dataStore: Store = store ?? (db.pool ? new PostgresStore(db.pool) : new MemoryStore());
  const auth = new AuthService(
    dataStore,
    {
      domain: config.SIWS_DOMAIN,
      uri: config.SIWS_URI,
      chainId: `solana:${config.CLUSTER_ID === 1 ? "devnet" : "localnet"}`,
      tokens: {
        secret: new TextEncoder().encode(config.JWT_SECRET ?? randomBytes(32).toString("base64url")),
        issuer: config.SIWS_DOMAIN,
        audience: `${config.SIWS_DOMAIN}/api`,
      },
    },
    now,
  );
  const app = Fastify({
    bodyLimit: config.BODY_LIMIT_BYTES,
    trustProxy: true,
    logger: {
      level: config.NODE_ENV === "test" ? "silent" : config.LOG_LEVEL,
      redact: { paths: ["req.headers.authorization", "req.headers.cookie", "req.body"], censor: "[redacted]" },
    },
  });

  app.decorate("config", config);
  app.decorate("db", db);
  app.decorate("auth", auth);

  app.setErrorHandler((raw: unknown, req, reply) => {
    if (raw instanceof ApiError) {
      return reply.status(raw.statusCode).send(raw.toBody());
    }
    const err = raw as Partial<FastifyError> & { message?: string };
    // Fastify 內建：schema 驗證、body 過大、JSON 解析錯誤等
    const status = typeof err.statusCode === "number" && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) {
      req.log.error({ err, reqId: req.id }, "unhandled error");
      return reply.status(500).send({ error: { code: "INTERNAL", message: "internal error" } });
    }
    const code = err.code === "FST_ERR_VALIDATION" ? "VALIDATION" : status === 413 ? "PAYLOAD_TOO_LARGE" : `HTTP_${status}`;
    return reply.status(status).send({ error: { code, message: err.message ?? "request error" } });
  });

  app.setNotFoundHandler((_req, reply) => {
    const e = notFound();
    return reply.status(e.statusCode).send(e.toBody());
  });

  app.get("/healthz", async () => ({ status: "ok", env: config.APP_ENV, cluster_id: config.CLUSTER_ID }));

  app.get("/readyz", async (_req, reply) => {
    const dbOk = await db.ping();
    const body = { status: dbOk ? "ok" : "degraded", checks: { db: dbOk ? "ok" : db.pool ? "unreachable" : "not_configured" } };
    return reply.status(dbOk ? 200 : 503).send(body);
  });

  app.register(async (v1) => {
    v1.get("/", async () => ({ name: "neonshift-attestor", version: "v1" }));
    await v1.register(authRoutes, { auth });
    // 後續：challenge（B-05）、attestation（B-11）、player（B-12～13）、tournament（B-14）、rules（B-07）
  }, { prefix: API_PREFIX });

  app.addHook("onClose", async () => {
    await db.close();
  });

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    config: AppConfig;
    db: Db;
    auth: AuthService;
  }
}
