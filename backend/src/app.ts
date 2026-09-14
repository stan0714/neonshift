import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";

import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import bs58 from "bs58";

import { ChallengeService } from "./auth/challenge.js";
import { claimRoutes } from "./claim/routes.js";
import { ClaimService } from "./claim/service.js";
import { playerRoutes } from "./player/routes.js";
import { loadRuleSetFile, type RuleSet } from "./risk/rules.js";
import { AttestationSigner, type AttestorSigner, HttpSignerClient, LocalKeypairSigner } from "./signer/index.js";
import { authRoutes } from "./auth/routes.js";
import { AuthService } from "./auth/service.js";
import { type AppConfig } from "./config.js";
import { type Db } from "./db.js";
import { ApiError, notFound } from "./errors.js";
import { Alerts } from "./ops/alerts.js";
import { Metrics } from "./ops/metrics.js";
import { MemoryStore } from "./store/memory.js";
import { PostgresStore } from "./store/postgres.js";
import type { Store } from "./store/types.js";

export type AppDeps = { config: AppConfig; db: Db; store?: Store; now?: () => Date; signer?: AttestorSigner; rules?: RuleSet; alertFetch?: typeof fetch };

export const API_PREFIX = "/v1";

/**
 * Fastify 骨架（PG-B-01，SD 2.2／4.1）。
 * - 結構化 log，並 redact Authorization／cookie（SD 4.2：不得記錄 JWT）
 * - body 上限、統一錯誤格式、`/healthz`（liveness）與 `/readyz`（DB）
 * - 業務路由掛在 `/v1`，由後續 PG-B 項目以 plugin 註冊
 */
