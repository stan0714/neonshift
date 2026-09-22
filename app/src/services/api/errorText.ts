import { ApiError } from './ApiClient';
import type { TKey } from '@/i18n';

type T = (key: TKey, params?: Record<string, string | number>) => string;

/**
 * 給畫面顯示的錯誤訊息：NETWORK_ERROR 依 netReason 轉成看得懂的雙語文案（逾時／取消／連不上），
 * 其他錯誤沿用後端 message（實機 2026-09-22：Gallery 顯示 "aborted Nothing changed." 讓人看不懂）。
 */
export function apiErrorText(t: T, e: unknown): string {
  if (e instanceof ApiError && e.code === 'NETWORK_ERROR') {
    const m = /timeout after (\d+) ms/.exec(e.message);
    if (e.netReason === 'timeout' || m) return t('common.net.timeout', { s: Math.round(Number(m?.[1] ?? 15000) / 1000) });
    if (e.netReason === 'aborted') return t('common.net.aborted');
    return t('common.net.unreachable');
  }
  return e instanceof Error ? e.message : String(e);
}
