/**
 * 初階跑鞋鑄造（FR-04.1）。鏈上 `mint_shoe` 由 PG-C-09 實作、交易組裝由 PG-A-09；
 * 本檔先定義 UI 需要的契約與費用預估，實際送鏈前一律回 NOT_AVAILABLE，不建立任何資產假象。
 */
export type MintQuote = {
  nftName: string;
  network: string;
  /** lamports */
  estimatedFeeLamports: number;
};

export type MintResult = { signature: string; shoeAsset: string };

export type MintErrorCode = 'NOT_AVAILABLE' | 'REJECTED' | 'NETWORK_ERROR' | 'ALREADY_MINTED' | 'FAILED';

export class MintError extends Error {
  constructor(
    public readonly code: MintErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MintError';
  }
}

export const STARTER_SHOE_NAME = 'NeonShift Starter Shoe · Lv.1';

export const shoeMintService = {
  async quote(): Promise<MintQuote> {
    // 5000 lamports 為 devnet 單簽基準費；PG-A-09 接上 getFeeForMessage 後改為即時估算
    return { nftName: STARTER_SHOE_NAME, network: 'Solana Devnet', estimatedFeeLamports: 5_000 };
  },
  async mint(): Promise<MintResult> {
    throw new MintError('NOT_AVAILABLE', 'Minting is not available in this build yet');
  },
};

export const lamportsToSol = (l: number) => (l / 1_000_000_000).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
