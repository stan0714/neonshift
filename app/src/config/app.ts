/**
 * 不含祕密的 build-time 常數（SD 8）。
 * 鏈上與後端參數由 `EXPO_PUBLIC_*` 在建置時注入（scripts/app/build.sh <env> 讀 deploy/<env>.env），
 * 必須成組存在；缺一即視為「未設定」，UI 走降級路徑而不是混搭。
 */
const env = {
  cluster: process.env.EXPO_PUBLIC_CLUSTER ?? 'devnet',
  clusterId: Number(process.env.EXPO_PUBLIC_CLUSTER_ID ?? '1'),
  rpcUrl: process.env.EXPO_PUBLIC_RPC_URL ?? 'https://api.devnet.solana.com',
  programId: process.env.EXPO_PUBLIC_PROGRAM_ID ?? '',
  apiUrl: process.env.EXPO_PUBLIC_API_URL ?? '',
  tskrMint: process.env.EXPO_PUBLIC_TSKR_MINT ?? '',
  /** SKR-01：官方 SKR 付款用主網 RPC（只讀餘額／blockhash／送交易），與 devnet 程式 RPC 分開；後端目錄決定實際網路 */
  skrMainnetRpcUrl: process.env.EXPO_PUBLIC_SKR_MAINNET_RPC_URL ?? 'https://api.mainnet-beta.solana.com',
};

/** 官方 SKR mint（solanamobile.com/skr）；主網目錄的 mint 必須等於此值，否則 App 拒絕付款（SKR-01 雙重核對） */
export const OFFICIAL_SKR_MINT = 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3';

export const APP_CONFIG = {
  ...env,
  tokenSymbol: 'tSKR',
  /** 正式網域（SD 8）；MWA identity uri 與 SIWS domain 由此推導 */
  siteUrl: 'https://neonshift.cc',
  siwsDomain: 'neonshift.cc',
  /** Solana dApp Store 詳細頁（強制更新時導向） */
  storeUrl: 'solanadappstore://details?id=cc.neonshift.app',
  disclaimer: 'Runs on Solana devnet · Rewards use tSKR test tokens with no monetary value.',
  /** 鏈上參數是否成組設定（program id 必填） */
  chainConfigured: env.programId.length > 0,
  backendConfigured: env.apiUrl.length > 0,
} as const;
