/**
 * ChainClient（PG-A-10 起步）：送交易、確認、查帳戶。不負責 UI 狀態。
 * 冪等原則（SD 5.3）：送出前保存 signature／blockhash／lastValidBlockHeight；逾時先查目標帳戶，不盲目重送。
 */
import { Connection, PublicKey, Transaction, type AccountInfo, type TransactionInstruction } from '@solana/web3.js';
import { Buffer } from 'buffer';

import { APP_CONFIG } from '@/config/app';
import { walletService } from '@/services/wallet/WalletService';

/**
 * 單一 RPC 請求的上限。**沒有這個上限，退避重試沒有意義**——
 * 2026-09-27 實測公用 devnet 端點對 `getAccountInfo` 是「不回應」而不是回錯誤：
 * getHealth／getSlot／getBalance 都在 0.3 秒內回，同一個帳號的 getAccountInfo 30 秒沒有任何回覆，
 * 手機端的 gateway 最後把它變成 504。沒有逾時的話一次卡住就是卡到平台預設值。
 */
export const RPC_READ_TIMEOUT_MS = 15_000;
/** 退避間隔（毫秒）。只用於讀取；交易送出不重試（SD 5.3 冪等原則） */
export const RPC_RETRY_DELAYS_MS = [400, 1_200] as const;

export type RpcFailureReason = 'rate_limited' | 'timeout' | 'server' | 'unreachable' | 'not_configured' | 'unknown';
export type RpcFailure = {
  reason: RpcFailureReason;
  /** 哪一個呼叫（getMultipleAccounts…）；給使用者看的 Ref，不是給他讀的錯誤內容 */
  label: string;
  /** HTTP 狀態（若判得出來） */
  status: number | null;
  /** 原始訊息：只留給診斷與 log，**不進使用者文案** */
  detail: string;
};

export class RpcReadError extends Error {
  constructor(readonly failure: RpcFailure) {
    super(`${failure.label}: ${failure.reason}`);
    this.name = 'RpcReadError';
  }
}

/** 短技術摘要（InlineState 的 Ref）：例如 `504 · getMultipleAccounts`。不含帳號位址與 payload */
export const rpcFailureRef = (f: RpcFailure) => `${f.status ?? f.reason} · ${f.label}`;

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * 判斷是不是「等一下再試就可能成功」的失敗。
 * web3.js 把 HTTP 錯誤包成 `failed to get info about account <pubkey>: Error: 504 : {…}`，
 * 所以狀態碼要從 `Error: <ddd> :` 這個固定格式取，不能對整段訊息抓三位數（base58 位址裡也有數字）。
 */
export function classifyRpcError(label: string, e: unknown): RpcFailure {
  const detail = messageOf(e);
  const status = Number(/Error:\s*(\d{3})\s*:/.exec(detail)?.[1] ?? /\bstatus(?:\s*code)?[:=]\s*(\d{3})\b/i.exec(detail)?.[1]) || null;
  const aborted = (e as { name?: string })?.name === 'AbortError' || /\baborted\b|timed? ?out/i.test(detail);
  if (status === 429 || /too many requests|rate limit|-32005/i.test(detail)) return { reason: 'rate_limited', label, status, detail };
  if (aborted) return { reason: 'timeout', label, status, detail };
  if (status !== null && status >= 500) return { reason: 'server', label, status, detail };
  if (/network request failed|failed to fetch|ENOTFOUND|ECONNREFUSED|ECONNRESET|socket hang up/i.test(detail)) return { reason: 'unreachable', label, status, detail };
  return { reason: 'unknown', label, status, detail };
}

/** `unknown` 不重試：那多半是「帳號不存在」「參數錯」這種再試幾次也一樣的結果 */
const retryable = (r: RpcFailureReason) => r === 'rate_limited' || r === 'timeout' || r === 'server' || r === 'unreachable';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 讀取用的退避重試。**只包讀，不包送交易**——重送交易要走 claimSubmitter 的 pending 流程，
 * 不能靠這裡重試（SD 5.3：逾時先查目標帳戶，不盲目重送）。
 */
