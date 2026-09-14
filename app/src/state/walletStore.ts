import { create } from 'zustand';

import { walletService, type WalletError, type WalletSession } from '@/services/wallet/WalletService';

export type WalletStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

type WalletState = {
  status: WalletStatus;
  session: WalletSession | null;
  error: WalletError | null;
  connect: () => Promise<WalletSession | null>;
  restore: () => Promise<WalletSession | null>;
  disconnect: () => Promise<void>;
  clearError: () => void;
};

/** UI 狀態（Zustand）；權威 session 在 WalletService／SecureStore */
export const useWalletStore = create<WalletState>((set) => ({
  status: 'idle',
  session: null,
  error: null,

  async connect() {
    set({ status: 'connecting', error: null });
    try {
      const session = await walletService.connect();
      set({ status: 'connected', session });
      return session;
    } catch (e) {
      set({ status: 'error', error: e as WalletError });
      return null;
    }
  },

  async restore() {
    const session = await walletService.restore();
    set({ status: session ? 'connected' : 'disconnected', session });
    return session;
  },

  async disconnect() {
    await walletService.disconnect();
    set({ status: 'disconnected', session: null, error: null });
  },

  clearError: () => set({ error: null, status: 'idle' }),
}));

export const shortAddress = (address: string, n = 4) => `${address.slice(0, n)}…${address.slice(-n)}`;
