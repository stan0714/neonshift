// PG-V-01：規則邊界（shoe-gameplay 8）：同日雙任務只算一活躍日、點數／活躍日雙門檻、Lv1 保底、四期缺席 Lv5→Lv1、回歸跨階、XP 上限、每期最多降一階。
// 執行：node --test tools/maintenance-sim/
import assert from "node:assert/strict";
import { test } from "node:test";

import { MAINTENANCE, meets, settleEpoch, settleMissed, summarize, xpCapLevel } from "./rules.mjs";

const days = (pattern) => pattern.split("").map((c) => ({ steps: c === "B" || c === "S", sleep: c === "B" || c === "Z" })); // B 雙、S 步數、Z 睡眠、. 無

test("summarize：同日雙任務 150 點、一活躍日；bitmap 依日序；集中一天不能湊活躍日", () => {
  const s = summarize(days("B......"));
  assert.deepEqual([s.points, s.activeDays, s.doubleDays, s.bitmap], [150, 1, 1, 0b1]);
  const w = summarize(days("SZSZSZS"));
  assert.deepEqual([w.points, w.activeDays, w.doubleDays], [100 * 4 + 50 * 3, 7, 0]);
});

test("meets：點數與活躍日須同時符合；Lv5 六日雙任務 900 可留一天休息；五日雙任務 750 不足", () => {
  assert.equal(meets(5, summarize(days("BBBBBB."))), true);
  assert.equal(meets(5, summarize(days("BBBBB.."))), false);
  assert.equal(meets(4, summarize(days("BBBBB.."))), true);
  assert.equal(meets(2, summarize(days("SS....."))), true); // 200 點／2 日，步數即可
  assert.equal(meets(2, summarize(days("B......"))), false); // 150 點且只 1 活躍日
  assert.equal(meets(4, summarize(days("SSSSSSS"))), true); // 睡眠不可用：700／7 可維持 Lv4
  assert.equal(meets(5, summarize(days("SSSSSSS"))), false); // 但 Lv5 需 900 → 不可能
});

test("settleEpoch：未達 → 降一階且不升；達標 → XP 上限內升至成績能支撐的最高階（可跨階）；Lv1 保底", () => {
  const full = summarize(days("BBBBBBB"));
  assert.deepEqual(settleEpoch({ active: 1, highest: 1, xp: 1050 }, full), { active: 2, highest: 2, xp: 1050, reason: "promoted" });
  assert.deepEqual(settleEpoch({ active: 1, highest: 5, xp: 9000 }, full), { active: 5, highest: 5, xp: 9000, reason: "restored" }); // 回歸不逐階
  assert.deepEqual(settleEpoch({ active: 3, highest: 5, xp: 9000 }, summarize(days("BBBBB.."))), { active: 4, highest: 5, xp: 9000, reason: "restored" });
  assert.deepEqual(settleEpoch({ active: 5, highest: 5, xp: 9000 }, summarize(days("BBBBB.."))), { active: 4, highest: 5, xp: 9000, reason: "demoted" });
  assert.deepEqual(settleEpoch({ active: 4, highest: 4, xp: 5000 }, full).active, 4); // XP 5000 < 7500 → 不升 Lv5
  assert.deepEqual(settleEpoch({ active: 1, highest: 1, xp: 0 }, summarize(days("......."))).active, 1);
  assert.equal(settleEpoch({ active: 2, highest: 2, xp: 2000 }, summarize(days("SS....."))).reason, "kept"); // 剛好維持 Lv2、成績不夠 Lv3
});

test("settleMissed：每期最多降一階；缺席四期 Lv5 → Lv1；highest 不變；XP 不扣", () => {
  const s = settleMissed({ active: 5, highest: 5, xp: 8400 }, 4);
  assert.deepEqual([s.active, s.highest, s.xp], [1, 5, 8400]);
  assert.equal(settleMissed({ active: 5, highest: 5, xp: 8400 }, 1).active, 4);
});

test("xpCapLevel 與 MAINTENANCE 單調", () => {
  assert.deepEqual([0, 449, 450, 1500, 3600, 7500, 99999].map(xpCapLevel), [1, 1, 2, 3, 4, 5, 5]);
  for (let l = 2; l <= 5; l++) assert.ok(MAINTENANCE[l].points > MAINTENANCE[l - 1].points && MAINTENANCE[l].activeDays >= MAINTENANCE[l - 1].activeDays);
});
