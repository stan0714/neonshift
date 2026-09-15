import { useNftRevealStore } from './nftRevealStore';
/** My collection 狀態（PG-A-14）：已領取集合（鏈上 receipt 快取）、進行中的領取與最後結果。 */
import type { PublicKey } from '@solana/web3.js';
import { create } from 'zustand';

import type { CollectibleKind } from '@/domain/collectibles';
import { ClaimError } from '@/services/chain/StarterShoeService';
import { collectibleService, type CollectibleClaimResult } from '@/services/chain/CollectibleService';

export type ClaimOutcome = { kind: 'success'; result: CollectibleClaimResult } | { kind: 'error'; code: ClaimError['code']; message: string; collectible: CollectibleKind };

type State = {
  claimed: Set<number>;
  loading: boolean;
  error: string | null;
  /** 目前正在簽章／確認的 kind */
  claiming: CollectibleKind | null;
  outcome: ClaimOutcome | null;
  refresh: (wallet: PublicKey) => Promise<void>;
  claim: (wallet: PublicKey, kind: CollectibleKind) => Promise<void>;
  dismissOutcome: () => void;
};

export const useCollectibleStore = create<State>((set, get) => ({
  claimed: new Set(),
  loading: false,
  error: null,
  claiming: null,
  outcome: null,

  async refresh(wallet) {
    set({ loading: true });
    try {
      set({ claimed: await collectibleService.fetchClaimed(wallet), error: null });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      set({ loading: false });
    }
  },

  async claim(wallet, kind) {
    if (get().claiming !== null) return;
    set({ claiming: kind, outcome: null });
    try {
      const result = await collectibleService.claim(wallet, kind);
      if (!result.alreadyClaimed) useNftRevealStore.getState().enqueue({ id: result.asset, collectible: kind });
      set((s) => ({ claimed: new Set([...s.claimed, kind]), outcome: { kind: 'success', result } }));
    } catch (e) {
      const code = e instanceof ClaimError ? e.code : 'FAILED';
      set({ outcome: { kind: 'error', code, message: e instanceof Error ? e.message : String(e), collectible: kind } });
    } finally {
      set({ claiming: null });
    }
  },

  dismissOutcome: () => set({ outcome: null }),
}));
