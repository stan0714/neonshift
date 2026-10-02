/**
 * 打卡交易送出與冪等（PG-A-10，SD 5.3）。
 * 送出前以 (wallet, task_date, task_type) 推導 ClaimReceipt PDA，並保存 signature／blockhash／lastValidBlockHeight。
 * RPC 逾時後先查 receipt 與原簽章；receipt 存在即成功。只有原交易確定失敗，或已超過 lastValidBlockHeight
 * 且 receipt 不存在時，才可取得新 attestation／blockhash 重建；不盲目重送同一 signed transaction。
 */
import { PublicKey, type Connection, type TransactionInstruction } from '@solana/web3.js';
import * as SecureStore from 'expo-secure-store';

import { walletService } from '@/services/wallet/WalletService';

import { assertCanPayFee, buildTransaction, getConnection, rpcRead } from './ChainClient';

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
    private readonly send: (tx: Parameters<typeof walletService.signAndSendTransaction>[0], opts?: { minContextSlot?: number }) => Promise<string> = (tx, opts) => walletService.signAndSendTransaction(tx, opts),
  ) {}

  /**
   * receipt 是否已存在——**這是「這筆到底有沒有上鏈」的判準**，不只是一個查詢。
   *
   * 三個呼叫點裡有兩個在 `resolvePending` 的逾時分支，而這個讀取一旦丟例外，
   * 整個判定就會以例外收場：pending 紀錄還在（不會遺失），但使用者看到的是錯誤而不是結論，
   * 明明只要 400 ms 後重試一次就會有答案。所以這裡走 `rpcRead` 的退避（只對限流／逾時／
   * 5xx／連不上重試，「帳號不存在」不重試）。讀取重試沒有冪等問題；**送出交易仍然不重試**。
   *
   * 同一分支後面的 `getSignatureStatus`／`getBlockHeight` 刻意保留 `.catch(() => null)`：
   * 它們失敗時會落到「仍在有效期內、保留 pending、稍後再查」，那是安全的結論。
   */
  async receiptExists(receipt: PublicKey): Promise<boolean> {
    return (await rpcRead('getAccountInfo(receipt)', (c) => c.getAccountInfo(receipt, 'confirmed'), () => this.conn())) !== null;
  }

  /** 送出並確認；逾時交給 `resolvePending` 判定 */
  async submit(player: PublicKey, instructions: TransactionInstruction[], receipt: PublicKey, task: { taskDate: number; taskType: number }): Promise<SubmitOutcome> {
    if (await this.receiptExists(receipt)) return { kind: 'already_claimed' };
    // 付不出網路費就在開錢包前停下（丟 InsufficientSolError，ClaimFlow 以 code INSUFFICIENT_SOL 收尾）
    await assertCanPayFee(player, undefined, () => this.conn());
    const { tx, blockhash, lastValidBlockHeight, minContextSlot } = await buildTransaction(player, instructions);
    const signature = await this.send(tx, { minContextSlot });
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
