/**
 * WalletModule（PG-A-06，SD 5.1、FR-01）：MWA 2.0 授權、auth token 保存、簽章。
 * 不負責交易內容組裝（TxBuilder，PG-A-09）。
 *
 * - 首次：`authorize` 開啟相容錢包；NeonShift 不會取得 seed phrase
 * - 重啟：以保存的 auth_token `reauthorize`；失效即清除並視為 disconnected（FR-01.2），不可視為已可簽章
 * - 斷線／切換：`deauthorize` 並清除本機 token（FR-01.4）
 */
import { transact, type Web3MobileWallet } from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import { PublicKey, type Transaction, type VersionedTransaction } from '@solana/web3.js';
import * as SecureStore from 'expo-secure-store';
import { Buffer } from 'buffer';

import { APP_CONFIG } from '@/config/app';

export type WalletSession = {
  /** base58 */
  address: string;
  publicKey: PublicKey;
  label?: string;
  walletUriBase: string;
};

/** Style 10.1：rejected、wallet unavailable、session expired、network error */
export type WalletErrorCode = 'REJECTED' | 'WALLET_UNAVAILABLE' | 'SESSION_EXPIRED' | 'NETWORK_ERROR' | 'WALLET_NO_REPLY' | 'STORAGE_ERROR' | 'UNKNOWN';

export type ConnectPhase = 'opening' | 'authorizing' | 'signing' | 'login' | 'saving';

export class WalletError extends Error {
  constructor(
    public readonly code: WalletErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'WalletError';
  }
}

const STORE_KEY = 'neonshift.wallet.session.v1';

type Stored = { authToken: string; address: string; label?: string; walletUriBase: string };

const identity = { name: 'NeonShift', uri: APP_CONFIG.siteUrl, icon: 'favicon.png' } as const;
const chain = `solana:${APP_CONFIG.cluster}` as const;

function toSession(address: string, label: string | undefined, walletUriBase: string): WalletSession {
  return { address, publicKey: new PublicKey(address), label, walletUriBase };
}

/** MWA 回傳 base64 位址，轉 base58 */
export function base64ToBase58(b64: string): string {
  return new PublicKey(Buffer.from(b64, 'base64')).toBase58();
}

export function mapWalletError(e: unknown): WalletError {
  if (e instanceof WalletError) return e;
  const code = (e as { code?: string | number })?.code;
  const name = (e as { name?: string })?.name;
  const msg = e instanceof Error ? e.message : String(e);
  if (code === 'ERROR_WALLET_NOT_FOUND') return new WalletError('WALLET_UNAVAILABLE', msg, e);
  if (code === 'ERROR_ASSOCIATION_CANCELLED' || code === -1 /* ERROR_AUTHORIZATION_FAILED */) return new WalletError('REJECTED', msg, e);
  if (code === 'ERROR_SESSION_CLOSED' || code === 'ERROR_SESSION_TIMEOUT') return new WalletError('NETWORK_ERROR', msg, e);
  if (name === 'SolanaMobileWalletAdapterError') return new WalletError('UNKNOWN', msg, e);
  return new WalletError('UNKNOWN', msg, e);
}

/**
 * 錢包簽了卻沒有把結果送回（2026-09-21 Seeker 實機：Phantom 26.6 在 Seed Vault 簽完訊息後內部出錯
 * `sol_mwa_sign_messages … Readable side is not in a state that permits enqueue`，不回覆也不跳回 App；
 * 等 App 回前景時 session 關閉，MWA 端拋 `CancellationException`）。與使用者主動取消（REJECTED）區分，
 * 讓畫面能提示改用 Seeker Wallet。只在「請求已送到錢包」之後套用。
 */
export function mapSignError(e: unknown): WalletError {
  const mapped = mapWalletError(e);
  if (mapped.code === 'REJECTED' || mapped.code === 'WALLET_NO_REPLY') return mapped;
  const msg = e instanceof Error ? e.message : String(e);
  if (/CancellationException|session closed/i.test(msg)) return new WalletError('WALLET_NO_REPLY', msg, e);
  return mapped;
}

