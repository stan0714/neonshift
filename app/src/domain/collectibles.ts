/**
 * 成就收藏目錄（FR-04.6、SD 3.2／11A、Style 12）。
 * kind 與資格規則必須和 programs/neonshift-core/src/instructions/claim_collectible.rs 一致；
 * 這裡只決定 UI 的 Claimed／Claimable／Locked，鏈上才是權威（不合格會以 6029 拒絕）。
 */
import type { PlayerProfile } from '@/chain/accounts';
import { SHOE_PROGRESSION, type ShoeLevel } from '@/config/shoeProgression';
import type { TKey } from '@/i18n';

type Translate = (key: TKey, params?: Record<string, string | number>) => string;

export type CollectibleKind = 1 | 2 | 3 | 4 | 5 | 101 | 102 | 111 | 112 | 113;
export type CollectibleStatus = 'claimed' | 'claimable' | 'locked';

export type Collectible = {
  kind: CollectibleKind;
  group: 'shoe' | 'badge';
  /** i18n key（PG-A-23）；以 `collectibleName()` 取得顯示名稱 */
  nameKey: TKey;
  /** Locked 時顯示的解鎖條件（Style 12：`Reach Lv.3`、`7-day streak`）的 i18n key */
  unlockKey: TKey;
  shoeLevel?: ShoeLevel;
  icon: 'zap' | 'calendar' | 'award';
};

export const COLLECTIBLES: readonly Collectible[] = [
  ...SHOE_PROGRESSION.stages.map((s) => ({ kind: s.level as CollectibleKind, group: 'shoe' as const, nameKey: 'col.shoe' as TKey, unlockKey: (s.level === 1 ? 'col.starter' : 'col.reachLv') as TKey, shoeLevel: s.level as ShoeLevel, icon: 'zap' as const })),
  { kind: 101, group: 'badge', nameKey: 'col.firstClockIn', unlockKey: 'col.firstClockIn.unlock', icon: 'zap' },
  { kind: 102, group: 'badge', nameKey: 'col.streak7', unlockKey: 'col.streak7.unlock', icon: 'calendar' },
  { kind: 111, group: 'badge', nameKey: 'col.arena1', unlockKey: 'col.arena1.unlock', icon: 'award' },
  { kind: 112, group: 'badge', nameKey: 'col.arena2', unlockKey: 'col.arena2.unlock', icon: 'award' },
  { kind: 113, group: 'badge', nameKey: 'col.arena3', unlockKey: 'col.arena3.unlock', icon: 'award' },
];

/** 五階名稱／描述（Style 16.2）依 locale */
export const stageName = (t: Translate, level: ShoeLevel) => t(`col.stage.${level}` as TKey);
export const stageDetail = (t: Translate, level: ShoeLevel) => t(`col.detail.${level}` as TKey);
export const collectibleName = (t: Translate, c: Collectible) => (c.shoeLevel ? t('col.shoe', { stage: stageName(t, c.shoeLevel) }) : t(c.nameKey));
export const collectibleUnlock = (t: Translate, c: Collectible) => (c.shoeLevel && c.shoeLevel > 1 ? t('col.reachLv', { n: c.shoeLevel }) : t(c.unlockKey));

/** 對應鏈上 `eligible()`：跑鞋 kind ≤ shoe_level、首次打卡 xp > 0、7 天用 max_streak_days；名次待 C-14 */
export function isEligible(profile: PlayerProfile | null, kind: CollectibleKind): boolean {
  if (!profile) return false;
  if (kind >= 1 && kind <= 5) return profile.shoeLevel >= kind;
  if (kind === 101) return profile.xp > 0n;
  if (kind === 102) return profile.maxStreakDays >= 7;
  return false;
}

export function collectibleStatus(profile: PlayerProfile | null, claimed: ReadonlySet<number>, kind: CollectibleKind): CollectibleStatus {
  if (claimed.has(kind)) return 'claimed';
  return isEligible(profile, kind) ? 'claimable' : 'locked';
}

/** metadata URI（SD 11A：`<base>/<kind>.json`），與程式常數 COLLECTIBLE_BASE_URI 一致 */
export const collectibleUri = (siteUrl: string, kind: CollectibleKind) => `${siteUrl}/nft/${kind}.json`;
