/** IndexerRpc 的 web3.js 實作（B-16）。只讀；所有查詢用 confirmed／finalized，不用 processed。 */
import { Connection, PublicKey } from "@solana/web3.js";

import type { IndexerRpc, SignatureInfo, TxInfo } from "./indexer.js";

export class Web3IndexerRpc implements IndexerRpc {
  private readonly conn: Connection;
  constructor(rpcUrl: string) {
    this.conn = new Connection(rpcUrl, "confirmed");
  }
  async getSignaturesForAddress(address: string, opts: { until?: string | undefined; before?: string | undefined; limit: number }): Promise<SignatureInfo[]> {
    const rows = await this.conn.getSignaturesForAddress(new PublicKey(address), { ...(opts.until ? { until: opts.until } : {}), ...(opts.before ? { before: opts.before } : {}), limit: opts.limit }, "confirmed");
    return rows.map((r) => ({ signature: r.signature, slot: r.slot, err: r.err, blockTime: r.blockTime ?? null }));
  }
  async getTransaction(signature: string): Promise<TxInfo> {
    const tx = await this.conn.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!tx) return null;
    return { slot: tx.slot, blockhash: tx.transaction.message.recentBlockhash, logs: tx.meta?.logMessages ?? [], err: tx.meta?.err ?? null };
  }
  async getSignatureStatuses(signatures: string[]) {
    const r = await this.conn.getSignatureStatuses(signatures, { searchTransactionHistory: true });
    return r.value.map((s) => (s ? (s.confirmationStatus ?? null) : null));
  }
  getSlot() {
    return this.conn.getSlot("confirmed");
  }
}
