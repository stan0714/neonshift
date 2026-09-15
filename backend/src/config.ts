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
  /** ops 端點（結算 manifest）的 Bearer token；未設定時端點回 404 */
  OPS_TOKEN: z.string().min(16).optional(),
  /** 保留清理（PG-B-17）：與 API 同 process 週期執行；也可用 `npm run retention:once` 交給外部排程 */
  RETENTION_ENABLED: z.coerce.boolean().default(false),
  RETENTION_INTERVAL_MS: z.coerce.number().int().min(60_000).default(60 * 60 * 1000),
  /** 活動個人層資料保留天數（PG-E-09；BRD Q-13／DEC-06 定案前預設 180；活動結束或取消後起算） */
  EVENT_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(180),
  /** PG-U-04 探索冊：GPS 來源活動需 ≥ 此 GPS 規則版本才計入任務（R-10 品質驗收定案後設定；未設定＝GPS 活動不計入，Health Connect 匯入不受影響） */
  QUEST_GPS_MIN_RULES_VERSION: z.coerce.number().int().min(1).optional(),
  /** ChainIndexer（PG-B-16）：與 API 同 process 週期同步；正式環境建議單一 replica 開啟 */
  INDEXER_ENABLED: z.coerce.boolean().default(false),
  INDEXER_INTERVAL_MS: z.coerce.number().int().min(1_000).default(10_000),
  IDL_FILE: z.string().default("idl/neonshift_core.json"),
  /** 只讀 RPC（賽事狀態、報名查詢；PG-B-14）；未設 PROGRAM_ID 時不建立連線 */
  RPC_URL: z.string().url().default("https://api.devnet.solana.com"),
  /** SIWS domain／URI 與 JWT iss／aud（SD 4.2、SD 8 網域表） */
  SIWS_DOMAIN: z.string().default("neonshift.cc"),
  SIWS_URI: z.string().url().default("https://neonshift.cc"),
  /** access JWT HS256 密鑰；正式環境必填且 ≥ 32 bytes，local／test 未給時以隨機值啟動（重啟即失效） */
  JWT_SECRET: z.string().min(32).optional(),
  /** 規則集檔案（PG-B-07） */
  RULES_FILE: z.string().default("rules/v3.json"),
  /** attestor signer：`http:<url>`（隔離 signer service，配 SIGNER_TOKEN）或 dev 用 `local:<keypair 路徑|base58>` */
  ATTESTOR_SIGNER: z.string().optional(),
  SIGNER_TOKEN: z.string().optional(),
  /** 速率限制（PG-B-18）：每錢包（已登入）與每 IP 的每分鐘上限 */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60),
  /** 敏感端點（nonce／verify／claim）每分鐘上限 */
  RATE_LIMIT_SENSITIVE_PER_MINUTE: z.coerce.number().int().positive().default(10),
  ALERT_WEBHOOK_URL: z.string().url().optional(),
  /** /metrics 保護 token；未設定時 /metrics 只在 local 開放 */
  METRICS_TOKEN: z.string().optional(),
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
  if (cfg.APP_ENV !== "local" && !cfg.JWT_SECRET) {
    throw new Error(`APP_ENV=${cfg.APP_ENV} 需要設定 JWT_SECRET`);
  }
  // 正式環境私鑰不得進 API process（SD 4.6）：只允許 http／kms signer
  if (cfg.APP_ENV !== "local" && (!cfg.ATTESTOR_SIGNER || cfg.ATTESTOR_SIGNER.startsWith("local:"))) {
    throw new Error(`APP_ENV=${cfg.APP_ENV} 需要 ATTESTOR_SIGNER=http:<url>（不可用 local:）`);
  }
  if (cfg.ATTESTOR_SIGNER?.startsWith("http:") && !cfg.SIGNER_TOKEN) {
    throw new Error("ATTESTOR_SIGNER=http: 需要 SIGNER_TOKEN");
  }
  return cfg;
}
