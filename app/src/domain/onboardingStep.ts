/**
 * 連上錢包之後該去哪一步（2026-09-30）。
 *
 * 修正前：`WalletConnectScreen` 連線成功就無條件 `navigate('HealthAccess')`，
 * 後面每一頁也各自寫死下一頁——於是**斷線重連的人會被迫再走一次四步新手流程**，
 * 即使權限早就給了、起始鞋也早就有了。實機上使用者的第一個反應就是問這是不是正常的。
 *
 * 判斷依據分兩種，不能混為一談：
 * - **權限是裝置層的**（健康、活動辨識）：換錢包不會讓權限消失，所以看本機 flags。
 * - **起始鞋是錢包層的**：同一支手機換一個錢包就是新的玩家，所以看**鏈上 profile 是否存在**，
 *   而不是看本機的 `shoeMinted`（那個 flag 不分錢包，會把新錢包誤判成已經領過）。
 *
 * 「稍後再說」（deferred）也算處理過：Style 10.2 明寫不可反覆彈出。
 */
export type OnboardingStep = 'HealthAccess' | 'ActivityRecognition' | 'StarterShoe' | 'Main';

export type OnboardingState = {
  healthGranted: boolean;
  healthDeferred: boolean;
  activityGranted: boolean;
  activityDeferred: boolean;
};

/**
 * `profileExists` 為 `null` 代表查不到（離線、RPC 失敗）。這時**寧可帶去起始鞋那一頁**，
 * 因為那一頁自己會再查一次、已存在也不會送交易；反過來若誤判成「已經有了」而直接進 App，
 * 真正的新使用者就永遠拿不到起始鞋。
 */
export function nextOnboardingStep(state: OnboardingState, opts: { profileExists: boolean | null }): OnboardingStep {
  if (!state.healthGranted && !state.healthDeferred) return 'HealthAccess';
  if (!state.activityGranted && !state.activityDeferred) return 'ActivityRecognition';
  if (opts.profileExists === true) return 'Main';
  return 'StarterShoe';
}
