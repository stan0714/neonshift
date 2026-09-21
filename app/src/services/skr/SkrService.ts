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
export type SkrPayErrorCode = 'INSUFFICIENT_SKR' | 'INSUFFICIENT_SOL' | 'MINT_MISMATCH' | 'REJECTED' | 'WALLET_NO_REPLY' | 'NOT_ELIGIBLE' | 'ALREADY_OWNED' | 'ORDER_EXPIRED' | 'NETWORK_ERROR' | 'SESSION_EXPIRED' | 'DISABLED' | 'UNKNOWN';
export class SkrPayError extends Error {
  constructor(public readonly code: SkrPayErrorCode, message: string, public readonly order?: SkrOrderView, public readonly cause?: unknown) { super(message); this.name = 'SkrPayError'; }
}
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

export type SkrDeps = { connection?: (network: SkrNetwork) => Connection; balances?: typeof readBalances; sendTx?: (chain: `solana:${string}`, tx: Transaction, opts: { minContextSlot: number }) => Promise<string>; sleep?: (ms: number) => Promise<void> };

export const skrService = {
  catalog(): Promise<SkrCatalog> { return apiClient.skrCatalog(); },

  /**
   * 購買：建單（冪等）→ 餘額預檢 → 組交易 → 主網 MWA 簽送 → 伺服器確認（最多輪詢 CONFIRM_ATTEMPTS 次）。
   * 送出後任何失敗都不重送交易；signature 立刻交給伺服器記錄（confirming），之後可 recover。
   */
  async purchase(wallet: PublicKey, sku: string, onPhase: (p: SkrPayPhase) => void = () => {}, deps: SkrDeps = {}): Promise<SkrPayOutcome> {
    onPhase('creating_order');
    let order: SkrOrderView;
    try { order = (await apiClient.skrCreateOrder(sku)).order; } catch (e) { throw mapApiError(e); }
    if (order.status === 'confirming' && order.signature) return this.confirmUntil(order, order.signature, onPhase, deps); // 上次送出後遺失回覆：先查，不重付
    if (order.status !== 'awaiting_payment') throw new SkrPayError(order.status === 'expired' ? 'ORDER_EXPIRED' : 'UNKNOWN', `order is ${order.status}`, order);
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
    onPhase('opening_wallet');
    let signature: string;
    try {
      signature = await (deps.sendTx ?? ((c, t, o) => walletService.signAndSendTransactionOn(c, t, o)))(mwaChainFor(order.network), tx, { minContextSlot: context.slot });
    } catch (e) {
      throw mapApiError(e, order);
    }
    onPhase('sending');
    return this.confirmUntil(order, signature, onPhase, deps);
  },

  /** 向伺服器確認；RPC 尚未看到 → 退避重試；仍未見 → 回 confirming（保留給 recover），不視為失敗、不重付 */
  async confirmUntil(order: SkrOrderView, signature: string, onPhase: (p: SkrPayPhase) => void, deps: SkrDeps = {}): Promise<SkrPayOutcome> {
    onPhase('confirming');
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    let last: SkrOrderView = order;
    for (let i = 0; i < CONFIRM_ATTEMPTS; i++) {
      let r: { order: SkrOrderView; found: boolean; verify: string | null };
      try { r = await apiClient.skrConfirm(order.order_id, signature); } catch (e) { throw mapApiError(e, last); }
      last = r.order;
      if (r.order.status === 'fulfilled') { onPhase('done'); return { kind: 'fulfilled', order: r.order, signature }; }
      if (r.order.status === 'needs_review') return { kind: 'needs_review', order: r.order, signature };
      if (r.found && r.order.status === 'awaiting_payment') throw new SkrPayError('UNKNOWN', `payment failed onchain (${r.verify ?? 'tx_failed'}); nothing was charged`, r.order);
      await sleep(CONFIRM_BACKOFF_MS[Math.min(i, CONFIRM_BACKOFF_MS.length - 1)]!);
    }
    return { kind: 'confirming', order: last, signature };
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
