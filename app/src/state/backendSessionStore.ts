import { create } from 'zustand';

import { apiClient, onBackendSessionLost, onBackendSessionOk, type BackendSessionLostReason } from '@/services/api/ApiClient';

/**
 * 後端登入狀態（2026-09-30）。
 *
 * 為什麼需要它：錢包連著**不等於**後端還認得你。實機上兩者分開失效過——
 * 首頁照常顯示錢包位址，但同步、成就、節日全部在送出前就被擋下，
 * 而畫面上沒有任何地方說「你要重新連結」。錢包 store 回答不了這個問題，
 * 只有 `ApiClient` 知道 token 還在不在，所以由它通知、這裡保存。
 *
 * `expired` 只是「需要重新連結」的訊號，不代表錢包授權沒了——
 * 重新連結只需要再簽一次 SIWS，不必重走新手流程。
 */
export type BackendSessionState = 'unknown' | 'active' | 'expired';

type State = {
  state: BackendSessionState;
  /** 最後一次失效的原因，只作診斷用，不進使用者文案 */
  reason: BackendSessionLostReason | null;
  /** 重新連結進行中 */
  restoring: boolean;
  markActive: () => void;
  markExpired: (reason: BackendSessionLostReason) => void;
  /** 開 App／回前景時對一次實際狀態（不會觸發登入） */
  check: () => Promise<BackendSessionState>;
  /** 使用者按下「重新連結」：只做 SIWS，不動新手流程 */
  restore: (address: string) => Promise<boolean>;
};

export const useBackendSessionStore = create<State>((set, get) => ({
  state: 'unknown',
  reason: null,
  restoring: false,
  markActive: () => set({ state: 'active', reason: null }),
  markExpired: (reason) => set({ state: 'expired', reason }),
  async check() {
    try {
      const ok = await apiClient.hasSession();
      // **本機有 token 不代表伺服器還認得你**——今天實機就是這樣：token 在、但每支請求
      // 都被擋下。所以 `check()` 只能把 unknown 判成 expired，**不能**把已知的 expired
      // 升回 active。解除 expired 只有兩條路：重新登入成功，或某支需要登入的請求真的成功
      // （`onBackendSessionOk`）。
      if (!ok) { set({ state: 'expired' }); return 'expired'; }
      if (get().state === 'expired') return 'expired';
      set({ state: 'active', reason: null });
      return 'active';
    } catch {
      // 查不到就別亂猜：維持現狀，避免離線時誤報「需要重新連結」
      return get().state;
    }
  },
  async restore(address) {
    if (get().restoring) return false;
    set({ restoring: true });
    try {
      await apiClient.signIn(address);
      set({ state: 'active', reason: null });
      return true;
    } catch {
      // 失敗維持 expired：按鈕還在，使用者可以再試
      return false;
    } finally {
      set({ restoring: false });
    }
  },
}));

/** 模組載入時就開始聽——失效可能發生在任何一支請求上，不限於某個畫面 */
onBackendSessionLost((reason) => useBackendSessionStore.getState().markExpired(reason));
/** 相對地：任何一支需要登入的請求成功，就解除「需要重新連結」 */
onBackendSessionOk(() => {
  if (useBackendSessionStore.getState().state !== 'active') useBackendSessionStore.getState().markActive();
});
