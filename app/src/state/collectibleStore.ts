import { useNftRevealStore } from './nftRevealStore';
/** My collection 狀態（PG-A-14）：已領取集合（鏈上 receipt 快取）、進行中的領取與最後結果。 */
import type { PublicKey } from '@solana/web3.js';
import { create } from 'zustand';

import type { CollectibleKind } from '@/domain/collectibles';
import { ClaimError } from '@/services/chain/StarterShoeService';
import { collectibleService, type CollectibleClaimResult, type CollectibleEdition } from '@/services/chain/CollectibleService';

export type ClaimOutcome = { kind: 'success'; result: CollectibleClaimResult } | { kind: 'error'; code: ClaimError['code']; message: string; collectible: CollectibleKind };

type State = {
  claimed: Set<number>;
  loading: boolean;
  error: string | null;
  /** 目前正在簽章／確認的 kind */
  claiming: CollectibleKind | null;
  outcome: ClaimOutcome | null;
  /** NFT 編號（鏈上領取順序）：undefined 未查、null 查過未領取／查不到 */
  editions: Record<number, CollectibleEdition | null | undefined>;
  editionLoading: Record<number, boolean | undefined>;
  refresh: (wallet: PublicKey) => Promise<void>;
  loadEdition: (wallet: PublicKey, kind: CollectibleKind, force?: boolean) => Promise<void>;
  claim: (wallet: PublicKey, kind: CollectibleKind) => Promise<void>;
  dismissOutcome: () => void;
};

export const useCollectibleStore = create<State>((set, get) => ({
  claimed: new Set(),
  loading: false,
  error: null,
  claiming: null,
  outcome: null,
  editions: {},
  editionLoading: {},

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

  async loadEdition(wallet, kind, force = false) {
    if (get().editionLoading[kind] || (!force && get().editions[kind] !== undefined)) return;
    set((s) => ({ editionLoading: { ...s.editionLoading, [kind]: true } }));
    try {
      const edition = await collectibleService.fetchEdition(wallet, kind);
      set((s) => ({ editions: { ...s.editions, [kind]: edition } }));
    } catch {
      // RPC 失敗：保持未查狀態，畫面顯示「暫時無法查詢」，下次開啟再試
    } finally {
      set((s) => ({ editionLoading: { ...s.editionLoading, [kind]: false } }));
    }
  },

  async claim(wallet, kind) {
    if (get().claiming !== null) return;
    set({ claiming: kind, outcome: null });
    try {
      const result = await collectibleService.claim(wallet, kind);
      if (!result.alreadyClaimed) useNftRevealStore.getState().enqueue({ id: result.asset, collectible: kind });
      set((s) => ({ claimed: new Set([...s.claimed, kind]), outcome: { kind: 'success', result } }));
      void get().loadEdition(wallet, kind, true);
    } catch (e) {
      const code = e instanceof ClaimError ? e.code : 'FAILED';
      set({ outcome: { kind: 'error', code, message: e instanceof Error ? e.message : String(e), collectible: kind } });
    } finally {
      set({ claiming: null });
    }
  },

  dismissOutcome: () => set({ outcome: null }),
}));
