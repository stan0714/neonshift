/**
 * 藝廊投影（PG-G-01，SD 11A）：只吃 finalized 事件（ChainIndexer projection）。
 * PlayerInitialized → 建立玩家；ClockedIn → 等級／XP／連續；EpochSettled → 期末等級（PG-V-02）；CollectibleClaimed → 收藏。
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
    case "EpochSettled": {
      // PG-V-02：期末結算切換 Active level（shoe_level／core_level 同步）；其餘欄位沿用目前投影
      const cur = await store.getGalleryPlayer(wallet);
      const lvl = num(p.level_after) || 1;
      await store.upsertGalleryPlayer({ wallet, shoeLevel: lvl, coreLevel: lvl, xp: cur?.xp ?? 0n, streakDays: cur?.streakDays ?? 0, maxStreakDays: cur?.maxStreakDays ?? 0, lastTaskDate: cur?.lastTaskDate ?? null, slot: ev.slot }, now);
      return;
    }
    case "CollectibleClaimed":
      if (!(await store.getGalleryPlayer(wallet))) await store.upsertGalleryPlayer({ wallet, shoeLevel: 1, coreLevel: 1, xp: 0n, streakDays: 0, maxStreakDays: 0, lastTaskDate: null, slot: 0 }, now);
      await store.insertGalleryCollectible({ wallet, kind: num(p.kind), asset: p.asset as string, signature: ev.signature, slot: ev.slot, claimedAt: now });
      return;
    case "AchievementClaimed": {
      // PG-R-08：finalized 才標 minted（索引尚未確認不顯示已鑄造）
      const id = String(p.achievement_id);
      const cur = await store.getAchievement(id);
      if (cur && cur.mintedSignature !== ev.signature) await store.setAchievementStatus(id, cur.status === "revoked" || cur.status === "revoke_pending" ? cur.status : "minted", { asset: p.asset as string, mintedSignature: ev.signature }, now);
      return;
    }
    default:
      return;
  }
};
