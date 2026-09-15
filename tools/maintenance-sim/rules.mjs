// PG-V-01：跑鞋維持挑戰規則（shoe-gameplay 3、4.1、4.2）純函式。鏈上（PG-V-02）與 App 預覽須用同版參數；此檔為參數與結算順序的單一參考。
// 版本化：改點數／門檻只能自新版本生效期起適用（shoe-gameplay 4.3）。

export const MAINTENANCE_RULES_VERSION = 1;

/** 累積 XP 上限門檻（Lv1～5）；上限不等於目前有效等級 */
export const XP_THRESHOLDS = [0, 450, 1500, 3600, 7500];
/** Core／Active level 倍率 */
export const MULTIPLIER = [1.0, 1.2, 1.5, 1.8, 2.2];
/** 維持點：與 XP 數字相同但每期重算；同一天兩任務只算一個活躍日 */
export const POINTS = { steps: 100, sleep: 50, dailyMax: 150 };
/** 每個 7 任務日週期的維持門檻（points 與 activeDays 須同時符合）；Lv1 不要求 */
export const MAINTENANCE = { 1: { points: 0, activeDays: 0 }, 2: { points: 200, activeDays: 2 }, 3: { points: 450, activeDays: 3 }, 4: { points: 700, activeDays: 5 }, 5: { points: 900, activeDays: 6 } };
export const EPOCH_DAYS = 7;

export const xpCapLevel = (xp) => XP_THRESHOLDS.filter((t) => xp >= t).length;
export const meets = (level, summary) => summary.points >= MAINTENANCE[level].points && summary.activeDays >= MAINTENANCE[level].activeDays;

/** 一期的 7 天成功紀錄 → 摘要（points、activeDays、doubleDays、7-bit bitmap） */
export function summarize(days) {
  let points = 0, activeDays = 0, doubleDays = 0, bitmap = 0;
  days.forEach((d, i) => {
    const p = (d.steps ? POINTS.steps : 0) + (d.sleep ? POINTS.sleep : 0);
    points += Math.min(p, POINTS.dailyMax);
    if (p > 0) { activeDays++; bitmap |= 1 << i; }
    if (d.steps && d.sleep) doubleDays++;
  });
  return { points, activeDays, doubleDays, bitmap };
}

/**
 * 期末結算（每期執行一次；shoe-gameplay 4.1）：
 * 1. Lv≥2 且未達該階維持 → 降一階，本次不升級。
 * 2. 通過維持 → 在 XP 上限內升至本期成績能支撐的最高階（可跨階；也用於回歸）。
 * 3. 升階更新 highest；不扣 XP／代幣。
 */
export function settleEpoch(state, summary) {
  const { active, highest, xp } = state;
  let next = active;
  let reason;
  if (active >= 2 && !meets(active, summary)) {
    next = active - 1;
    reason = "demoted";
  } else {
    const cap = xpCapLevel(xp);
    let best = 1;
    for (let l = 1; l <= cap; l++) if (meets(l, summary)) best = l;
    next = Math.max(best, 1);
    // 通過維持但成績只夠更低階：不降（步驟 1 已判定通過），維持現階；不高於 XP 上限
    if (next < active) next = active;
    reason = next > active ? (next <= highest ? "restored" : "promoted") : "kept";
  }
  return { active: next, highest: Math.max(highest, next), xp, reason };
}

/** 逐期結算缺席期（shoe-gameplay 4.2）：每期最多降一階，不能只降一階保留過期高權限 */
export function settleMissed(state, missedEpochs) {
  let s = state;
  const empty = summarize(Array.from({ length: EPOCH_DAYS }, () => ({ steps: false, sleep: false })));
  for (let i = 0; i < missedEpochs; i++) s = settleEpoch(s, empty);
  return s;
}