/** 已知在 Seeker 上簽訊息不會回覆的錢包（依 authorize 回傳的 label／wallet_uri_base 判斷） */
export function isKnownNoReplyWallet(session: { label?: string; walletUriBase?: string } | null | undefined): boolean {
  if (!session) return false;
  return /phantom/i.test(session.label ?? '') || /phantom/i.test(session.walletUriBase ?? '');
}

async function readStored(): Promise<Stored | null> {
  try {
    const raw = await SecureStore.getItemAsync(STORE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Stored;
    if (!value || typeof value.authToken !== 'string' || !value.authToken || typeof value.address !== 'string') return null;
    new PublicKey(value.address);
    // wallet_uri_base 型別雖為 string，Seeker Wallet 實際回 undefined（2026-09-21 實機：嚴格檢查會把有效 session 當損壞，重啟後回到歡迎頁）
    return { ...value, walletUriBase: typeof value.walletUriBase === 'string' ? value.walletUriBase : '' };
  } catch {
    return null;
  }
}

async function writeStored(s: Stored | null): Promise<void> {
  try {
    if (s) await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(s));
    else await SecureStore.deleteItemAsync(STORE_KEY);
  } catch (e) {
    throw new WalletError('STORAGE_ERROR', 'Unable to save wallet authorization on this device', e);
  }
}

let cachedAuthToken: string | null = null;

type Authorized = Awaited<ReturnType<Web3MobileWallet['authorize']>>;
export const REAUTHORIZE_DELAY_MS = 1500;
const isAuthFailure = (e: unknown) => {
  const code = (e as { code?: string | number })?.code;
  return code === -1 /* ERROR_AUTHORIZATION_FAILED */ || code === 'ERROR_SESSION_CLOSED';
};

/**
 * 以保存的 auth_token 重新授權後執行 `op`。錢包已撤銷／清除該 token 時（Phantom 會直接關閉 session，Seeker 錢包回 -1），
 * 改開一次全新授權讓使用者在錢包確認；回來的帳戶必須與本機 session 相同，否則清除本機 session 並回 SESSION_EXPIRED。
 * 重試只發生在 authorize 階段失敗時；`op` 已送到錢包後的錯誤原樣拋出，不重送。
 */
async function withAuthorizedWallet<T>(stored: Stored, op: (wallet: Web3MobileWallet, auth: Authorized) => Promise<T>): Promise<T> {
  let authorized = false;
  const run = (authToken: string | undefined) =>
    transact(async (wallet: Web3MobileWallet) => {
      const auth = await wallet.authorize(authToken ? { identity, chain, auth_token: authToken } : { identity, chain });
      authorized = true;
      const account = auth.accounts[0];
      if (!account || base64ToBase58(account.address) !== stored.address) {
        await writeStored(null);
        cachedAuthToken = null;
        throw new WalletError('SESSION_EXPIRED', 'Wallet returned a different account');
      }
      cachedAuthToken = auth.auth_token;
      await writeStored({ ...stored, authToken: auth.auth_token, label: account.label, walletUriBase: auth.wallet_uri_base ?? '' });
      return op(wallet, auth);
    });
  try {
    return await run(cachedAuthToken ?? stored.authToken);
  } catch (e) {
    if (authorized || !isAuthFailure(e)) throw e;
    cachedAuthToken = null;
    // 錢包關閉上一個 session 後仍在收尾（Phantom 會重建本機 WebSocket server）；立刻重開會被一併關掉，先等一下
    await new Promise((r) => setTimeout(r, REAUTHORIZE_DELAY_MS));
    try {
      return await run(undefined);
    } catch (e2) {
      if (!authorized && isAuthFailure(e2)) {
        await writeStored(null);
        cachedAuthToken = null;
        throw new WalletError('SESSION_EXPIRED', 'Wallet authorization expired', e2);
      }
      throw e2;
    }
  }
}

