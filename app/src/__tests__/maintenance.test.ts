/** PG-V-04：維持挑戰 UI 預覽（與 rules.mjs／maintenance.rs 同版）：期倒數、點數／活躍日、維持／升階／回歸提示、未遷移／待結算狀態；收藏分區。 */
import { PublicKey } from '@solana/web3.js';

import type { PlayerProfile } from '@/chain/accounts';
import { shoeSection } from '@/domain/collectibles';
import { maintenanceView, nextSteps } from '@/domain/maintenance';

const wallet = new PublicKey('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
const T = [0, 450, 1500, 3600, 7500].map(BigInt);
const profile = (p: Partial<PlayerProfile>): PlayerProfile => ({ wallet, coreLevel: 3, shoeLevel: 3, xp: 2000n, lastTaskDate: 0, streakDays: 0, maxStreakDays: 0, claimedToday: 0n, todayDate: 0, migrated: true, highestLevel: 5, epochAnchor: 20_700, lastSettledEpoch: 2, epochPoints: 450, epochBitmap: 0b0000111, maintenanceRulesVersion: 1, ...p });
const day = (d: number) => d * 86_400_000 + 3_600_000; // 該日 01:00 UTC

test('active：第 2 期（day 20714～20720）、剩餘天數、點數／活躍日、維持 Lv3 已達、回歸目標 Lv5 還差 450 點／3 日（3 天雙任務）', () => {
  const v = maintenanceView(profile({}), T, day(20_716))!;
  expect([v.state, v.epochIndex, v.daysLeft, v.points, v.activeDays]).toEqual(['active', 2, 5, 450, 3]);
  expect(new Date(v.epochEndsAtMs).toISOString()).toBe(new Date(20_721 * 86_400_000).toISOString());
  expect(v.keep).toEqual({ points: 450, activeDays: 3, met: true });
  expect(v.restore).toEqual({ level: 5, points: 900, activeDays: 6 });
  expect(nextSteps(v.restore!, v.points, v.activeDays)).toEqual({ morePoints: 450, moreDays: 3, doubleDays: 3 });
});

test('無回歸目標時顯示下一階；XP 上限不足 → nextXp；Lv5 → next null；Lv1 keep 為 0', () => {
  const v = maintenanceView(profile({ highestLevel: 3, xp: 2000n }), T, day(20_716))!;
  expect(v.restore).toBeNull();
  expect(v.next).toEqual({ level: 4, points: 700, activeDays: 5, met: false, xpAllowed: false });
  const v2 = maintenanceView(profile({ highestLevel: 3, xp: 4000n, epochPoints: 750, epochBitmap: 0b11111 }), T, day(20_716))!;
  expect(v2.next).toMatchObject({ level: 4, met: true, xpAllowed: true });
  expect(maintenanceView(profile({ coreLevel: 5, highestLevel: 5 }), T, day(20_716))!.next).toBeNull();
  expect(maintenanceView(profile({ coreLevel: 1, highestLevel: 1 }), T, day(20_716))!.keep).toEqual({ points: 0, activeDays: 0, met: true });
});

test('未遷移 → migration_required；落後 → settlement_pending（本期點數視為 0）；null profile → null', () => {
  expect(maintenanceView(profile({ migrated: false }), T, day(20_716))!.state).toBe('migration_required');
  const v = maintenanceView(profile({ lastSettledEpoch: 0 }), T, day(20_716))!;
  expect([v.state, v.pendingEpochs, v.points, v.activeDays]).toEqual(['settlement_pending', 2, 0, 0]);
  expect(maintenanceView(null, T, day(20_716))).toBeNull();
});

test('收藏分區：現役 Lv3、歷史最高 Lv5 → Lv3 目前裝備、Lv1／2／4／5 曾經達成；Lv3／highest 3 → Lv4 尚未解鎖', () => {
  const p = profile({});
  expect([1, 2, 3, 4, 5].map((k) => shoeSection(p, k as 1))).toEqual(['achieved', 'achieved', 'equipped', 'achieved', 'achieved']);
  expect([3, 4].map((k) => shoeSection(profile({ highestLevel: 3 }), k as 1))).toEqual(['equipped', 'locked']);
  expect(shoeSection(null, 1)).toBe('locked');
});
