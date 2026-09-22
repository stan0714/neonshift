/**
 * COMP-W01：MWA session 中止策略（docs/store/competition-development-plan.md §3）。
 *
 * 現況：RN MWA 模組的 `invoke` 原生逾時 90 s；錢包簽完卻不回覆（Phantom on Seeker）時 App 會卡住到逾時。
 * 我們無法在 `transact` 回呼內安全地呼叫原生 `endSession`（transact 的 finally 會再呼叫一次，第二次會在原生層丟例外），
 * 所以採 JS 側守門：
 * - App 回到前景後 `foregroundGraceMs` 內錢包仍無回覆 → 以 WALLET_NO_REPLY 結束本次操作（結果未知，呼叫端須以「可能已送出」處理：
 *   打卡查 receipt、SKR 走 recover、登入重試）。
 * - 絕對上限 `hardTimeoutMs`（預設 120 s）避免任何情境無限等待。
 * - 逾時後原生 session 可能仍佔用互斥鎖直到錢包回覆或 90 s 逾時；`staleUntil()` 讓 UI 提示「上一個錢包工作階段尚未結束」。
 * - 晚到的結果一律丟棄（呼叫端以 revision／pending 訂單處理，不寫入登入或授權）。
 */
import { AppState, type AppStateStatus } from 'react-native';

import { WalletError } from '@/services/wallet/WalletService';

export const FOREGROUND_GRACE_MS = 8_000;
export const HARD_TIMEOUT_MS = 120_000;
/** 原生 invoke 逾時（SolanaMobileWalletAdapterModule.CLIENT_TIMEOUT_MS） */
export const NATIVE_CLIENT_TIMEOUT_MS = 90_000;

let staleSessionUntil = 0;
/** 上一個被放棄的 session 可能仍在原生層存活到此時間（ms epoch）；0＝無 */
export const staleUntil = (now: number = Date.now()) => (staleSessionUntil > now ? staleSessionUntil : 0);
export const _resetStaleForTests = () => { staleSessionUntil = 0; };

export type GuardOpts = { foregroundGraceMs?: number; hardTimeoutMs?: number; appState?: Pick<typeof AppState, 'addEventListener' | 'currentState'>; now?: () => number };

/**
 * 把一個 MWA 操作包起來：回前景寬限與硬逾時任一到期即 reject(WALLET_NO_REPLY)。
 * `op` 本身照常執行；逾時後其結果被忽略。
 */
export function guardWalletOp<T>(op: () => Promise<T>, opts: GuardOpts = {}): Promise<T> {
  const grace = opts.foregroundGraceMs ?? FOREGROUND_GRACE_MS;
  const hard = opts.hardTimeoutMs ?? HARD_TIMEOUT_MS;
  const appState = opts.appState ?? AppState;
  const now = opts.now ?? Date.now;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    const hardTimer = setTimeout(() => fail('hard_timeout'), hard);
    const sub = appState.addEventListener('change', (st: AppStateStatus) => {
      if (st === 'active') {
        // 回前景：錢包應已回覆；再給 grace，仍無 → 放棄
        if (graceTimer) clearTimeout(graceTimer);
        graceTimer = setTimeout(() => fail('foreground_grace'), grace);
      } else if (graceTimer) {
        // 又切去錢包（例如使用者手動切回錢包完成核准）：取消寬限
        clearTimeout(graceTimer);
        graceTimer = null;
      }
    });
    const cleanup = () => { clearTimeout(hardTimer); if (graceTimer) clearTimeout(graceTimer); sub.remove(); };
    const fail = (why: 'hard_timeout' | 'foreground_grace') => {
      if (settled) return;
      settled = true;
      cleanup();
      staleSessionUntil = now() + NATIVE_CLIENT_TIMEOUT_MS;
      reject(new WalletError('WALLET_NO_REPLY', why === 'foreground_grace' ? 'Wallet did not return a result after you came back to the app' : 'Wallet did not respond in time'));
    };
    op().then(
      (v) => { if (settled) return; settled = true; cleanup(); staleSessionUntil = 0; resolve(v); },
      (e) => { if (settled) return; settled = true; cleanup(); reject(e); },
    );
  });
}
