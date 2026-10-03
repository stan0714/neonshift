import { ApiError } from './ApiClient';
import type { TKey } from '@/i18n';

type T = (key: TKey, params?: Record<string, string | number>) => string;

/** 網路層的原始字串（RN fetch、OkHttp、Node） */
const NETWORK_RE = /fetch failed|network request failed|failed to fetch|unable to resolve host|UnknownHost|ENOTFOUND|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|socket|SSLHandshake|connection (?:refused|reset|abort)/i;
const SLOW_RE = /timeout after \d+ ms|timed? ?out\b|ETIMEDOUT|SocketTimeout/i;
/** 鏈上送交易失敗的原始字串（web3.js／Anchor） */
const CHAIN_RE = /custom program error|transaction simulation failed|error processing instruction|InstructionError|AnchorError|blockhash not found|block height exceeded|Program log:/i;
/** 其他看起來是程式內部的字串：Java／Kotlin 例外、JS 執行期錯誤、JSON、堆疊 */
const TECHNICAL_RE = /\bjava\.|\bkotlin\.|\bandroid\.|Exception\b|TypeError|ReferenceError|SyntaxError|RangeError|undefined is not|null is not|cannot read propert|is not a function|unexpected token|JSON|[{}[\]<>]|\n\s+at /i;

/**
 * 給畫面顯示的錯誤訊息（雙語）。原則：使用者看得懂才原樣顯示，否則換成白話說明。
 *
 * - 2026-09-22 Gallery 顯示 "aborted Nothing changed."
 * - 2026-10-03 離線時 Arena 印出 `fetch failed: java.net.UnknownHostException: Unable to resolve host…`
 *
 * 後端的 message 是給工程師看的（"internal error"、"must be ≤ 5"），所以 ApiError 一律依狀態分類，不直接顯示。
 * 傳入字串也可以（store 只存了 message 的情況）；已經是白話的字串會原樣回傳，重複套用結果不變。
 */
export function apiErrorText(t: T, e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'NETWORK_ERROR') {
      const m = /timeout after (\d+) ms/.exec(e.message);
      if (e.netReason === 'timeout' || m) return t('common.net.timeout', { s: Math.round(Number(m?.[1] ?? 15000) / 1000) });
      if (e.netReason === 'aborted') return t('common.net.aborted');
      return t('common.net.unreachable');
    }
    if (e.code === 'RATE_LIMITED' || e.status === 429) return t('common.err.busy');
    if (e.code === 'NO_SESSION' || e.status === 401) return t('common.err.session');
    if (e.code === 'SERVER_ERROR' || e.code === 'INTERNAL' || e.status >= 500) return t('common.err.server');
    return t('common.err.rejected');
  }
  const raw = (e instanceof Error ? e.message : typeof e === 'string' ? e : String(e ?? '')).trim();
  if (!raw) return t('common.err.unexpected');
  if (SLOW_RE.test(raw)) return t('common.net.slow');
  if (NETWORK_RE.test(raw)) return t('common.net.unreachable');
  if (CHAIN_RE.test(raw)) return t('common.err.chain');
  if (TECHNICAL_RE.test(raw) || raw.length > 160) return t('common.err.unexpected');
  return raw;
}

/** 同上，名稱給非 API 的錯誤用（錢包、鏈上、本機） */
export const userErrorText = apiErrorText;
