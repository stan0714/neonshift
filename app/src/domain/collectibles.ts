/**
 * 成就收藏目錄（FR-04.6、SD 3.2／11A、Style 12）。
 * kind 與資格規則必須和 programs/neonshift-core/src/instructions/claim_collectible.rs 一致；
 * 這裡只決定 UI 的 Claimed／Claimable／Locked，鏈上才是權威（不合格會以 6029 拒絕）。
 */
import type { PlayerProfile } from '@/chain/accounts';
import { SHOE_PROGRESSION, type ShoeLevel } from '@/config/shoeProgression';

export type CollectibleKind = 1 | 2 | 3 | 4 | 5 | 101 | 102 | 111 | 112 | 113;
export type CollectibleStatus = 'claimed' | 'claimable' | 'locked';

export type Collectible = {
  kind: CollectibleKind;
  group: 'shoe' | 'badge';
  name: string;
  /** Locked 時顯示的解鎖條件（Style 12：`Reach Lv.3`、`7-day streak`） */
  unlock: string;
  shoeLevel?: ShoeLevel;
  icon: 'zap' | 'calendar' | 'award';
};

export const COLLECTIBLES: readonly Collectible[] = [
  ...SHOE_PROGRESSION.stages.map((s) => ({ kind: s.level as CollectibleKind, group: 'shoe' as const, name: `Shoe · ${s.name}`, unlock: s.level === 1 ? 'Starter shoe' : `Reach Lv.${s.level}`, shoeLevel: s.level as ShoeLevel, icon: 'zap' as const })),
  { kind: 101, group: 'badge', name: 'First Clock-In', unlock: 'Claim any mission once', icon: 'zap' },
  { kind: 102, group: 'badge', name: '7-Day Streak', unlock: '7-day streak', icon: 'calendar' },
  { kind: 111, group: 'badge', name: 'Arena #1', unlock: 'Win a tournament', icon: 'award' },
  { kind: 112, group: 'badge', name: 'Arena #2', unlock: 'Tournament 2nd place', icon: 'award' },
  { kind: 113, group: 'badge', name: 'Arena #3', unlock: 'Tournament 3rd place', icon: 'award' },
];

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