export const walletService = {
  /**
   * FR-01.1：開啟 MWA 相容錢包並取得使用者選定帳戶。
   * `afterAuthorize`（可選）在同一個錢包 session 內接著執行（例如後端 SIWS 登入：取 nonce → 簽訊息 → verify），
   * 使用者只切換一次錢包 App、看到「連線＋簽登入訊息」兩個核准；它失敗（拒簽／後端不通）不影響錢包連線，由呼叫端另行處理。
   */
  async connect(opts?: { onPhase?: (phase: ConnectPhase) => void; onLoginError?: (error: unknown) => void; afterAuthorize?: (address: string, sign: (message: Uint8Array) => Promise<Uint8Array>) => Promise<void> }): Promise<WalletSession> {
    try {
      opts?.onPhase?.('opening');
      const result = await transact(async (wallet: Web3MobileWallet) => {
        opts?.onPhase?.('authorizing');
        const auth = await wallet.authorize({ identity, chain });
        const account = auth.accounts[0];
        if (account && opts?.afterAuthorize) {
          try {
            opts.onPhase?.('login');
            await opts.afterAuthorize(base64ToBase58(account.address), async (message) => {
              opts.onPhase?.('signing');
              const [sig] = await wallet.signMessages({ addresses: [account.address], payloads: [message] });
              if (!sig) throw new WalletError('REJECTED', 'Message not signed');
              opts.onPhase?.('login');
              return sig;
            });
          } catch (error) {
            opts.onLoginError?.(error);
          }
        }
        return auth;
      });
      const account = result.accounts[0];
      if (!account) throw new WalletError('REJECTED', 'No account authorized');
      const address = base64ToBase58(account.address);
      const stored: Stored = { authToken: result.auth_token, address, label: account.label, walletUriBase: result.wallet_uri_base ?? '' };
      opts?.onPhase?.('saving');
      await writeStored(stored);
      cachedAuthToken = stored.authToken;
      return toSession(address, account.label, result.wallet_uri_base ?? '');
    } catch (e) {
      throw mapWalletError(e);
    }
  },

  /** FR-01.2：有 token 時優先重新授權；失效或錢包移除即回 null 並清除 */
  async restore(): Promise<WalletSession | null> {
    const stored = await readStored();
    if (!stored) return null;
    try {
      const result = await transact(async (wallet: Web3MobileWallet) =>
        wallet.authorize({ identity, chain, auth_token: stored.authToken }),
      );
      const account = result.accounts[0];
      if (!account) throw new Error('no account');
      const address = base64ToBase58(account.address);
      const next: Stored = { authToken: result.auth_token, address, label: account.label, walletUriBase: result.wallet_uri_base ?? '' };
      await writeStored(next);
      cachedAuthToken = next.authToken;
      return toSession(address, account.label, result.wallet_uri_base ?? '');
    } catch (e) {
      const err = mapWalletError(e);
      // 錢包不在或授權失效：清除本機 token，回到連線流程；網路錯誤保留 token 讓使用者重試
      if (err.code !== 'NETWORK_ERROR') {
        await writeStored(null);
        cachedAuthToken = null;
      }
      return null;
    }
  },

  /** 本機是否保有 session（不代表仍可簽章） */
  async hasStoredSession(): Promise<boolean> {
    return (await readStored()) !== null;
  },

  /**
   * 啟動時使用：只讀本機保存的 session，不開啟錢包（MWA reauthorize 會把錢包 App 拉到前景，
   * 不適合在 bootstrap 做）；真正的 reauthorize 延後到第一次需要簽章時（signMessage／signAndSend）。
   */
  async peekStoredSession(): Promise<WalletSession | null> {
    const stored = await readStored();
    return stored ? toSession(stored.address, stored.label, stored.walletUriBase) : null;
  },

  /** FR-01.4：撤銷授權並清除 token；錢包端失敗也要清本機 */
  async disconnect(): Promise<void> {
    const stored = await readStored();
    if (stored) {
      try {
        await transact(async (wallet: Web3MobileWallet) => wallet.deauthorize({ auth_token: stored.authToken }));
      } catch {
        // 忽略：本機狀態優先清除
      }
    }
    await writeStored(null);
    cachedAuthToken = null;
  },

  /**
   * 由錢包簽章並送出交易；回傳 signature（base58）。送出後的確認與冪等由 ChainClient 負責（PG-A-10）。
   * `minContextSlot`：取 blockhash 時的 context slot（Phantom 的 MWA 實作把它當必填，缺少會直接拒絕而不顯示簽章畫面；Seeker 錢包則可選）。
   */
  async signAndSendTransaction(tx: Transaction | VersionedTransaction, opts: { minContextSlot?: number } = {}): Promise<string> {
    const stored = await readStored();
    if (!stored) throw new WalletError('SESSION_EXPIRED', 'No wallet session');
    try {
      const [sig] = await withAuthorizedWallet(stored, (wallet) =>
        wallet.signAndSendTransactions({ transactions: [tx], ...(opts.minContextSlot !== undefined ? { minContextSlot: opts.minContextSlot } : {}) }),
      );
      if (!sig) throw new WalletError('REJECTED', 'Transaction not sent');
      return sig;
    } catch (e) {
      throw mapWalletError(e);
    }
  },

  /**
   * SKR-01／03：在「另一條鏈」（官方 SKR 付款用主網）簽送交易。與 devnet 的授權分開：MWA 授權綁 chain，
   * 主網授權另存 token（`neonshift.wallet.session.v1:<chain>`），第一次會多一次錢包核准；帳戶必須與 devnet session 相同。
   * 不重用 devnet token、不改動全 App cluster（計畫 §1：禁止把現有 cluster 直接改主網）。
   */
  async signAndSendTransactionOn(targetChain: `solana:${string}`, tx: Transaction | VersionedTransaction, opts: { minContextSlot?: number } = {}): Promise<string> {
    const stored = await readStored();
    if (!stored) throw new WalletError('SESSION_EXPIRED', 'No wallet session');
    const key = `${STORE_KEY}:${targetChain}`;
    let token: string | null = null;
    try { token = await SecureStore.getItemAsync(key); } catch { token = null; }
    let sent = false;
    const run = (authToken: string | null) =>
      transact(async (wallet: Web3MobileWallet) => {
        const auth = await wallet.authorize(authToken ? { identity, chain: targetChain, auth_token: authToken } : { identity, chain: targetChain });
        const account = auth.accounts[0];
        if (!account || base64ToBase58(account.address) !== stored.address) throw new WalletError('SESSION_EXPIRED', 'Wallet returned a different account for the payment network');
        try { await SecureStore.setItemAsync(key, auth.auth_token); } catch { /* 下次再授權一次即可 */ }
        sent = true;
        const [sig] = await wallet.signAndSendTransactions({ transactions: [tx], ...(opts.minContextSlot !== undefined ? { minContextSlot: opts.minContextSlot } : {}) });
        if (!sig) throw new WalletError('REJECTED', 'Transaction not sent');
        return sig;
      });
    try {
      try {
        return await run(token);
      } catch (e) {
        if (sent || !token || !isAuthFailure(e)) throw e;
        try { await SecureStore.deleteItemAsync(key); } catch { /* ignore */ }
        await new Promise((r) => setTimeout(r, REAUTHORIZE_DELAY_MS));
        return await run(null);
      }
    } catch (e) {
      throw sent ? mapSignError(e) : mapWalletError(e);
    }
  },

  /** 以已授權 session 簽署任意訊息（SIWS、claim challenge，PG-A-07） */
  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    const stored = await readStored();
    if (!stored) throw new WalletError('SESSION_EXPIRED', 'No wallet session');
    let sent = false;
    try {
      const signed = await withAuthorizedWallet(stored, async (wallet, auth) => {
        sent = true;
        const [sig] = await wallet.signMessages({ addresses: [auth.accounts[0]!.address], payloads: [message] });
        return sig;
      });
      if (!signed) throw new WalletError('REJECTED', 'Message not signed');
      return signed;
    } catch (e) {
      throw sent ? mapSignError(e) : mapWalletError(e);
    }
  },
};
