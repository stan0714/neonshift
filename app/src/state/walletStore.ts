import { create } from 'zustand';

import { apiClient } from '@/services/api/ApiClient';
import { walletService, mapWalletError, type ConnectPhase, type WalletError, type WalletSession } from '@/services/wallet/WalletService';

export type WalletStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

type WalletState = {
  status: WalletStatus;
  session: WalletSession | null;
  error: WalletError | null;
  phase: ConnectPhase | null;
  loginIncomplete: boolean;
  connect: () => Promise<WalletSession | null>;
  restore: () => Promise<WalletSession | null>;
  disconnect: () => Promise<void>;
  clearError: () => void;
};

/** UI 狀態（Zustand）；權威 session 在 WalletService／SecureStore */
let connecting: Promise<WalletSession | null> | null = null;
let revision = 0;

export const useWalletStore = create<WalletState>((set, get) => ({
  status: 'idle',
  session: null,
  error: null,
  phase: null,
  loginIncomplete: false,

  connect() {
    if (connecting) return connecting;
    if (get().session && get().status === 'connected') return Promise.resolve(get().session);
    const attempt = ++revision;
    set({ status: 'connecting', error: null, phase: 'opening', loginIncomplete: false });
    connecting = (async () => {
      try {
        const session = await walletService.connect({
          onPhase: phase => { if (attempt === revision) set({ phase }); },
          onLoginError: () => { if (attempt === revision) set({ loginIncomplete: true }); },
          ...(apiClient.configured ? { afterAuthorize: async (address: string, sign: (m: Uint8Array) => Promise<Uint8Array>) => { await apiClient.signIn(address, sign); } } : {}),
        });
        if (attempt !== revision) return null;
        set({ status: 'connected', session, phase: null });
        return session;
      } catch (e) {
        if (attempt === revision) set({ status: 'error', error: mapWalletError(e) });
        return null;
      } finally {
        connecting = null;
      }
    })();
    return connecting;
  },

  /** 啟動用：只讀本機 session，不開錢包；簽章時才 reauthorize */
  async restore() {
    const snapshot = revision;
    if (connecting) return connecting;
    const session = await walletService.peekStoredSession();
    if (snapshot !== revision) return get().session;
    set({ status: session ? 'connected' : 'disconnected', session });
    return session;
  },

  async disconnect() {
    ++revision;
    if (connecting) await connecting;
    await walletService.disconnect();
    set({ status: 'disconnected', session: null, error: null, phase: null, loginIncomplete: false });
  },

  clearError: () => { if (!connecting) set({ error: null, status: get().session ? 'connected' : 'idle' }); },
}));

export const shortAddress = (address: string, n = 4) => `${address.slice(0, n)}…${address.slice(-n)}`;
