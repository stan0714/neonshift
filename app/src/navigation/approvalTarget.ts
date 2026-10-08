/**
 * 成就核准通知按下「查看」之後該去哪裡（R4，2026-09-29 review）。
 *
 * 抽成純函式的理由跟 `shareLanding.ts` 一樣：導向對不對可以用單元測試釘住，
 * 不必開畫面點一次。而且用 `Record<AchievementKind, …>` 宣告，**之後後端多一種 kind
 * 而這裡沒決定去哪，會直接編譯失敗**——R4 發生的原因之一就是 App 的型別裡
 * 根本沒有 `seasonal`，於是它靜悄悄落進 `else`。
 *
 * 各 kind 的領取 UI 實際位置（這是判斷依據，不是猜的）：
 *   pb        → `PersonalBests`，掛在 `WorkoutsScreen`
 *   milestone → `Milestones`，掛在 **GearScreen** 的收藏區
 *   seasonal  → `SeasonalFootprints`，同樣在 **GearScreen**
 *   event     → `EventDetail`
 *
 * 修正前 event 以外一律 `push('Workouts')`，所以 milestone 與 seasonal 都會把人
 * 帶到沒有領取按鈕的頁面。首次 5K／10K 這類里程碑正是跑完一趟最常見的核准。
 */
import type { GearCategory } from '@/navigation/types';

export type AchievementKind = 'pb' | 'milestone' | 'event' | 'seasonal';

export type ApprovalTarget =
  | { screen: 'Workouts' }
  | { screen: 'Main'; tab: 'Gear'; category: GearCategory }
  | { screen: 'EventDetail'; idOrSlug: string }
  | { screen: 'Events' };

const BY_KIND: Record<AchievementKind, ApprovalTarget> = {
  pb: { screen: 'Workouts' },
  milestone: { screen: 'Main', tab: 'Gear', category: 'milestones' },
  seasonal: { screen: 'Main', tab: 'Gear', category: 'seasonal' },
  // event 需要 id，實際目標在下面依 milestone_key 決定
  event: { screen: 'Events' },
};

/**
 * `milestone_key` 的格式是 `<kind>|<id>`（例如 `event|<eventId>`、`seasonal|<campaignId>`）。
 * 取不到 id 的活動核准導到活動列表，而不是什麼都不做——使用者至少還找得到。
 */
export function approvalTarget(item: { kind: string; milestone_key?: string | null }): ApprovalTarget {
  if (item.kind === 'event') {
    const eventId = item.milestone_key?.split('|')[1];
    return eventId ? { screen: 'EventDetail', idOrSlug: eventId } : { screen: 'Events' };
  }
  return BY_KIND[item.kind as AchievementKind] ?? { screen: 'Workouts' };
}
