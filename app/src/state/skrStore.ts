/**
 * SKR 外觀付款狀態（SKR-03／05／06）：目錄、購買流程階段、本機 pending 訂單（關 App 重開可復原）、外觀選用偏好。
 * - pending 與偏好按 network＋wallet 隔離（§5：pending 資料按 network＋wallet 隔離；換帳戶不混用）。
 * - 權限以伺服器為準；本機只快取最後一次讀到的 entitlements 供離線顯示，不據此授予新權限。
 */
import * as SecureStore from 'expo-secure-store';
import type { PublicKey } from '@solana/web3.js';
import { create } from 'zustand';

import type { SkrCatalog, SkrEntitlementView, SkrNetwork, SkrOrderView } from '@/services/api/ApiClient';
import { skrService, SkrPayError, type SkrPayOutcome, type SkrPayPhase } from '@/services/skr/SkrService';

export const GENESIS_FRAME_COSMETIC = 'skr_genesis_mint_frame_v1';
const KEY = 'neonshift.skr.v1';

type Persisted = {
  /** `${network}:${wallet}` → 尚未終結的訂單（用來 recover） */
  pending: Record<string, { orderId: string; signature: string | null; sku: string }>;
  /** `${network}:${wallet}` → 最後讀到的 active cosmetic ids */
  entitlements: Record<string, string[]>;
  /** `${wallet}` → 是否在收藏卡套用 Genesis 邊框（權限仍以伺服器為準） */
  useGenesisFrame: Record<string, boolean>;
};
const EMPTY: Persisted = { pending: {}, entitlements: {}, useGenesisFrame: {} };
const scope = (network: SkrNetwork, wallet: string) => `${network}:${wallet}`;

type State = {
  loaded: boolean;
  persisted: Persisted;
  catalog: SkrCatalog | null;
  /** 目錄屬於哪個錢包（目錄是「目前登入錢包」的資料，換帳戶時不得沿用） */
  catalogWallet: string | null;
  catalogError: string | null;
  phase: SkrPayPhase | null;
  error: SkrPayError | null;
  outcome: SkrPayOutcome | null;
  load: () => Promise<void>;
  refreshCatalog: (wallet: string) => Promise<void>;
  purchase: (wallet: PublicKey, sku: string) => Promise<SkrPayOutcome | null>;
  recover: (wallet: string, orderId: string) => Promise<SkrOrderView | null>;
  cancel: (wallet: string, orderId: string) => Promise<void>;
  setUseGenesisFrame: (wallet: string, on: boolean) => Promise<void>;
  clearOutcome: () => void;
};

async function persist(p: Persisted) { try { await SecureStore.setItemAsync(KEY, JSON.stringify(p)); } catch { /* 下次啟動由伺服器 recover 補回 */ } }

