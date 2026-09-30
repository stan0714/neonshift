/**
 * SKR 外觀付款狀態（SKR-03／05／06）：目錄、購買流程階段、本機 pending 訂單（關 App 重開可復原）、外觀選用偏好。
 * - pending 與偏好按 network＋wallet 隔離（§5：pending 資料按 network＋wallet 隔離；換帳戶不混用）。
 * - 權限以伺服器為準；本機只快取最後一次讀到的 entitlements 供離線顯示，不據此授予新權限。
 */
import * as SecureStore from 'expo-secure-store';
import type { PublicKey } from '@solana/web3.js';
import { create } from 'zustand';

import type { SkrCatalog, SkrEntitlementView, SkrNetwork, SkrOrderView } from '@/services/api/ApiClient';
import { skrService, SkrPayError, type SkrPaymentAttempt, type SkrPayOutcome, type SkrPayPhase } from '@/services/skr/SkrService';

export const GENESIS_FRAME_COSMETIC = 'skr_genesis_mint_frame_v1';
const KEY = 'neonshift.skr.v1';

type Persisted = {
  /**
   * `${network}:${wallet}` → 尚未終結的訂單（用來 recover）。
   * `attempt`（R1）在開錢包**之前**寫入：它存在就代表可能已經付過，之後只准查、不准再付。
   * 這是整個保護唯一的知情來源——伺服器在回覆遺失時根本不知道有這筆交易。
   */
  pending: Record<string, { orderId: string; signature: string | null; sku: string; attempt?: SkrPaymentAttempt | null }>;
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
  /**
   * R2：每次 refreshCatalog 遞增。回應回來時對不上就整包丟掉——
   * A 的請求晚於 B 回來會覆蓋 B 的目錄，而「先發的先回」在網路上從來不成立。
   */
  catalogGeneration: number;
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
  catalogGeneration: 0,
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
    // R2：換帳戶時先把上一個帳號的展示狀態清乾淨。價格、資格、未完成訂單、
    // 成功訊息、錯誤——這些全是「那個帳號」的事實，留在畫面上就是在對 B 說 A 的事。
    if (get().catalogWallet !== null && get().catalogWallet !== wallet) {
      set({ catalog: null, catalogWallet: null, catalogError: null, phase: null, error: null, outcome: null });
    }
    const gen = get().catalogGeneration + 1;
    set({ catalogGeneration: gen });
    try {
      const catalog = await skrService.catalog();
      if (get().catalogGeneration !== gen) return; // 已經有更新的請求出發：這包是舊的，丟掉
      const next: Persisted = { ...get().persisted };
      if (catalog.enabled) {
        const k = scope(catalog.network, wallet);
        next.entitlements = { ...next.entitlements, [k]: catalog.entitlements.filter((e) => e.status === 'active').map((e) => e.cosmetic_id) };
        // 伺服器仍有未終結訂單 → 記到本機 pending；已終結 → 清掉
        const open = catalog.skus.map((s) => s.open_order).find((o): o is SkrOrderView => !!o && (o.status === 'awaiting_payment' || o.status === 'confirming' || o.status === 'needs_review'));
        const pending = { ...next.pending };
        // attempt 要留著：refreshCatalog 每次卡片掛載都跑，直接覆寫等於保護當場失效（R1）。
        // 伺服器的 open_order 不知道有沒有付過——知情的只有本機這筆 attempt。
        const keptAttempt = open && pending[k]?.attempt?.orderId === open.order_id ? pending[k]!.attempt : null;
        if (open) pending[k] = { orderId: open.order_id, signature: open.signature ?? pending[k]?.signature ?? null, sku: open.sku, attempt: keptAttempt };
        else delete pending[k];
        next.pending = pending;
      }
      set({ catalog, catalogWallet: wallet, catalogError: null, persisted: next });
      await persist(next);
    } catch (e) {
      if (get().catalogGeneration !== gen) return; // 舊請求的錯誤不該蓋掉新帳號的畫面
      set({ catalogError: e instanceof Error ? e.message : String(e) });
    }
  },

  async purchase(wallet, sku) {
    const cat = get().catalog;
    if (!cat || !cat.enabled) return null;
    // R2：目錄必須屬於要付款的這個錢包。價格、資格、收款人都來自目錄——
    // 拿 A 的目錄替 B 付款，是在用別人的資格買東西。
    if (get().catalogWallet !== wallet.toBase58()) return null;
    // attempt 存在 SecureStore，冷啟動後第一次購買必須先讀回來，否則保護等於不存在
    await get().load();
    set({ phase: 'creating_order', error: null, outcome: null });
    const k = scope(cat.network, wallet.toBase58());
    const writePending = async (rec: Persisted['pending'][string]) => {
      const next: Persisted = { ...get().persisted, pending: { ...get().persisted.pending, [k]: rec } };
      set({ persisted: next });
      await persist(next);
    };
    const prior = get().persisted.pending[k]?.attempt ?? null;
    try {
      const outcome = await skrService.purchase(wallet, sku, (phase) => set({ phase }), {
        onAttempt: async (attempt) => { await writePending({ orderId: attempt.orderId, signature: null, sku, attempt }); },
        onSignature: async (orderId, signature) => {
          const cur = get().persisted.pending[k];
          await writePending({ orderId, signature, sku, attempt: cur?.attempt ? { ...cur.attempt, signature } : null });
        },
      }, prior);
      const next: Persisted = { ...get().persisted, pending: { ...get().persisted.pending } };
      // 只有 fulfilled 才算結清；confirming／needs_review 仍要留著 attempt，不然下一次又能付
      if (outcome.kind === 'fulfilled') delete next.pending[k];
      else next.pending[k] = { orderId: outcome.order.order_id, signature: outcome.signature, sku, attempt: next.pending[k]?.attempt ?? null };
      set({ outcome, phase: null, persisted: next });
      await persist(next);
      await get().refreshCatalog(wallet.toBase58());
      return outcome;
    } catch (e) {
      const err = e instanceof SkrPayError ? e : new SkrPayError('UNKNOWN', e instanceof Error ? e.message : String(e));
      const cur = get().persisted.pending[k];
      if (err.code === 'REJECTED') {
        // 錢包明確回報「使用者拒絕」——這是**確定的否定答案**，沒有簽名也沒有廣播，
        // 與「沒有回覆」性質不同。不清掉的話按一次取消就要等有效期過才能再付。
        if (cur) await writePending({ ...cur, attempt: null });
      } else if (err.order && (err.code === 'WALLET_NO_REPLY' || err.code === 'NETWORK_ERROR' || err.code === 'RESULT_UNKNOWN' || err.code === 'UNKNOWN')) {
        // signature 優先用錯誤帶回來的（confirm 的網路錯誤不該把它弄丟）
        await writePending({ orderId: err.order.order_id, signature: err.signature ?? cur?.signature ?? err.order.signature, sku, attempt: cur?.attempt ?? null });
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

/**
 * R1：這個錢包目前有沒有未結清的付款嘗試。有的話 UI 只提供「查看狀態」，
 * 不提供付款也不提供取消——取消一筆可能已經在鏈上的付款同樣會誤導人。
 */
export function openAttemptFor(state: Pick<State, 'catalog' | 'catalogWallet' | 'persisted'>, wallet: string | null): SkrPaymentAttempt | null {
  return pendingOrderFor(state, wallet)?.attempt ?? null;
}
