/**
 * 藝廊投影（PG-G-01，SD 11A）：只吃 finalized 事件（ChainIndexer projection）。
 * PlayerInitialized → 建立玩家；ClockedIn → 等級／XP／連續；CollectibleClaimed → 收藏。
 * 全部以 slot 做單調保護與 (wallet, kind) 冪等，重放不會重複計數。
 */
import type { Projection } from "../indexer/indexer.js";

const num = (v: unknown) => Number(v ?? 0);

export const galleryProjection: Projection = async (ev, store, now) => {
  const p = ev.payload;
  const wallet = p.wallet as string;
  switch (ev.name) {
    case "PlayerInitialized": {
      const existing = await store.getGalleryPlayer(wallet);
      if (existing) return; // 已由較新的 ClockedIn 建立
      await store.upsertGalleryPlayer({ wallet, shoeLevel: num(p.shoe_level) || 1, coreLevel: 1, xp: 0n, streakDays: 0, maxStreakDays: 0, lastTaskDate: null, slot: ev.slot }, now);
      return;
    }
    case "ClockedIn":
      await store.upsertGalleryPlayer({ wallet, shoeLevel: num(p.shoe_level) || 1, coreLevel: num(p.core_level) || 1, xp: BigInt(String(p.xp ?? "0")), streakDays: num(p.streak_days), maxStreakDays: Math.max(num(p.max_streak_days), num(p.streak_days)), lastTaskDate: num(p.task_date), slot: ev.slot }, now);
      return;
    case "CollectibleClaimed":
      if (!(await store.getGalleryPlayer(wallet))) await store.upsertGalleryPlayer({ wallet, shoeLevel: 1, coreLevel: 1, xp: 0n, streakDays: 0, maxStreakDays: 0, lastTaskDate: null, slot: 0 }, now);
      await store.insertGalleryCollectible({ wallet, kind: num(p.kind), asset: p.asset as string, signature: ev.signature, slot: ev.slot, claimedAt: now });
      return;
    default:
      return;
  }
};
