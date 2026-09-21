/**
 * SKR 付款鏈上查詢（SKR-01／04）：只讀，獨立於 devnet 程式的 RPC；不持有任何私鑰、不送交易。
 * 介面抽象化以便測試以假鏈注入；正式用 @solana/web3.js Connection。
 */
import { Connection, PublicKey, type Finality, type ParsedTransactionWithMeta } from "@solana/web3.js";

export type MintInfo = { owner: string; decimals: number };
export type TokenBalanceDelta = { account: string; owner: string | null; mint: string; pre: bigint; post: bigint };
export type PaymentTx = { signature: string; slot: bigint; blockTime: Date | null; err: unknown | null; accountKeys: string[]; deltas: TokenBalanceDelta[] };

export interface SkrChain {
  getMint(mint: string): Promise<MintInfo | null>;
  accountExists(address: string): Promise<boolean>;
  getTransaction(signature: string): Promise<PaymentTx | null>;
  /** 以 reference 帳戶反查（App 遺失 signature 時的復原路徑）；新到舊 */
  getSignaturesForAddress(address: string, limit: number): Promise<string[]>;
}

export const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const ASSOCIATED_TOKEN_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

/** 關聯代幣帳戶（ATA）：PDA(owner, TOKEN_PROGRAM, mint) under ASSOCIATED_TOKEN_PROGRAM */
export function associatedTokenAddress(owner: string, mint: string): string {
  const [pda] = PublicKey.findProgramAddressSync([new PublicKey(owner).toBytes(), new PublicKey(TOKEN_PROGRAM_ID).toBytes(), new PublicKey(mint).toBytes()], new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID));
  return pda.toBase58();
}

export function toPaymentTx(signature: string, tx: ParsedTransactionWithMeta): PaymentTx {
  const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey.toBase58());
  const pre = tx.meta?.preTokenBalances ?? [];
  const post = tx.meta?.postTokenBalances ?? [];
  const byIndex = new Map<number, TokenBalanceDelta>();
  for (const b of pre) byIndex.set(b.accountIndex, { account: keys[b.accountIndex] ?? "", owner: b.owner ?? null, mint: b.mint, pre: BigInt(b.uiTokenAmount.amount), post: 0n });
  for (const b of post) {
    const cur = byIndex.get(b.accountIndex);
    if (cur) { cur.post = BigInt(b.uiTokenAmount.amount); cur.owner ??= b.owner ?? null; }
    else byIndex.set(b.accountIndex, { account: keys[b.accountIndex] ?? "", owner: b.owner ?? null, mint: b.mint, pre: 0n, post: BigInt(b.uiTokenAmount.amount) });
  }
  return { signature, slot: BigInt(tx.slot), blockTime: tx.blockTime ? new Date(tx.blockTime * 1000) : null, err: tx.meta?.err ?? null, accountKeys: keys, deltas: [...byIndex.values()] };
}

export class RpcSkrChain implements SkrChain {
  private readonly conn: Connection;
  constructor(rpcUrl: string, private readonly commitment: Finality) { this.conn = new Connection(rpcUrl, commitment); }
  async getMint(mint: string) {
    const info = await this.conn.getParsedAccountInfo(new PublicKey(mint), this.commitment);
    const v = info.value; if (!v) return null;
    const data = v.data as { parsed?: { type?: string; info?: { decimals?: number } } };
    if (!("parsed" in data) || data.parsed?.type !== "mint" || typeof data.parsed.info?.decimals !== "number") return null;
    return { owner: v.owner.toBase58(), decimals: data.parsed.info.decimals };
  }
  async accountExists(address: string) { return (await this.conn.getAccountInfo(new PublicKey(address), this.commitment)) !== null; }
  async getTransaction(signature: string) {
    const tx = await this.conn.getParsedTransaction(signature, { commitment: this.commitment, maxSupportedTransactionVersion: 0 });
    return tx ? toPaymentTx(signature, tx) : null;
  }
  async getSignaturesForAddress(address: string, limit: number) {
    const list = await this.conn.getSignaturesForAddress(new PublicKey(address), { limit }, this.commitment);
    return list.map((x) => x.signature);
  }
}

export const defaultRpcUrl = (network: "mainnet-beta" | "devnet") => (network === "mainnet-beta" ? "https://api.mainnet-beta.solana.com" : "https://api.devnet.solana.com");
