/**
 * SKR-03／05／06 App 端：官方 SKR 外觀付款流程（docs/store/competition-development-plan.md §1 P1、§5）。
 * 主線：目錄（伺服器決定資格／價格／收款）→ 建單 → 餘額預檢 → 主網 MWA 簽送 → 伺服器查驗 → 權限；
 * 遺失回覆／關 App 重開 → 以本機 pending 訂單 id 向伺服器 recover，不重扣、不要求再付。
 * 網路隔離：付款只走目錄指定的網路（主網或標示 TEST 的 devnet），不觸碰 devnet 任務金庫；主網 mint 必須等於官方常數。
 */
import { Connection, PublicKey, Transaction } from '@solana/web3.js';

import { APP_CONFIG, OFFICIAL_SKR_MINT } from '@/config/app';
import { ApiError, apiClient, type SkrCatalog, type SkrNetwork, type SkrOrderView } from '@/services/api/ApiClient';
import { WalletError, walletService } from '@/services/wallet/WalletService';
import { paymentInstructions, associatedTokenAddress } from '@/services/skr/spl';

export type SkrPayPhase = 'creating_order' | 'checking_balance' | 'opening_wallet' | 'sending' | 'confirming' | 'done';
export type SkrPayErrorCode = 'INSUFFICIENT_SKR' | 'INSUFFICIENT_SOL' | 'MINT_MISMATCH' | 'REJECTED' | 'WALLET_NO_REPLY' | 'NOT_ELIGIBLE' | 'ALREADY_OWNED' | 'ORDER_EXPIRED' | 'NETWORK_ERROR' | 'SESSION_EXPIRED' | 'DISABLED' | 'RESULT_UNKNOWN' | 'UNKNOWN';
export class SkrPayError extends Error {
  /** 已送出但還沒確認完成的 signature——不能因為 confirm 的網路錯誤就把它弄丟（R1） */
  signature?: string;
  constructor(public readonly code: SkrPayErrorCode, message: string, public readonly order?: SkrOrderView, public readonly cause?: unknown) { super(message); this.name = 'SkrPayError'; }
}
/**
 * R1：開錢包**之前**就記下的付款嘗試。它存在代表「錢包已經拿到一筆可廣播的交易」——
 * 不論 App 有沒有收到回覆，鏈上都可能已經扣款。所以它一旦存在，就只准查、不准再付。
 */
export type SkrPaymentAttempt = { orderId: string; network: SkrNetwork; blockhash: string; lastValidBlockHeight: number; at: number; signature: string | null };

export type SkrPayOutcome = { kind: 'fulfilled'; order: SkrOrderView; signature: string } | { kind: 'confirming'; order: SkrOrderView; signature: string } | { kind: 'needs_review'; order: SkrOrderView; signature: string };

/** 主網固定 'solana:mainnet'（MWA chain id）；devnet 試跑走 'solana:devnet' */
export const mwaChainFor = (network: SkrNetwork): `solana:${string}` => (network === 'mainnet-beta' ? 'solana:mainnet' : 'solana:devnet');
export const rpcUrlFor = (network: SkrNetwork): string => (network === 'mainnet-beta' ? APP_CONFIG.skrMainnetRpcUrl : APP_CONFIG.rpcUrl);

const connections = new Map<string, Connection>();
export function skrConnection(network: SkrNetwork): Connection {
  const url = rpcUrlFor(network);
  let c = connections.get(url);
  if (!c) { c = new Connection(url, 'confirmed'); connections.set(url, c); }
  return c;
}

/** 目錄核對（SKR-01）：主網 mint 必須是官方；decimals 由伺服器自鏈上核對後給定 */
export function assertCatalogTrusted(cat: Extract<SkrCatalog, { enabled: true }>) {
  if (cat.network === 'mainnet-beta' && cat.mint !== OFFICIAL_SKR_MINT) throw new SkrPayError('MINT_MISMATCH', `catalog mint ${cat.mint} is not the official SKR mint`);
  if (cat.network === 'devnet' && cat.mint === OFFICIAL_SKR_MINT) throw new SkrPayError('MINT_MISMATCH', 'devnet catalog must not use the official mint');
}
export function assertOrderTrusted(order: SkrOrderView) {
  if (order.network === 'mainnet-beta' && order.mint !== OFFICIAL_SKR_MINT) throw new SkrPayError('MINT_MISMATCH', 'order mint is not the official SKR mint', order);
  const ata = associatedTokenAddress(new PublicKey(order.recipient), new PublicKey(order.mint)).toBase58();
  if (ata !== order.recipient_token_account) throw new SkrPayError('MINT_MISMATCH', 'order recipient token account mismatch', order);
}

