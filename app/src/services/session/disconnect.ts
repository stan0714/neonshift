/**
 * 斷開錢包的完整流程（Profile 與新手連接頁共用）。
 *
 * 2026-10-02 RC v15 驗收（A-4 ⑤＋⑨）：新手流程裡連上一個 0 SOL 的帳戶後領不到起始鞋，
 * 退回連接頁只剩「Continue as …」，斷開按鈕只在 Profile、而 Profile 要先完成新手流程——
 * 使用者被關在那個帳戶裡出不來。兩處改呼叫同一支，不各寫一份。
 */
import { apiClient } from '@/services/api/ApiClient';
import { healthConnect } from '@/services/health/HealthConnectService';
import { useWalletStore } from '@/state/walletStore';

/** 後端登出最多等這麼久；本機 token 不論結果都會清掉 */
export const SIGN_OUT_TIMEOUT_MS = 3_000;

export async function disconnectWallet(): Promise<void> {
  await apiClient.signOut({ timeoutMs: SIGN_OUT_TIMEOUT_MS }).catch(() => {});
  await useWalletStore.getState().disconnect();
  await healthConnect.clearCache().catch(() => {});
}
