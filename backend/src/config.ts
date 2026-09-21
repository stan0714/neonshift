/**
 * 設定載入（SD 8）。全部來自環境變數並以 schema 驗證；程式碼與設定檔不得含私鑰字面值（BR-14／PG-B-10）。
 * API base URL、program id 與 cluster id 必須在部署時成組給定，這裡只做格式與一致性檢查。
 */
import { z } from "zod";

const base58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** 環境變數布林：只有 true／1／yes 為真（z.coerce.boolean 會把 "false" 當真） */
const envBool = z.preprocess((v) => (typeof v === "string" ? ["true", "1", "yes"].includes(v.trim().toLowerCase()) : Boolean(v)), z.boolean());

/** 官方 SKR mint（solanamobile.com/skr；2026-09-21 於 mainnet 核對：SPL Token、6 decimals） */
export const OFFICIAL_SKR_MINT = "SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3";

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
  RULES_FILE: z.string().default("rules/v4.json"),
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
  // ---- SKR-01～05（docs/store/competition-development-plan.md §1 P1／§5）：官方 SKR 外觀付款，與 devnet tSKR 完全分開 ----
  /** 未開啟時 /me/skr/* 回 enabled=false，不建立訂單 */
  SKR_ENABLED: envBool.default(false),
  /** 付款網路；mainnet-beta 時 SKR_MINT 必須是官方 mint（下方檢查）；devnet 只供標示為 TEST 的試跑 */
  SKR_NETWORK: z.enum(["mainnet-beta", "devnet"]).default("mainnet-beta"),
  SKR_RPC_URL: z.string().url().optional(),
  SKR_MINT: z.string().regex(base58, "SKR_MINT 必須是 base58 公鑰").default(OFFICIAL_SKR_MINT),
  /** 收款錢包（owner）；實際收款帳戶為其 SKR ATA */
  SKR_RECIPIENT: z.string().regex(base58, "SKR_RECIPIENT 必須是 base58 公鑰").optional(),
  /** 首款 SKU「Genesis Mint 收藏卡邊框」價格，SKR 最小單位（6 decimals；1 SKR = 1_000_000） */
  SKR_GENESIS_FRAME_PRICE: z.coerce.number().int().positive().optional(),
  /** 訂單有效期與逾期後仍接受的寬限（鏈上 blockTime 判定；超過寬限 → needs_review，不要求再付） */
  SKR_ORDER_TTL_SEC: z.coerce.number().int().min(60).max(86_400).default(900),
  SKR_PAYMENT_GRACE_SEC: z.coerce.number().int().min(0).max(86_400).default(600),
  SKR_COMMITMENT: z.enum(["confirmed", "finalized"]).default("confirmed"),
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
  if (cfg.SKR_ENABLED) {
    if (!cfg.SKR_RECIPIENT || !cfg.SKR_GENESIS_FRAME_PRICE) throw new Error("SKR_ENABLED 需要 SKR_RECIPIENT 與 SKR_GENESIS_FRAME_PRICE");
    // SKR-01：主網只接受官方 mint，避免設定錯 mint 收到假幣；devnet 試跑必須另指定測試 mint（不得沿用官方地址假裝主網）
    if (cfg.SKR_NETWORK === "mainnet-beta" && cfg.SKR_MINT !== OFFICIAL_SKR_MINT) throw new Error(`SKR_NETWORK=mainnet-beta 的 SKR_MINT 必須是官方 ${OFFICIAL_SKR_MINT}`);
    if (cfg.SKR_NETWORK === "devnet" && cfg.SKR_MINT === OFFICIAL_SKR_MINT) throw new Error("SKR_NETWORK=devnet 需指定測試用 SKR_MINT（官方 mint 不在 devnet）");
  }
  return cfg;
}