export const useSkrStore = create<State>((set, get) => ({
  loaded: false,
  persisted: EMPTY,
  catalog: null,
  catalogWallet: null,
  catalogError: null,
  phase: null,
  error: null,
  outcome: null,

  async load() {
    if (get().loaded) return;
    try {
      const raw = await SecureStore.getItemAsync(KEY);
      const p = raw ? (JSON.parse(raw) as Partial<Persisted>) : {};
      set({ persisted: { pending: p.pending ?? {}, entitlements: p.entitlements ?? {}, useGenesisFrame: p.useGenesisFrame ?? {} }, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  async refreshCatalog(wallet) {
    await get().load();
    try {
      const catalog = await skrService.catalog();
      const next: Persisted = { ...get().persisted };
      if (catalog.enabled) {
        const k = scope(catalog.network, wallet);
        next.entitlements = { ...next.entitlements, [k]: catalog.entitlements.filter((e) => e.status === 'active').map((e) => e.cosmetic_id) };
        // 伺服器仍有未終結訂單 → 記到本機 pending；已終結 → 清掉
        const open = catalog.skus.map((s) => s.open_order).find((o): o is SkrOrderView => !!o && (o.status === 'awaiting_payment' || o.status === 'confirming' || o.status === 'needs_review'));
        const pending = { ...next.pending };
        if (open) pending[k] = { orderId: open.order_id, signature: open.signature, sku: open.sku };
        else delete pending[k];
        next.pending = pending;
      }
      set({ catalog, catalogWallet: wallet, catalogError: null, persisted: next });
      await persist(next);
    } catch (e) {
      set({ catalogError: e instanceof Error ? e.message : String(e) });
    }
  },

  async purchase(wallet, sku) {
    const cat = get().catalog;
    if (!cat || !cat.enabled) return null;
    set({ phase: 'creating_order', error: null, outcome: null });
    const k = scope(cat.network, wallet.toBase58());
    try {
      const outcome = await skrService.purchase(wallet, sku, (phase) => set({ phase }), {});
      const next: Persisted = { ...get().persisted, pending: { ...get().persisted.pending } };
      if (outcome.kind === 'fulfilled') delete next.pending[k];
      else next.pending[k] = { orderId: outcome.order.order_id, signature: outcome.signature, sku };
      set({ outcome, phase: null, persisted: next });
      await persist(next);
      await get().refreshCatalog(wallet.toBase58());
      return outcome;
    } catch (e) {
      const err = e instanceof SkrPayError ? e : new SkrPayError('UNKNOWN', e instanceof Error ? e.message : String(e));
      // 訂單已建立但錢包沒回覆／取消：留 pending 以便 recover（可能已付）；未送出前的錯誤不留
      if (err.order && (err.code === 'WALLET_NO_REPLY' || err.code === 'NETWORK_ERROR' || err.code === 'UNKNOWN')) {
        const next: Persisted = { ...get().persisted, pending: { ...get().persisted.pending, [k]: { orderId: err.order.order_id, signature: err.order.signature, sku } } };
        set({ persisted: next });
        await persist(next);
      }
      set({ error: err, phase: null });
      return null;
    }
  },

  async recover(wallet, orderId) {
    const cat = get().catalog;
    set({ phase: 'confirming', error: null });
    try {
      const r = await skrService.recover(orderId);
      set({ phase: null, outcome: r.order.status === 'fulfilled' ? { kind: 'fulfilled', order: r.order, signature: r.order.signature ?? '' } : null });
      await get().refreshCatalog(wallet);
      if (cat?.enabled && (r.order.status === 'fulfilled' || r.order.status === 'cancelled' || r.order.status === 'expired')) {
        const next: Persisted = { ...get().persisted, pending: { ...get().persisted.pending } };
        delete next.pending[scope(cat.network, wallet)];
        set({ persisted: next });
        await persist(next);
      }
      return r.order;
    } catch (e) {
      set({ error: e instanceof SkrPayError ? e : new SkrPayError('UNKNOWN', e instanceof Error ? e.message : String(e)), phase: null });
      return null;
    }
  },

  async cancel(wallet, orderId) {
    const cat = get().catalog;
    try {
      await skrService.cancel(orderId);
      if (cat?.enabled) {
        const next: Persisted = { ...get().persisted, pending: { ...get().persisted.pending } };
        delete next.pending[scope(cat.network, wallet)];
        set({ persisted: next });
        await persist(next);
      }
      await get().refreshCatalog(wallet);
    } catch (e) {
      set({ error: e instanceof SkrPayError ? e : new SkrPayError('UNKNOWN', e instanceof Error ? e.message : String(e)) });
    }
  },

  async setUseGenesisFrame(wallet, on) {
    const next: Persisted = { ...get().persisted, useGenesisFrame: { ...get().persisted.useGenesisFrame, [wallet]: on } };
    set({ persisted: next });
    await persist(next);
  },

  clearOutcome: () => set({ outcome: null, error: null }),
}));

/** 是否擁有 Genesis 邊框（伺服器目錄優先，離線用本機快取） */
export function ownsGenesisFrame(state: Pick<State, 'catalog' | 'catalogWallet' | 'persisted'>, wallet: string | null): boolean {
  if (!wallet) return false;
  const cat = state.catalogWallet === wallet ? state.catalog : null;
  if (cat?.enabled) return cat.entitlements.some((e: SkrEntitlementView) => e.cosmetic_id === GENESIS_FRAME_COSMETIC && e.status === 'active');
  return Object.entries(state.persisted.entitlements).some(([k, ids]) => k.endsWith(`:${wallet}`) && ids.includes(GENESIS_FRAME_COSMETIC));
}
export function genesisFrameActive(state: Pick<State, 'catalog' | 'catalogWallet' | 'persisted'>, wallet: string | null): boolean {
  return !!wallet && ownsGenesisFrame(state, wallet) && (state.persisted.useGenesisFrame[wallet] ?? true);
}
export function pendingOrderFor(state: Pick<State, 'catalog' | 'catalogWallet' | 'persisted'>, wallet: string | null) {
  if (!wallet) return null;
  const cat = state.catalogWallet === wallet ? state.catalog : null;
  const network: SkrNetwork = cat?.enabled ? cat.network : 'mainnet-beta';
  return state.persisted.pending[scope(network, wallet)] ?? null;
}
