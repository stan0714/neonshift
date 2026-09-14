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
export type WalletErrorCode = 'REJECTED' | 'WALLET_UNAVAILABLE' | 'SESSION_EXPIRED' | 'NETWORK_ERROR' | 'UNKNOWN';

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

async function readStored(): Promise<Stored | null> {
  try {
    const raw = await SecureStore.getItemAsync(STORE_KEY);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

async function writeStored(s: Stored | null): Promise<void> {
  if (s) await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(s));
  else await SecureStore.deleteItemAsync(STORE_KEY);
}

let cachedAuthToken: string | null = null;

export const walletService = {
  /** FR-01.1：開啟 MWA 相容錢包並取得使用者選定帳戶 */
  async connect(): Promise<WalletSession> {
    try {
      const result = await transact(async (wallet: Web3MobileWallet) => wallet.authorize({ identity, chain }));
      const account = result.accounts[0];
      if (!account) throw new WalletError('REJECTED', 'No account authorized');
      const address = base64ToBase58(account.address);
      const stored: Stored = { authToken: result.auth_token, address, label: account.label, walletUriBase: result.wallet_uri_base };
      await writeStored(stored);
      cachedAuthToken = stored.authToken;
      return toSession(address, account.label, result.wallet_uri_base);
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
      const next: Stored = { authToken: result.auth_token, address, label: account.label, walletUriBase: result.wallet_uri_base };
      await writeStored(next);
      cachedAuthToken = next.authToken;
      return toSession(address, account.label, result.wallet_uri_base);
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

  /** 由錢包簽章並送出交易；回傳 signature（base58）。送出後的確認與冪等由 ChainClient 負責（PG-A-10） */
  async signAndSendTransaction(tx: Transaction | VersionedTransaction): Promise<string> {
    const stored = await readStored();
    if (!stored) throw new WalletError('SESSION_EXPIRED', 'No wallet session');
    try {
      const [sig] = await transact(async (wallet: Web3MobileWallet) => {
        const auth = await wallet.authorize({ identity, chain, auth_token: cachedAuthToken ?? stored.authToken });
        cachedAuthToken = auth.auth_token;
        return wallet.signAndSendTransactions({ transactions: [tx] });
      });
      if (!sig) throw new WalletError('REJECTED', 'Transaction not sent');
      return sig;
    } catch (e) {
      throw mapWalletError(e);
    }
  },

  /** 以已授權 session 簽署任意訊息（SIWS、claim challenge，PG-A-07） */
  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    const stored = await readStored();
    if (!stored) throw new WalletError('SESSION_EXPIRED', 'No wallet session');
    try {
      const signed = await transact(async (wallet: Web3MobileWallet) => {
        const auth = await wallet.authorize({ identity, chain, auth_token: cachedAuthToken ?? stored.authToken });
        cachedAuthToken = auth.auth_token;
        const [sig] = await wallet.signMessages({ addresses: [auth.accounts[0]!.address], payloads: [message] });
        return sig;
      });
      if (!signed) throw new WalletError('REJECTED', 'Message not signed');
      return signed;
    } catch (e) {
      const err = mapWalletError(e);
      if (err.code === 'REJECTED' && (e as { code?: number })?.code === -1) {
        await writeStored(null);
        cachedAuthToken = null;
        throw new WalletError('SESSION_EXPIRED', 'Wallet authorization expired', e);
      }
      throw err;
    }
  },
};
