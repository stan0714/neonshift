/**
 * GPS 精度門檻（單一來源）。
 *
 * 2026-09-19 review：接受門檻放寬到 50 m 後，摘要文案仍寫 20 m、狀態列與自動繼續另有 20 m 判斷，
 * 三個數值散落三處。這裡把三種語意分開命名，其他地方一律引用，文案由這裡的數值產生。
 *
 * - `acceptMaxAccuracyM`：引擎「可採用」門檻。精度超過此值的點不計入距離（engine `low_accuracy`）。
 *   實機：無 SIM（無 A-GPS）戶外跑道精度長期 > 20 m，故為 50 m；抖動由 0.6 × 精度的遲滯門檻抑制。
 * - `goodAccuracyM`：「品質良好」門檻。狀態列 ok／poor 的分界；只影響顯示，不影響距離。
 * - `autoResumeMaxAccuracyM`：「允許自動恢復」門檻。自動暫停中，只有精度在此值內的點才可觸發自動繼續，
 *   避免精度差時的飄移把暫停解除。
 */
export const GPS_QUALITY = {
  acceptMaxAccuracyM: 50,
  goodAccuracyM: 20,
  autoResumeMaxAccuracyM: 20,
} as const;
