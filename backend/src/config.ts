/**
 * 設定載入（SD 8）。全部來自環境變數並以 schema 驗證；程式碼與設定檔不得含私鑰字面值（BR-14／PG-B-10）。
 * API base URL、program id 與 cluster id 必須在部署時成組給定，這裡只做格式與一致性檢查。
 */
import { z } from "zod";

const base58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.enum(["local", "dev", "demo"]).default("local"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  /** 請求 body 上限（SD 4.2 API 共通要求） */
  BODY_LIMIT_BYTES: z.coerce.number().int().positive().default(64 * 1024),
  DATABASE_URL: z.string().url().optional(),
  /** canonical attestation 的環境識別：devnet = 1、localnet = 2（attestation-core） */
  CLUSTER_ID: z.coerce.number().int().min(1).max(255).default(1),
  PROGRAM_ID: z.string().regex(base58, "PROGRAM_ID 必須是 base58 公鑰").optional(),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new Error(`設定無效：${issues}`);
  }
  const cfg = parsed.data;
  // dev／demo 必須成組提供鏈上參數，避免 runtime 混搭（SD 8）
  if (cfg.APP_ENV !== "local" && (!cfg.PROGRAM_ID || !cfg.DATABASE_URL)) {
    throw new Error(`APP_ENV=${cfg.APP_ENV} 需要同時設定 PROGRAM_ID 與 DATABASE_URL`);
  }
  return cfg;
}
