/**
 * 2026-09-30 實機：斷線重連後又被迫重走一次四步新手流程。
 * 權限是裝置層的、起始鞋是錢包層的——兩者的判斷依據不同，不能混為一談。
 */
import { nextOnboardingStep } from '@/domain/onboardingStep';

const done = { healthGranted: true, healthDeferred: false, activityGranted: true, activityDeferred: false };
const fresh = { healthGranted: false, healthDeferred: false, activityGranted: false, activityDeferred: false };

test('全新使用者：從健康那一步開始', () => {
  expect(nextOnboardingStep(fresh, { profileExists: false })).toBe('HealthAccess');
});

test('權限給過、鏈上已有 profile → 直接進 App，不重走', () => {
  expect(nextOnboardingStep(done, { profileExists: true })).toBe('Main');
});

test('同一支手機換新錢包：權限跳過，但仍要領起始鞋', () => {
  expect(nextOnboardingStep(done, { profileExists: false })).toBe('StarterShoe');
});

test('「稍後再說」也算處理過（Style 10.2：不可反覆彈出）', () => {
  const deferred = { healthGranted: false, healthDeferred: true, activityGranted: false, activityDeferred: true };
  expect(nextOnboardingStep(deferred, { profileExists: true })).toBe('Main');
});

test('健康給了但活動還沒問 → 停在活動那一步', () => {
  expect(nextOnboardingStep({ ...fresh, healthGranted: true }, { profileExists: true })).toBe('ActivityRecognition');
});

test('查不到 profile（離線／RPC 失敗）→ 帶去起始鞋那一頁，不要誤判成已擁有', () => {
  expect(nextOnboardingStep(done, { profileExists: null })).toBe('StarterShoe');
});
