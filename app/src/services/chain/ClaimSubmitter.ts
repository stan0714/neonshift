/**
 * 打卡交易送出與冪等（PG-A-10，SD 5.3）。
 * 送出前以 (wallet, task_date, task_type) 推導 ClaimReceipt PDA，並保存 signature／blockhash／lastValidBlockHeight。
 * RPC 逾時後先查 receipt 與原簽章；receipt 存在即成功。只有原交易確定失敗，或已超過 lastValidBlockHeight
 * 且 receipt 不存在時，才可取得新 attestation／blockhash 重建；不盲目重送同一 signed transaction。
 */
import { PublicKey, type Connection, type TransactionInstruction } from '@solana/web3.js';
import * as SecureStore from 'expo-secure-store';

import { walletService } from '@/services/wallet/WalletService';

import { buildTransaction, getConnection } from './ChainClient';

export type PendingTx = { signature: string; blockhash: string; lastValidBlockHeight: number; receipt: string; taskDate: number; taskType: number; wallet: string };

const PENDING_KEY = 'neonshift.claim.pending.v1';

export type SubmitOutcome =
  | { kind: 'confirmed'; signature: string | null }
  | { kind: 'already_claimed' }
  | { kind: 'failed'; reason: string; retryable: true }
  | { kind: 'expired'; reason: string; needsNewAttestation: true };

async function readPending(): Promise<PendingTx | null> {
  try {
    const raw = await SecureStore.getItemAsync(PENDING_KEY);
    return raw ? (JSON.parse(raw) as PendingTx) : null;
  } catch {
    return null;
  }
}
async function writePending(p: PendingTx | null) {
  if (p) await SecureStore.setItemAsync(PENDING_KEY, JSON.stringify(p));
  else await SecureStore.deleteItemAsync(PENDING_KEY);
}

export class ClaimSubmitter {
  constructor(
    private readonly conn: () => Connection = getConnection,
    private readonly send: (tx: Parameters<typeof walletService.signAndSendTransaction>[0]) => Promise<string> = (tx) => walletService.signAndSendTransaction(tx),
  ) {}

  async receiptExists(receipt: PublicKey): Promise<boolean> {
    return (await this.conn().getAccountInfo(receipt, 'confirmed')) !== null;
  }

  /** 送出並確認；逾時交給 `resolvePending` 判定 */
  async submit(player: PublicKey, instructions: TransactionInstruction[], receipt: PublicKey, task: { taskDate: number; taskType: number }): Promise<SubmitOutcome> {
    if (await this.receiptExists(receipt)) return { kind: 'already_claimed' };
    const { tx, blockhash, lastValidBlockHeight } = await buildTransaction(player, instructions);
    const signature = await this.send(tx);
    const pending: PendingTx = { signature, blockhash, lastValidBlockHeight, receipt: receipt.toBase58(), wallet: player.toBase58(), ...task };
    await writePending(pending);
    return this.resolvePending(pending);
  }

  /** 逾時／App 重啟後的冪等判定；不重送簽章交易 */
  async resolvePending(p: PendingTx): Promise<SubmitOutcome> {
    const conn = this.conn();
    try {
      const result = await conn.confirmTransaction({ signature: p.signature, blockhash: p.blockhash, lastValidBlockHeight: p.lastValidBlockHeight }, 'confirmed');
      if (!result.value.err) {
        await writePending(null);
        return { kind: 'confirmed', signature: p.signature };
      }
      // 交易確定失敗（例如 6009 已領取）：先看 receipt
      if (await this.receiptExistsB58(p.receipt)) {
        await writePending(null);
        return { kind: 'already_claimed' };
      }
      await writePending(null);
      return { kind: 'failed', reason: JSON.stringify(result.value.err), retryable: true };
    } catch (e) {
      // 逾時或 blockhash 過期：以 receipt 為準
      if (await this.receiptExistsB58(p.receipt)) {
        await writePending(null);
        return { kind: 'confirmed', signature: null };
      }
      const status = await conn.getSignatureStatus(p.signature, { searchTransactionHistory: true }).catch(() => null);
      const s = status?.value;
      if (s && !s.err && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized')) {
        await writePending(null);
        return { kind: 'confirmed', signature: p.signature };
      }
      if (s?.err) {
        await writePending(null);
        return { kind: 'failed', reason: JSON.stringify(s.err), retryable: true };
      }
      const height = await conn.getBlockHeight('confirmed').catch(() => null);
      if (height !== null && height > p.lastValidBlockHeight) {
        await writePending(null);
        return { kind: 'expired', reason: e instanceof Error ? e.message : String(e), needsNewAttestation: true };
      }
      // 仍在有效期內且無 receipt：保留 pending，UI 稍後再查
      return { kind: 'failed', reason: 'pending confirmation; retry resolve later', retryable: true };
    }
  }

  /** App 啟動或回前景時呼叫：有懸置交易就先判定（8.4／飛航模式測試） */
  async resumePending(): Promise<SubmitOutcome | null> {
    const p = await readPending();
    return p ? this.resolvePending(p) : null;
  }

  private receiptExistsB58(b58: string): Promise<boolean> {
    return this.receiptExists(new PublicKey(b58));
  }
}

export const claimSubmitter = new ClaimSubmitter();
