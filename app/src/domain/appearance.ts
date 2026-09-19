/**
 * 跑鞋外觀（PG-LINK-01，docs/shoe-sync-activity.md §2）：外觀選擇與 Active level 分開。
 * - 取得＝曾真正達到該階（鏈上 highest_level／shoe_level），只有 XP 達門檻不算；Lv.1 原點人人擁有。
 * - 曾取得的外觀在正常降級後仍可用；倍率與新資格只看有效等級（不在此模組處理）。
 * - 尚未發行的系列不列入；NFT 轉入不自動授予鞋款（取得紀錄以鏈上 profile 為權威）。
 */
import type { PlayerProfile } from '@/chain/accounts';
import { DEFAULT_SHOE_SERIES, shoeVariant, type ShoeSeriesId, type ShoeVariant } from '@/config/shoeCollection';
import type { ShoeLevel } from '@/config/shoeProgression';

export type OwnedShoe = {
  /** `${series}:${level}` */
  id: string;
  seriesId: ShoeSeriesId;
  level: ShoeLevel;
  /** 固定分配的款式（Lv.1 無款式） */
  variant: ShoeVariant | null;
  entitlementSource: 'starter' | 'chain_level';
};

/** 曾取得的最高階（鏈上 highest_level 與目前 shoe_level 取大者）；無 profile → 1 */
export const highestOwnedLevel = (profile: PlayerProfile | null): ShoeLevel => {
  if (!profile) return 1;
  const h = Math.max(profile.highestLevel ?? 1, profile.shoeLevel, 1);
  return Math.min(5, h) as ShoeLevel;
};

/** 有效等級（倍率與資格用）：core_level */
export const activeLevel = (profile: PlayerProfile | null): ShoeLevel => (profile ? (Math.min(5, Math.max(1, profile.coreLevel || 1)) as ShoeLevel) : 1);

export function ownedShoes(owner: string | null, profile: PlayerProfile | null, series: ShoeSeriesId = DEFAULT_SHOE_SERIES): OwnedShoe[] {
  const top = highestOwnedLevel(profile);
  const out: OwnedShoe[] = [];
  for (let level = 1; level <= top; level++) {
    const l = level as ShoeLevel;
    out.push({ id: shoeId(series, l), seriesId: series, level: l, variant: shoeVariant(owner, l, series), entitlementSource: l === 1 ? 'starter' : 'chain_level' });
  }
  return out;
}

export const shoeId = (series: ShoeSeriesId, level: ShoeLevel) => `${series}:${level}`;
export const levelOfShoeId = (id: string | null): ShoeLevel | null => {
  if (!id) return null;
  const n = Number(id.split(':').pop());
  return n >= 1 && n <= 5 ? (n as ShoeLevel) : null;
};

/**
 * 顯示用外觀等級：有明確選擇且仍擁有 → 該鞋；否則跟隨有效等級。
 * 選擇的鞋若已不再擁有（換帳號／資料不一致）視同未選擇，不套用未取得的外觀。
 */
export function appearanceLevel(profile: PlayerProfile | null, selectedShoeId: string | null): ShoeLevel {
  const chosen = levelOfShoeId(selectedShoeId);
  if (chosen !== null && chosen <= highestOwnedLevel(profile)) return chosen;
  return activeLevel(profile);
}

/** 場景（§2 表）：Lv.1 原點＝基本背景（null） */
export type HabitatSceneKind = 'forest' | 'ocean' | 'jungle' | 'snow';
export const sceneOf = (level: ShoeLevel): HabitatSceneKind | null => (level === 2 ? 'forest' : level === 3 ? 'ocean' : level === 4 ? 'jungle' : level === 5 ? 'snow' : null);

/** 記錄用鞋款快照（session 開始時寫入，之後切鞋不回寫） */
export type ShoeSnapshot = { shoeId: string; level: ShoeLevel; variant: ShoeVariant | null };
export const shoeSnapshotOf = (owner: string | null, profile: PlayerProfile | null, selectedShoeId: string | null): ShoeSnapshot | null => {
  if (!owner || !profile) return null; // 未綁定玩家：標未指定，不推算
  const level = appearanceLevel(profile, selectedShoeId);
  return { shoeId: shoeId(DEFAULT_SHOE_SERIES, level), level, variant: shoeVariant(owner, level) };
};
