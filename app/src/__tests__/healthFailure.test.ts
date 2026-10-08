/**
 * 健康資料讀取失敗的分類（2026-09-29）。
 *
 * 這是 504 那張卡的同一個錯誤重演：`home.healthErr.body` 原本把原生模組的例外訊息
 * 用 `{error}` 插進使用者文案，而且那句話還說「Health Connect 沒有回應」——
 * 只有一種失敗是那樣，權限被撤與版本太舊都不是。
 */
import { classifyHealthError } from '@/domain/healthFailure';

class Coded extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

test('權限被撤：從 code 或訊息都判得出來', () => {
  expect(classifyHealthError(new Coded('ERR_HEALTH_PERMISSION', 'missing read permission')).reason).toBe('permission');
  expect(classifyHealthError(new Error('java.lang.SecurityException: not allowed')).reason).toBe('permission');
  expect(classifyHealthError(new Error('Permission denied for StepsRecord')).reason).toBe('permission');
});

test('Health Connect 不可用（沒安裝／停用／版本太舊）', () => {
  expect(classifyHealthError(new Error('SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED')).reason).toBe('unavailable');
  expect(classifyHealthError(new Error('Health Connect is not installed')).reason).toBe('unavailable');
  expect(classifyHealthError(new Coded('ERR_UNAVAILABLE', 'disabled by user')).reason).toBe('unavailable');
});

test('逾時與被中斷', () => {
  expect(classifyHealthError(new Error('Operation timed out')).reason).toBe('timeout');
  expect(classifyHealthError(new Error('java.lang.InterruptedException')).reason).toBe('timeout');
});

test('認不出來的就是 unknown，不亂猜', () => {
  expect(classifyHealthError(new Error('android.os.DeadObjectException')).reason).toBe('unknown');
  expect(classifyHealthError('something odd').reason).toBe('unknown');
});

test('原始訊息只留在 detail；ref 是一行短摘要，不含整段例外', () => {
  const long = 'java.lang.RuntimeException: Unable to read StepsRecord from provider com.google.android.apps.healthdata because of a very long internal message that should never reach the UI';
  const f = classifyHealthError(new Error(long));
  expect(f.detail).toBe(long);
  expect(f.ref.length).toBeLessThanOrEqual(60);
  expect(f.ref).not.toContain('com.google.android.apps.healthdata');
  expect(f.ref.endsWith('· healthRead')).toBe(true);
});

test('有 code 時 ref 用 code（穩定，不隨 SDK 訊息改變）', () => {
  expect(classifyHealthError(new Coded('ERR_HEALTH_PERMISSION', 'x')).ref).toBe('ERR_HEALTH_PERMISSION · healthRead');
});

test('空訊息也要有 ref，不能是空字串', () => {
  expect(classifyHealthError(new Error('')).ref).toBe('error · healthRead');
});
