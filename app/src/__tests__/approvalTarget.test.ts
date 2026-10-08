/**
 * R4（2026-09-29 review）：核准通知的去向。
 *
 * 判斷依據是**領取 UI 實際掛在哪個畫面**，不是猜的：
 *   pb        → PersonalBests，在 WorkoutsScreen
 *   milestone → Milestones，在 GearScreen 的收藏區
 *   seasonal  → SeasonalFootprints，同樣在 GearScreen
 *   event     → EventDetail
 * 修正前 event 以外一律推 Workouts，所以里程碑與節日章都落在沒有領取按鈕的頁面——
 * 而首次 5K／10K 正是跑完一趟最常見的核准。
 */
import { approvalTarget } from '@/navigation/approvalTarget';

test('pb 留在 Workouts（PersonalBests 就掛在那裡）', () => {
  expect(approvalTarget({ kind: 'pb', milestone_key: null })).toEqual({ screen: 'Workouts' });
});

test('milestone 導到 Gear 的里程碑分類，不是 Workouts', () => {
  expect(approvalTarget({ kind: 'milestone', milestone_key: 'first_5k' })).toEqual({
    screen: 'Main', tab: 'Gear', category: 'milestones',
  });
});

test('seasonal 導到 Gear 的節日分類', () => {
  expect(approvalTarget({ kind: 'seasonal', milestone_key: 'seasonal|moon-2026' })).toEqual({
    screen: 'Main', tab: 'Gear', category: 'seasonal',
  });
});

test('event 導到該場活動', () => {
  expect(approvalTarget({ kind: 'event', milestone_key: 'event|spring-run' })).toEqual({
    screen: 'EventDetail', idOrSlug: 'spring-run',
  });
});

test('event 但 milestone_key 取不到 id → 活動列表，而不是什麼都不做', () => {
  for (const key of [null, 'event', 'event|']) {
    expect(approvalTarget({ kind: 'event', milestone_key: key })).toEqual({ screen: 'Events' });
  }
});

test('未知 kind 不亂猜，回 Workouts', () => {
  expect(approvalTarget({ kind: 'something_new', milestone_key: null })).toEqual({ screen: 'Workouts' });
});
