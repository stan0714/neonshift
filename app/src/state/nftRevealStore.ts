import { create } from 'zustand';
import type { CollectibleKind } from '@/domain/collectibles';
type Reward = { id: string; collectible?: CollectibleKind; title?: string; milestone?: 'first_5k' | 'first_10k' | 'first_half' | 'first_marathon' | 'first_finish' };
export const useNftRevealStore = create<{ queue: Reward[]; enqueue: (reward: Reward) => void; dismiss: () => void }>((set) => ({
  queue: [],
  enqueue: reward => set(s => ({ queue: s.queue.some(r => r.id === reward.id) ? s.queue : [...s.queue, reward] })),
  dismiss: () => set(s => ({ queue: s.queue.slice(1) })),
}));
