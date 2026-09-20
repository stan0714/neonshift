import assert from "node:assert/strict";
import { test } from "node:test";

import { CANDIDATES, minimalCombo, settleEpoch, summarize } from "./rules-v2.mjs";

test("候選 B：Lv5 最省力＝7 天步數＋2 次運動（或 6＋3）；只走步數最高 Lv4；日上限 200", () => {
  const B = CANDIDATES.B;
  assert.deepEqual(minimalCombo(B, 5), { workouts: 2, stepDays: 7 });
  assert.deepEqual(minimalCombo(B, 4), { workouts: 0, stepDays: 7 });
  const six3 = summarize(B, Array.from({ length: 7 }, (_, i) => ({ steps: i < 6, workout: i < 3 })));
  assert.equal(six3.points, 900); assert.equal(six3.activeDays, 6);
  const stepsOnly = summarize(B, Array.from({ length: 7 }, () => ({ steps: true, workout: false })));
  assert.equal(stepsOnly.points, 700);
  assert.equal(settleEpoch(B, { active: 5, highest: 5, xp: 9000 }, stepsOnly).active, 4, "Lv5 只走步數 → 降一階");
  assert.equal(settleEpoch(B, { active: 4, highest: 5, xp: 9000 }, six3).active, 5, "回到 6＋3 → 恢復 Lv5");
});

test("候選 A：Lv5 需 4 次運動；候選 C：Lv5 只靠 7 天步數、運動不計", () => {
  assert.deepEqual(minimalCombo(CANDIDATES.A, 5), { workouts: 4, stepDays: 7 });
  assert.deepEqual(minimalCombo(CANDIDATES.C, 5), { workouts: 0, stepDays: 7 });
  const C = CANDIDATES.C;
  assert.equal(summarize(C, Array.from({ length: 7 }, () => ({ steps: false, workout: true }))).points, 0);
});
