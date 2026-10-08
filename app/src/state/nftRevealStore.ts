import { create } from 'zustand';
import type { CollectibleKind } from '@/domain/collectibles';
/**
 * 一次揭曉要畫什麼。
 *
 * `seasonal`（PG-SEASON-04）帶的是**主題與年份**，不是圖檔位址：節日徽章是程序繪製的
 * （`SeasonalBadge`），所以揭曉時不必連網也畫得出來，翻過來看到的就是收藏頁上同一枚。
 * 只帶 `title` 時會落到通用獎章圖示——那是給沒有專屬美術的收藏用的。
 */
type Reward = { id: string; collectible?: CollectibleKind; title?: string; milestone?: 'first_5k' | 'first_10k' | 'first_half' | 'first_marathon' | 'first_finish'; seasonal?: { themeId: string; year: number } };
export const useNftRevealStore = create<{ queue: Reward[]; enqueue: (reward: Reward) => void; dismiss: () => void }>((set) => ({
  queue: [],
  enqueue: reward => set(s => ({ queue: s.queue.some(r => r.id === reward.id) ? s.queue : [...s.queue, reward] })),
  dismiss: () => set(s => ({ queue: s.queue.slice(1) })),
}));