export type Balances = { skr: bigint; sol: number; payerAtaExists: boolean; recipientAtaExists: boolean };
export async function readBalances(network: SkrNetwork, wallet: PublicKey, order: SkrOrderView): Promise<Balances> {
  const conn = skrConnection(network);
  const mint = new PublicKey(order.mint);
  const payerAta = associatedTokenAddress(wallet, mint);
  const [sol, payerAtaInfo, recipientAtaInfo] = await Promise.all([conn.getBalance(wallet, 'confirmed'), conn.getAccountInfo(payerAta, 'confirmed'), conn.getAccountInfo(new PublicKey(order.recipient_token_account), 'confirmed')]);
  let skr = 0n;
  if (payerAtaInfo) {
    const bal = await conn.getTokenAccountBalance(payerAta, 'confirmed');
    skr = BigInt(bal.value.amount);
  }
  return { skr, sol, payerAtaExists: payerAtaInfo !== null, recipientAtaExists: recipientAtaInfo !== null };
}

/** 保守的 SOL 需求：手續費 ~5,000 lamports；收款 ATA 不存在時再加租金 ~2,039,280 lamports */
export const ATA_RENT_LAMPORTS = 2_039_280;
export const FEE_LAMPORTS = 5_000;
export const solNeeded = (b: Balances) => FEE_LAMPORTS + (b.recipientAtaExists ? 0 : ATA_RENT_LAMPORTS);

function mapApiError(e: unknown, order?: SkrOrderView): SkrPayError {
  if (e instanceof SkrPayError) return e;
  if (e instanceof ApiError) {
    if (e.code === 'NOT_ELIGIBLE') return new SkrPayError('NOT_ELIGIBLE', e.message, order, e);
    if (e.code === 'ALREADY_OWNED') return new SkrPayError('ALREADY_OWNED', e.message, order, e);
    if (e.code === 'SKR_DISABLED') return new SkrPayError('DISABLED', e.message, order, e);
    if (e.code === 'NETWORK_ERROR') return new SkrPayError('NETWORK_ERROR', e.message, order, e);
    if (e.code === 'NO_SESSION') return new SkrPayError('SESSION_EXPIRED', e.message, order, e);
    return new SkrPayError('UNKNOWN', `${e.code}: ${e.message}`, order, e);
  }
  if (e instanceof WalletError) {
    if (e.code === 'REJECTED') return new SkrPayError('REJECTED', e.message, order, e);
    if (e.code === 'WALLET_NO_REPLY') return new SkrPayError('WALLET_NO_REPLY', e.message, order, e);
    if (e.code === 'SESSION_EXPIRED') return new SkrPayError('SESSION_EXPIRED', e.message, order, e);
    if (e.code === 'NETWORK_ERROR') return new SkrPayError('NETWORK_ERROR', e.message, order, e);
  }
  return new SkrPayError('UNKNOWN', e instanceof Error ? e.message : String(e), order, e);
}

export type SkrDeps = {
  connection?: (network: SkrNetwork) => Connection;
  balances?: typeof readBalances;
  sendTx?: (chain: `solana:${string}`, tx: Transaction, opts: { minContextSlot: number }) => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
  /** 開錢包前持久化付款嘗試（R1）。這個 await 失敗就不該開錢包——沒記下來就等於沒有保護 */
  onAttempt?: (attempt: SkrPaymentAttempt) => Promise<void> | void;
  /** 錢包一回傳 signature 就先存，之後 confirm 再怎麼失敗都不會弄丟它（R1） */
  onSignature?: (orderId: string, signature: string) => Promise<void> | void;
};

/**
 * 原交易是否還可能落地。Solana 只在 blockhash 有效期內接受交易，超過 lastValidBlockHeight
 * 之後它永遠不會上鏈——這是唯一能**證明**「沒付成功」的條件。
 * 「查不到交易」不算證明：RPC 可能只是還沒看到。查不到區塊高度時回 true（擋住付款），
 * 因為這裡寧可讓使用者多等一會，也不要冒重複扣款的風險。
 */
export async function attemptCanStillLand(attempt: SkrPaymentAttempt, deps: SkrDeps = {}): Promise<boolean> {
  try {
    const height = await (deps.connection ?? skrConnection)(attempt.network).getBlockHeight('confirmed');
    return height <= attempt.lastValidBlockHeight;
  } catch {
    return true;
  }
}

