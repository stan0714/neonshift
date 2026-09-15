/**
 * 隔離 attestor signer service（PG-B-10，SD 4.6）。與 API 分 process／分 unit 執行，只綁 loopback；
 * API 以 `ATTESTOR_SIGNER=http:http://127.0.0.1:<port>` + `SIGNER_TOKEN` 呼叫（HttpSignerClient 協定）。
 * 只簽 164-byte canonical attestation（先 decode／validate），不提供任意訊息簽章。
 */
import { timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";

import { ACHIEVEMENT_LEN, decodeAchievement, validateAchievement } from "../lib/achievement.js";
import { decode, validate } from "../lib/attestation.js";
import { LocalKeypairSigner } from "./local.js";

export type SignerServiceOptions = {
  signer: LocalKeypairSigner;
  token: string;
  logger?: boolean;
};

const MESSAGE_LEN = 164;

function tokenMatches(header: string | undefined, token: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice(7));
  const want = Buffer.from(token);
  return given.length === want.length && timingSafeEqual(given, want);
}

export function buildSignerService({ signer, token, logger = false }: SignerServiceOptions): FastifyInstance {
  if (token.length < 32) throw new Error("SIGNER_TOKEN 需 ≥ 32 字元");
  const app = Fastify({ logger, bodyLimit: 4 * 1024 });

  app.get("/healthz", async () => ({ status: "ok" }));

  app.addHook("onRequest", async (req, reply) => {
    if (req.url === "/healthz") return;
    if (!tokenMatches(req.headers.authorization, token)) return reply.status(401).send({ error: "UNAUTHORIZED" });
  });

  app.get("/pubkey", async () => ({ pubkey_b64: Buffer.from(await signer.publicKey()).toString("base64") }));

  app.post<{ Body: { message_b64?: unknown } }>("/sign", async (req, reply) => {
    const b64 = req.body?.message_b64;
    if (typeof b64 !== "string") return reply.status(400).send({ error: "BAD_REQUEST" });
    const message = Buffer.from(b64, "base64");
    if (message.length !== MESSAGE_LEN && message.length !== ACHIEVEMENT_LEN) return reply.status(400).send({ error: "BAD_LENGTH" });
    try {
      // 只簽兩種 canonical 格式：164-byte 打卡 attestation、194-byte 成就證明（各自 domain／時效檢查）
      if (message.length === ACHIEVEMENT_LEN) validateAchievement(decodeAchievement(message));
      else validate(decode(message));
    } catch (e) {
      req.log.warn({ err: e }, "refused non-canonical attestation");
      return reply.status(400).send({ error: "INVALID_ATTESTATION" });
    }
    return { signature_b64: Buffer.from(await signer.sign(message)).toString("base64") };
  });

  return app;
}

/** 進入點：`npm run signer`。環境變數：SIGNER_KEYPAIR（Solana CLI JSON 路徑）、SIGNER_TOKEN、SIGNER_PORT（預設 6081）、SIGNER_HOST（預設 127.0.0.1）。 */
export async function main(): Promise<void> {
  const keypair = process.env.SIGNER_KEYPAIR;
  const token = process.env.SIGNER_TOKEN;
  if (!keypair || !token) throw new Error("需要 SIGNER_KEYPAIR 與 SIGNER_TOKEN");
  const host = process.env.SIGNER_HOST ?? "127.0.0.1";
  const port = Number(process.env.SIGNER_PORT ?? 6081);
  const app = buildSignerService({ signer: LocalKeypairSigner.fromEnv(keypair), token, logger: true });
  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  await app.listen({ host, port });
}
