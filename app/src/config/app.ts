/** 不含祕密的 build-time 常數；環境切換（dev／demo）由 PG-I-07 接管。 */
export const APP_CONFIG = {
  cluster: 'devnet',
  tokenSymbol: 'tSKR',
  /** Solana dApp Store 詳細頁（強制更新時導向） */
  storeUrl: 'solanadappstore://details?id=xyz.neonshift.app',
  disclaimer: 'Runs on Solana devnet · Rewards use tSKR test tokens with no monetary value.',
} as const;
