import { SHARE_KINDS, SHARE_SOURCES, type ShareKind, type ShareSource } from '@/domain/shareImage';

/**
 * 分享連結落地的去向（PG-SHARE-04）。抽成純函式才測得出「未知 kind 不亂猜」。
 * `Main` 代表回到分頁首頁（gear／guardian 落在 Gear 分頁）。
 */
export type ShareLandingTarget = { screen: 'Workouts' | 'Gallery' | 'Passport' } | { screen: 'Main'; tab?: 'Gear' };

const TARGETS: Record<ShareKind, ShareLandingTarget> = {
  workout: { screen: 'Workouts' },
  achievement: { screen: 'Gallery' },
  passport: { screen: 'Passport' },
  gear: { screen: 'Main', tab: 'Gear' },
  guardian: { screen: 'Main', tab: 'Gear' },
};

const isKind = (k: string): k is ShareKind => (SHARE_KINDS as readonly string[]).includes(k);

/** 未知 kind（打錯、舊連結、被改過的 query）一律回首頁，不猜測意圖 */
export function shareLandingTarget(kind: string | undefined): ShareLandingTarget {
  return kind && isKind(kind) ? TARGETS[kind] : { screen: 'Main' };
}

/** source 只接受允許清單內的值；其餘丟掉，不往下傳（§6.2） */
export function shareLandingSource(source: string | undefined): ShareSource | null {
  return source && (SHARE_SOURCES as readonly string[]).includes(source) ? (source as ShareSource) : null;
}
