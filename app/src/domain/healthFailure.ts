/**
 * 健康資料讀取失敗的分類（2026-09-29）。
 *
 * 動機與 `services/chain/ChainClient.ts` 的 `classifyRpcError` 相同，而且是同一個錯誤重演一次：
 * `home.healthErr.body` 原本長成「Health Connect 沒有回應。…{error}」——把原生模組
 * （Kotlin／Health Connect SDK）丟出來的例外訊息直接插進使用者文案。那句話還順便說錯了：
 * **只有一種失敗是「沒有回應」**，權限被撤、Health Connect 需要更新都不是。
 *
 * 所以這裡做兩件事：判成幾個「使用者真的能據以行動」的原因，並把原始訊息壓成一行
 * 可回報的 Ref（`InlineState` 的 `referenceId`），不進正文。
 */

export type HealthFailureReason =
  /** 讀的當下權限被撤（例如在系統設定關掉後回到 App） */
  | 'permission'
  /** Health Connect 不在、被停用或版本太舊 */
  | 'unavailable'
  /** 呼叫超時或被系統中斷 */
  | 'timeout'
  | 'unknown';

export type HealthFailure = {
  reason: HealthFailureReason;
  /** 短技術摘要，給使用者回報用；不是給他讀的錯誤內容 */
  ref: string;
  /** 原始訊息：只留給診斷與 log，**不進使用者文案** */
  detail: string;
};

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Expo 的 `CodedException` 會把 code 放在 `e.code`，訊息則是人寫的字串。
 * 兩個都看：先看 code（穩定），再退回訊息比對（會隨 SDK 版本變）。
 */
export function classifyHealthError(e: unknown): HealthFailure {
  const detail = messageOf(e);
  const code = typeof (e as { code?: unknown })?.code === 'string' ? (e as { code: string }).code : null;
  const both = `${code ?? ''} ${detail}`;
  const reason: HealthFailureReason =
    /permission|denied|SecurityException|unauthori[sz]ed/i.test(both) ? 'permission'
    : /unavailable|not installed|provider.?update|SDK_UNAVAILABLE|disabled/i.test(both) ? 'unavailable'
    : /timeout|timed? ?out|deadline|interrupted/i.test(both) ? 'timeout'
    : 'unknown';
  // Ref 取 code；沒有 code 時取訊息的第一個詞組（不含可能的路徑或 stack）
  const short = code ?? ((detail.split(/[:\n]/)[0] ?? '').trim().slice(0, 40) || 'error');
  return { reason, ref: `${short} · healthRead`, detail };
}
