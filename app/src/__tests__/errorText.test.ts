/**
 * 錯誤訊息一律白話（2026-10-03）。離線時 Arena 卡片印出 `fetch failed: java.net.UnknownHostException…`，
 * 掃過整個 App 後統一經過 apiErrorText：看得懂才原樣顯示，否則依類型換成說明。
 */
import { ApiError } from '@/services/api/ApiClient';
import { apiErrorText } from '@/services/api/errorText';
import { t } from '@/i18n';

const REAL = 'fetch failed: java.net.UnknownHostException: Unable to resolve host "api.neonshift.cc": No address associated with hostname';

test.each([
  ['實機離線原文（字串）', REAL, 'Could not reach the server. Check your connection.'],
  ['同一句包在 Error 裡', new Error(REAL), 'Could not reach the server. Check your connection.'],
  ['RN fetch', new TypeError('Network request failed'), 'Could not reach the server. Check your connection.'],
  ['逾時字串', 'java.net.SocketTimeoutException: timeout', 'The server took too long to respond.'],
  ['鏈上程式錯誤', 'failed to send transaction: Transaction simulation failed: Error processing Instruction 0: custom program error: 0x1771', 'The Solana network did not accept the transaction.'],
  ['Java 例外', 'java.util.concurrent.CancellationException', 'Something unexpected went wrong.'],
  ['JS 執行期錯誤', new TypeError("Cannot read properties of undefined (reading 'x')"), 'Something unexpected went wrong.'],
  ['JSON 片段', '504 : {"jsonrpc":"2.0","error":{"code":504}}', 'Something unexpected went wrong.'],
  ['空字串', '', 'Something unexpected went wrong.'],
])('%s', (_label, input, expected) => {
  expect(apiErrorText(t, input)).toBe(expected);
});

test('後端錯誤依狀態分類，不顯示給工程師看的 message', () => {
  expect(apiErrorText(t, new ApiError(500, 'INTERNAL', 'internal error'))).toBe('The server ran into a problem on its side.');
  expect(apiErrorText(t, new ApiError(503, 'SERVER_ERROR', 'upstream connect error'))).toBe('The server ran into a problem on its side.');
  expect(apiErrorText(t, new ApiError(429, 'RATE_LIMITED', 'too many requests'))).toBe('The server is busy right now. Wait a moment and try again.');
  expect(apiErrorText(t, new ApiError(401, 'NO_SESSION', 'Sign in required'))).toBe('Your sign-in has expired. Sign in again to continue.');
  expect(apiErrorText(t, new ApiError(400, 'VALIDATION', 'must be ≤ 5'))).toBe("The server couldn't accept this request.");
});

test('已經是白話的句子原樣保留；重複套用結果不變', () => {
  const friendly = 'Your wallet did not respond. Open it and try again.';
  expect(apiErrorText(t, friendly)).toBe(friendly);
  const once = apiErrorText(t, REAL);
  expect(apiErrorText(t, once)).toBe(once);
});