export const skrService = {
  catalog(): Promise<SkrCatalog> { return apiClient.skrCatalog(); },

  /**
   * 購買：建單（冪等）→ 餘額預檢 → 組交易 → 主網 MWA 簽送 → 伺服器確認（最多輪詢 CONFIRM_ATTEMPTS 次）。
   * 送出後任何失敗都不重送交易；signature 立刻交給伺服器記錄（confirming），之後可 recover。
   */
  async purchase(wallet: PublicKey, sku: string, onPhase: (p: SkrPayPhase) => void = () => {}, deps: SkrDeps = {}, attempt: SkrPaymentAttempt | null = null): Promise<SkrPayOutcome> {
    onPhase('creating_order');
    let order: SkrOrderView;
    try { order = (await apiClient.skrCreateOrder(sku)).order; } catch (e) { throw mapApiError(e); }
    if (order.status === 'confirming' && order.signature) return this.confirmUntil(order, order.signature, onPhase, deps); // 上次送出後遺失回覆：先查，不重付
    if (order.status !== 'awaiting_payment') throw new SkrPayError(order.status === 'expired' ? 'ORDER_EXPIRED' : 'UNKNOWN', `order is ${order.status}`, order);
    // R1：伺服器說 awaiting_payment 不等於沒付過。錢包廣播成功但回覆遺失時，伺服器根本
    // 不知道有這筆交易——訂單就會停在 awaiting_payment。本機的 attempt 是唯一知情的一方。
    if (attempt && attempt.orderId === order.order_id) {
      const settled = await this.settleAttempt(order, attempt, onPhase, deps);
      if (settled) return settled;
    }
    if (Date.parse(order.expires_at) <= Date.now()) throw new SkrPayError('ORDER_EXPIRED', 'order expired', order);
    assertOrderTrusted(order);
    onPhase('checking_balance');
    const b = await (deps.balances ?? readBalances)(order.network, wallet, order);
    const amount = BigInt(order.amount_base_units);
    if (b.skr < amount) throw new SkrPayError('INSUFFICIENT_SKR', `need ${order.amount_display} SKR`, order);
    if (b.sol < solNeeded(b)) throw new SkrPayError('INSUFFICIENT_SOL', `need ${solNeeded(b)} lamports for fees`, order);
    const conn = (deps.connection ?? skrConnection)(order.network);
    const { context, value: { blockhash, lastValidBlockHeight } } = await conn.getLatestBlockhashAndContext('confirmed');
    const tx = new Transaction({ feePayer: wallet, blockhash, lastValidBlockHeight });
    tx.add(...paymentInstructions({ payer: wallet, mint: new PublicKey(order.mint), recipient: new PublicKey(order.recipient), recipientTokenAccount: new PublicKey(order.recipient_token_account), amount, decimals: order.decimals, reference: new PublicKey(order.reference) }));
    // 先記下嘗試，再開錢包。順序不能反：一旦錢包開了就可能廣播，而沒記下來的廣播
    // 就是 R1 的缺口本身。這裡的 await 失敗會直接讓購買失敗，不會帶著沒有保護的狀態往下走。
    await deps.onAttempt?.({ orderId: order.order_id, network: order.network, blockhash, lastValidBlockHeight, at: Date.now(), signature: null });
    onPhase('opening_wallet');
    let signature: string;
    try {
      signature = await (deps.sendTx ?? ((c, t, o) => walletService.signAndSendTransactionOn(c, t, o)))(mwaChainFor(order.network), tx, { minContextSlot: context.slot });
    } catch (e) {
      throw mapApiError(e, order);
    }
    await deps.onSignature?.(order.order_id, signature); // confirm 還沒開始就先存起來
    onPhase('sending');
    return this.confirmUntil(order, signature, onPhase, deps);
  },

  /**
   * R1：本機有未結清的付款嘗試時走這裡。三種結局——
   * - 回 outcome：已經查到結果（成功／需人工／確認中），一律不再付。
   * - 回 null：**已證明**那筆交易不可能落地，可以安全再付一次。
   * - throw RESULT_UNKNOWN：結果不明，連錢包都不開。
   *
   * 「證明」的門檻刻意訂得高：先查一次，再等到 blockhash 有效期失效，**再查一次**。
   * 只有 recover 查不到而且原交易已不可能上鏈，才算證明。單靠 recover 查無交易是不夠的，
   * 因為 RPC 可能只是還沒看到，而那正好是這個 bug 最容易發生的時間窗。
   */
  async settleAttempt(order: SkrOrderView, attempt: SkrPaymentAttempt, onPhase: (p: SkrPayPhase) => void, deps: SkrDeps = {}): Promise<SkrPayOutcome | null> {
    onPhase('confirming');
    const first = await this.recoverOutcome(order, attempt);
    if (first) return first;
    if (await attemptCanStillLand(attempt, deps)) throw new SkrPayError('RESULT_UNKNOWN', 'an earlier payment attempt for this order may still land onchain', order);
    const second = await this.recoverOutcome(order, attempt);
    if (second) return second;
    return null;
  },

  /** recover 一次並翻譯成 outcome；仍是 awaiting_payment（伺服器查無付款）→ null */
  async recoverOutcome(order: SkrOrderView, attempt: SkrPaymentAttempt): Promise<SkrPayOutcome | null> {
    const r = await this.recover(order.order_id);
    const o = r.order;
    const sig = o.signature ?? attempt.signature ?? '';
    if (o.status === 'fulfilled') return { kind: 'fulfilled', order: o, signature: sig };
    if (o.status === 'needs_review') return { kind: 'needs_review', order: o, signature: sig };
    if (o.status === 'confirming' && sig) return { kind: 'confirming', order: o, signature: sig };
    return null;
  },

  /** 向伺服器確認；RPC 尚未看到 → 退避重試；仍未見 → 回 confirming（保留給 recover），不視為失敗、不重付 */
  async confirmUntil(order: SkrOrderView, signature: string, onPhase: (p: SkrPayPhase) => void, deps: SkrDeps = {}): Promise<SkrPayOutcome> {
    onPhase('confirming');
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    let last: SkrOrderView = order;
    for (let i = 0; i < CONFIRM_ATTEMPTS; i++) {
      let r: { order: SkrOrderView; found: boolean; verify: string | null };
      try { r = await apiClient.skrConfirm(order.order_id, signature); } catch (e) { const err = mapApiError(e, last); err.signature = signature; throw err; }
      last = r.order;
      if (r.order.status === 'fulfilled') { onPhase('done'); return { kind: 'fulfilled', order: r.order, signature }; }
      if (r.order.status === 'needs_review') return { kind: 'needs_review', order: r.order, signature };
      if (r.found && r.order.status === 'awaiting_payment') throw new SkrPayError('UNKNOWN', `payment failed onchain (${r.verify ?? 'tx_failed'}); nothing was charged`, r.order);
      await sleep(CONFIRM_BACKOFF_MS[Math.min(i, CONFIRM_BACKOFF_MS.length - 1)]!);
    }
    return { kind: 'confirming', order: last, signature };
  },

  /**
   * 這筆付款嘗試是否**已經不可能成立**——「查看狀態」用來解除封鎖（R1 的出口）。
   *
   * 2026-10-01 實機找到的死結：守門同時放在 UI（停用付款鍵）與 service（settleAttempt），
   * 但 settleAttempt 只在按下付款時才跑。付款鍵停用 → 永遠跑不到 → 嘗試永遠不會清掉。
   * 卡片上寫著「原交易不可能成立後付款會重新開放」，程式卻沒有任何路徑做這件事。
   *
   * 判定條件與 settleAttempt 相同：查不到付款、原交易已過有效期、失效後再查一次仍查無。
   */
  async attemptIsDead(order: SkrOrderView, attempt: SkrPaymentAttempt, deps: SkrDeps = {}): Promise<boolean> {
    if (await this.recoverOutcome(order, attempt)) return false; // 查到結果就不是「死的」
    if (await attemptCanStillLand(attempt, deps)) return false;
    return (await this.recoverOutcome(order, attempt)) === null;
  },

  /** 重開 App／遺失回覆：伺服器以記錄的 signature 或 reference 反查 */
  async recover(orderId: string): Promise<{ order: SkrOrderView; found: boolean }> {
    try { const r = await apiClient.skrRecover(orderId); return { order: r.order, found: r.found }; } catch (e) { throw mapApiError(e); }
  },
  async cancel(orderId: string): Promise<SkrOrderView> {
    try { return (await apiClient.skrCancel(orderId)).order; } catch (e) { throw mapApiError(e); }
  },
  async orders(): Promise<SkrOrderView[]> { return (await apiClient.skrOrders()).orders; },
};

export const CONFIRM_ATTEMPTS = 6;
export const CONFIRM_BACKOFF_MS = [1500, 2500, 4000, 6000, 8000, 10000];
