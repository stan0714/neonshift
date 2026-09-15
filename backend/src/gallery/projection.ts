/**
 * 藝廊投影（PG-G-01，SD 11A）：只吃 finalized 事件（ChainIndexer projection）。
 * PlayerInitialized → 建立玩家；ClockedIn → 等級／XP／連續；EpochSettled → 期末等級（PG-V-02）；CollectibleClaimed → 收藏。
 * 全部以 slot 做單調保護與 (wallet, kind) 冪等，重放不會重複計數。
 */
import type { Projection } from "../indexer/indexer.js";

const num = (v: unknown) => Number(v ?? 0);

const dayOf = (d: Date) => Math.floor(d.getTime() / 86_400_000);

export const galleryProjection: Projection = async (ev, store, now) => {
  const p = ev.payload;
  const wallet = p.wallet as string;
  switch (ev.name) {
    case "PlayerInitialized": {
      // PG-V-03：歷史等級起點 Lv1（自投影確認日起；init 當日的鏈上日序未在事件內，以 finalized 時間近似）
      await store.insertLevelHistory({ wallet, effectiveFromDate: dayOf(now), activeLevel: 1, highestLevel: 1, epoch: null, source: "init", signature: ev.signature, slot: ev.slot });
      const existing = await store.getGalleryPlayer(wallet);
      if (existing) return; // 已由較新的 ClockedIn 建立
      await store.upsertGalleryPlayer({ wallet, shoeLevel: num(p.shoe_level) || 1, coreLevel: 1, xp: 0n, streakDays: 0, maxStreakDays: 0, lastTaskDate: null, slot: ev.slot }, now);
      return;
    }
    case "PlayerMigrated": {
      // PG-V-02／V-03：遷移保留等級；自 epoch_anchor 當日起可查
      const lvl = num(p.active_level) || 1;
      const hi = Math.max(lvl, num(p.highest_level) || 1);
      await store.insertLevelHistory({ wallet, effectiveFromDate: num(p.epoch_anchor), activeLevel: lvl, highestLevel: hi, epoch: null, source: "migrate", signature: ev.signature, slot: ev.slot });
      await store.setGalleryHighestLevel(wallet, hi, ev.slot, now);
      return;
    }
    case "ClockedIn":
      await store.upsertGalleryPlayer({ wallet, shoeLevel: num(p.shoe_level) || 1, coreLevel: num(p.core_level) || 1, xp: BigInt(String(p.xp ?? "0")), streakDays: num(p.streak_days), maxStreakDays: Math.max(num(p.max_streak_days), num(p.streak_days)), lastTaskDate: num(p.task_date), slot: ev.slot }, now);
      return;
    case "EpochSettled": {
      // PG-V-02：期末結算切換 Active level（shoe_level／core_level 同步）；其餘欄位沿用目前投影
      const cur = await store.getGalleryPlayer(wallet);
      const lvl = num(p.level_after) || 1;
      const hi = Math.max(lvl, num(p.highest_level) || 1);
      await store.upsertGalleryPlayer({ wallet, shoeLevel: lvl, coreLevel: lvl, xp: cur?.xp ?? 0n, streakDays: cur?.streakDays ?? 0, maxStreakDays: cur?.maxStreakDays ?? 0, lastTaskDate: cur?.lastTaskDate ?? null, slot: ev.slot }, now);
      await store.setGalleryHighestLevel(wallet, hi, ev.slot, now);
      // PG-V-03：歷史等級自結算日起生效（settled_at 為鏈上時間）
      const settledAt = Number(String(p.settled_at ?? "0"));
      await store.insertLevelHistory({ wallet, effectiveFromDate: settledAt > 0 ? Math.floor(settledAt / 86_400) : dayOf(now), activeLevel: lvl, highestLevel: hi, epoch: num(p.epoch), source: "epoch", signature: `${ev.signature}:${num(p.epoch)}`, slot: ev.slot });
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