export function buildApp({ config, db, store, now, signer, rules, alertFetch }: AppDeps): FastifyInstance {
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
  const challenge = new ChallengeService(dataStore, now);
  const ruleSet = rules ?? loadRuleSetFile(resolve(process.cwd(), config.RULES_FILE));
  const attestorSigner = signer ?? createSigner(config);
  const app = Fastify({
    bodyLimit: config.BODY_LIMIT_BYTES,
    trustProxy: true,
    logger: {
      level: config.NODE_ENV === "test" ? "silent" : config.LOG_LEVEL,
      redact: { paths: ["req.headers.authorization", "req.headers.cookie", "req.body"], censor: "[redacted]" },
    },
  });

  const metrics = new Metrics();
  const alerts = new Alerts(app.log, metrics, {
    ...(config.ALERT_WEBHOOK_URL ? { webhookUrl: config.ALERT_WEBHOOK_URL } : {}),
    ...(alertFetch ? { fetchImpl: alertFetch } : {}),
    issuanceSpikeFactor: 3,
    replayPerWalletPerDay: 10,
  });
  const claim = new ClaimService(
    dataStore,
    challenge,
    new AttestationSigner(attestorSigner),
    ruleSet,
    { programId: config.PROGRAM_ID ? bs58.decode(config.PROGRAM_ID) : new Uint8Array(32), clusterId: config.CLUSTER_ID },
    now,
    { metrics, alerts },
  );
  app.decorate("metrics", metrics);
  app.decorate("alerts", alerts);
  app.decorate("config", config);
  app.decorate("db", db);
  app.decorate("auth", auth);
  app.decorate("challenge", challenge);
  app.decorate("claim", claim);

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
    const code = err.code === "FST_ERR_VALIDATION" ? "VALIDATION" : status === 413 ? "PAYLOAD_TOO_LARGE" : status === 429 ? "RATE_LIMITED" : `HTTP_${status}`;
    return reply.status(status).send({ error: { code, message: err.message ?? "request error" } });
  });

  app.setNotFoundHandler((_req, reply) => {
    const e = notFound();
    return reply.status(e.statusCode).send(e.toBody());
  });

  // ---- PG-B-18：速率限制、稽核、指標 ----
  // 已登入以 JWT sub（錢包）計、未登入以 IP 計；敏感端點另設較低上限（在各路由 config）
  app.register(rateLimit, {
    global: true,
    max: config.RATE_LIMIT_PER_MINUTE,
    timeWindow: "1 minute",
    keyGenerator: (req) => req.auth?.wallet ?? req.ip,
    errorResponseBuilder: () => ({ statusCode: 429, error: "Too Many Requests", message: "too many requests" }),
  });

  app.addHook("onResponse", async (req, reply) => {
    const ms = reply.elapsedTime;
    metrics.observeLatency(ms);
    const route = req.routeOptions?.url ?? "unknown";
    metrics.inc("neonshift_http_requests_total", { route, status: String(reply.statusCode) });
    // 結構化稽核：不記 JWT、簽章與健康 request body（SD 4.2）
    if (/^\/v1\/(auth|attestation|player)/.test(route)) {
      req.log.info(
        { audit: true, route, method: req.method, status: reply.statusCode, wallet: req.auth?.wallet ?? null, ip: req.ip, ms: Math.round(ms), idempotencyKey: req.headers["idempotency-key"] ?? undefined },
        "audit",
      );
    }
  });

  app.get("/metrics", async (req, reply) => {
    const token = config.METRICS_TOKEN;
    if (token) {
      if (req.headers.authorization !== `Bearer ${token}`) return reply.status(401).send({ error: { code: "UNAUTHORIZED", message: "metrics token required" } });
    } else if (config.APP_ENV !== "local") {
      return reply.status(404).send(notFound().toBody());
    }
    return reply.type("text/plain; version=0.0.4").send(metrics.render());
  });

  app.get("/healthz", async () => ({ status: "ok", env: config.APP_ENV, cluster_id: config.CLUSTER_ID }));

  app.get("/readyz", async (_req, reply) => {
    const dbOk = await db.ping();
    const body = { status: dbOk ? "ok" : "degraded", checks: { db: dbOk ? "ok" : db.pool ? "unreachable" : "not_configured" } };
    return reply.status(dbOk ? 200 : 503).send(body);
  });

  app.register(async (v1) => {
    v1.get("/", async () => ({ name: "neonshift-attestor", version: "v1" }));
    await v1.register(authRoutes, { auth, challenge });
    await v1.register(claimRoutes, { auth, claim });
    await v1.register(playerRoutes, { auth, store: dataStore, now: now ?? (() => new Date()) });
    v1.get("/rules/version", async () => ({ rules_version: ruleSet.version, rules_hash: `sha256:${ruleSet.hash.toString("hex")}`, description: ruleSet.config.description ?? null }));
    // 後續：tournament（B-14）
  }, { prefix: API_PREFIX });

  app.addHook("onReady", async () => {
    await claim.init();
    if (attestorSigner.kind === "local") app.log.warn("ATTESTOR_SIGNER 為 local：私鑰在 API process 內，只允許本機 dev");
    app.log.info({ attestor: bs58.encode(await attestorSigner.publicKey()), rules_version: ruleSet.version }, "attestor ready");
  });

  app.addHook("onClose", async () => {
    await db.close();
  });

  return app;
}

function createSigner(config: AppConfig): AttestorSigner {
  const spec = config.ATTESTOR_SIGNER;
  if (!spec) return LocalKeypairSigner.random(); // local／test：每次啟動隨機（鏈上 Config 需以 rotate_attestor 對齊）
  if (spec.startsWith("local:")) return LocalKeypairSigner.fromEnv(spec.slice("local:".length));
  if (spec.startsWith("http:")) return new HttpSignerClient(spec.slice("http:".length), config.SIGNER_TOKEN!);
  throw new Error(`未知的 ATTESTOR_SIGNER：${spec}`);
}

declare module "fastify" {
  interface FastifyInstance {
    config: AppConfig;
    db: Db;
    auth: AuthService;
    challenge: ChallengeService;
    claim: ClaimService;
    metrics: Metrics;
    alerts: Alerts;
  }
}