export async function rpcRead<T>(label: string, run: (conn: Connection) => Promise<T>): Promise<T> {
  let last: RpcFailure | null = null;
  for (let attempt = 0; attempt <= RPC_RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await run(getConnection());
    } catch (e) {
      last = classifyRpcError(label, e);
      if (!retryable(last.reason) || attempt === RPC_RETRY_DELAYS_MS.length) break;
      // 固定間隔加上一點抖動：多台裝置同時重試不要撞在一起
      await sleep(RPC_RETRY_DELAYS_MS[attempt]! + Math.floor(Math.random() * 200));
    }
  }
  throw new RpcReadError(last ?? { reason: 'unknown', label, status: null, detail: 'unknown' });
}

/** 每個 HTTP 請求都有上限；逾時以 AbortError 收場，交給 classifyRpcError 判成可重試 */
const timeoutFetch: typeof fetch = async (input, init) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RPC_READ_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
};

let connection: Connection | null = null;
export function getConnection(): Connection {
  connection ??= new Connection(APP_CONFIG.rpcUrl, { commitment: 'confirmed', fetch: timeoutFetch });
  return connection;
}

/**
 * 一次讀多個帳戶。**這是取代「每個帳戶各打一次 getAccountInfo」的重點**：
 * 首頁一次同步原本要 6～7 個 RPC 呼叫，對限流的公用端點來說那是最快被擋的打法。
 * 不存在的帳戶回 null（與 getAccountInfo 一致），不算錯誤。
 */
export async function fetchAccountsInfo(addresses: PublicKey[]): Promise<(AccountInfo<Buffer> | null)[]> {
  if (addresses.length === 0) return [];
  return rpcRead('getMultipleAccounts', (c) => c.getMultipleAccountsInfo(addresses, 'confirmed'));
}

export type SentTx = { signature: string; blockhash: string; lastValidBlockHeight: number };

export async function buildTransaction(feePayer: PublicKey, instructions: TransactionInstruction[]): Promise<{ tx: Transaction; blockhash: string; lastValidBlockHeight: number; minContextSlot: number }> {
  const { context, value: { blockhash, lastValidBlockHeight } } = await getConnection().getLatestBlockhashAndContext('confirmed');
  const tx = new Transaction({ feePayer, blockhash, lastValidBlockHeight });
  tx.add(...instructions);
  return { tx, blockhash, lastValidBlockHeight, minContextSlot: context.slot };
}

/** 預估費用：簽章費 + 帳戶 rent（若有新帳戶） */
export async function estimateFeeLamports(feePayer: PublicKey, instructions: TransactionInstruction[], newAccountSpace = 0): Promise<number> {
  const { tx } = await buildTransaction(feePayer, instructions);
  const fee = (await getConnection().getFeeForMessage(tx.compileMessage(), 'confirmed')).value ?? 5_000;
  const rent = newAccountSpace > 0 ? await getConnection().getMinimumBalanceForRentExemption(newAccountSpace) : 0;
  return fee + rent;
}

/** 由錢包簽章送出並等待 confirmed；回傳可供冪等查詢的資訊 */
export async function sendWithWallet(feePayer: PublicKey, instructions: TransactionInstruction[], onPhase?: (phase: 'wallet' | 'confirming') => void): Promise<SentTx> {
  const { tx, blockhash, lastValidBlockHeight, minContextSlot } = await buildTransaction(feePayer, instructions);
  onPhase?.('wallet');
  const signature = await walletService.signAndSendTransaction(tx, { minContextSlot });
  onPhase?.('confirming');
  const result = await getConnection().confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
  if (result.value.err) throw new Error(`Transaction failed: ${JSON.stringify(result.value.err)}`);
  return { signature, blockhash, lastValidBlockHeight };
}

export async function accountExists(address: PublicKey): Promise<boolean> {
  const info = await rpcRead('getAccountInfo', (c) => c.getAccountInfo(address, 'confirmed'));
  return info !== null;
}
