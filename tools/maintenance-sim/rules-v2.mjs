// DEC-04（2026-09-20）：睡眠停用後的維持規則候選 v2。v1（rules.mjs）不改，依 shoe-gameplay 4.3 只能自新版本生效期起適用。
// 第二每日任務改為「運動 session」（App 內 GPS 記錄的跑步／健走，通過品質審核、≥ 1 km 且移動 ≥ 10 分鐘；每 UTC 日一次）。
// 三個候選：
//   A  沿用 v1 門檻，運動 +50、日上限 150（Lv5 = 6 天步數＋6 次運動）
//   B  運動 +100、日上限 200，門檻不變（Lv5 = 7 天步數＋2 次運動，或 6＋3；只走步數最高 Lv4）
//   C  只算步數（+100／日）、Lv5 改 700／7（全勤步數即可，沒有休息日；運動不計）
import { MULTIPLIER, XP_THRESHOLDS, xpCapLevel } from "./rules.mjs";

export const EPOCH_DAYS = 7;
export const MAINTENANCE_V1 = { 1: { points: 0, activeDays: 0 }, 2: { points: 200, activeDays: 2 }, 3: { points: 450, activeDays: 3 }, 4: { points: 700, activeDays: 5 }, 5: { points: 900, activeDays: 6 } };

export const CANDIDATES = {
  A: { label: "A 運動 +50／上限 150，門檻同 v1", points: { steps: 100, workout: 50, dailyMax: 150 }, maintenance: MAINTENANCE_V1 },
  B: { label: "B 運動 +100／上限 200，門檻同 v1", points: { steps: 100, workout: 100, dailyMax: 200 }, maintenance: MAINTENANCE_V1 },
  C: { label: "C 只算步數，Lv5 改 700／7", points: { steps: 100, workout: 0, dailyMax: 100 }, maintenance: { ...MAINTENANCE_V1, 5: { points: 700, activeDays: 7 } } },
};

export const meets = (rules, level, s) => s.points >= rules.maintenance[level].points && s.activeDays >= rules.maintenance[level].activeDays;

/** 一期 7 天 → 摘要；day = { steps, workout } */
export function summarize(rules, days) {
  let points = 0, activeDays = 0, doubleDays = 0, bitmap = 0;
  days.forEach((d, i) => {
    const p = (d.steps ? rules.points.steps : 0) + (d.workout ? rules.points.workout : 0);
    points += Math.min(p, rules.points.dailyMax);
    if (p > 0) { activeDays++; bitmap |= 1 << i; }
    if (d.steps && d.workout) doubleDays++;
  });
  return { points, activeDays, doubleDays, bitmap };
}

/** 結算順序與 v1 相同（先降級最多一階、再在 XP 上限內升到成績能撐的最高階） */
export function settleEpoch(rules, state, s) {
  const { active, highest, xp } = state;
  let next = active, reason;
  if (active >= 2 && !meets(rules, active, s)) { next = active - 1; reason = "demoted"; }
  else {
    const cap = xpCapLevel(xp);
    let best = 1;
    for (let l = 1; l <= cap; l++) if (meets(rules, l, s)) best = l;
    next = Math.max(best, active);
    reason = next > active ? (next <= highest ? "restored" : "promoted") : "kept";
  }
  return { active: next, highest: Math.max(highest, next), xp, reason };
}

/** 每階「最省力」達成組合（每週步數日 s、運動次 w，w ≤ s 視為運動當天也有步數）：回傳最少運動次數與所需步數日 */
export function minimalCombo(rules, level) {
  const m = rules.maintenance[level];
  let best = null;
  for (let w = 0; w <= 7; w++) for (let s = 0; s <= 7; s++) {
    const days = Array.from({ length: 7 }, (_, i) => ({ steps: i < s, workout: i < w }));
    const sum = summarize(rules, days);
    if (sum.points >= m.points && sum.activeDays >= m.activeDays) { if (!best || w < best.workouts || (w === best.workouts && s < best.stepDays)) best = { workouts: w, stepDays: s }; }
  }
  return best;
}
export { MULTIPLIER, XP_THRESHOLDS, xpCapLevel };
