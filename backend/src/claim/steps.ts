/**
 * 步數來源歸因與夾限（PG-B-06，BR-07／08／10、SD 4.4）。
 * 順序：先排除不允許來源 → 逐分鐘桶夾限 250 → 單日 40,000；排除資料存在不使其餘資料整筆被拒。
 */
import type { DataOrigin, StepRateSummary } from "./schema.js";

export const MAX_STEPS_PER_MINUTE = 250;
export const MAX_STEPS_PER_DAY = 40_000;
export const STEPS_GOAL = 8_000;
export const SLEEP_GOAL_MINUTES = 420;
export const SLEEP_MIN_MINUTES = 180;
export const SLEEP_MAX_MINUTES = 720;

export const ALLOWED_SOURCE_KINDS = new Set(["android_legacy", "current_device_spn"]);

export type StepsAttribution = {
  /** 允許來源的步數總和（未夾限） */
  attributedSteps: number;
  /** 夾限後有效步數 */
  effectiveSteps: number;
  excludedSteps: number;
  includesManual: boolean;
  /** 命中的夾限規則（紀錄用，非拒絕） */
  clamps: ("RATE_EXCEEDED" | "DAILY_CAP")[];
  /** 桶總和與 attributed_steps 不一致（client 資料自相矛盾） */
  inconsistent: boolean;
  observedMinutes: number;
  maxStepsPerMinute: number;
};

export function attributeAndClampSteps(origins: DataOrigin[], summary: StepRateSummary | null): StepsAttribution {
  let attributed = 0;
  let excluded = 0;
  let includesManual = false;
  for (const o of origins) {
    if (ALLOWED_SOURCE_KINDS.has(o.source_kind)) attributed += o.steps;
    else excluded += o.steps;
    if (o.source_kind === "manual") includesManual = true;
  }

  const clamps: StepsAttribution["clamps"] = [];
  let effective: number;
  let observedMinutes = 0;
  let maxStepsPerMinute = 0;
  let inconsistent = false;

  if (summary && summary.buckets.length > 0) {
    let bucketSum = 0;
    let clamped = 0;
    for (const [, steps] of summary.buckets) {
      bucketSum += steps;
      if (steps > 0) observedMinutes += 1;
      if (steps > maxStepsPerMinute) maxStepsPerMinute = steps;
      clamped += Math.min(steps, MAX_STEPS_PER_MINUTE);
    }
    if (clamped < bucketSum) clamps.push("RATE_EXCEEDED");
    // 桶只涵蓋允許來源（App 端規則）；總和必須等於 attributed_steps
    inconsistent = bucketSum !== attributed;
    effective = clamped;
  } else {
    // 沒有桶就無法逐分鐘夾限；不得假裝已夾限 → 視為無可歸因步數
    effective = 0;
    inconsistent = attributed > 0;
  }

  if (effective > MAX_STEPS_PER_DAY) {
    clamps.push("DAILY_CAP");
    effective = MAX_STEPS_PER_DAY;
  }
  return { attributedSteps: attributed, effectiveSteps: effective, excludedSteps: excluded, includesManual, clamps, inconsistent, observedMinutes, maxStepsPerMinute };
}

export type SleepSessionInput = { start_unix: number; end_unix: number };

/** 睡眠：以聯集去重（重疊 session 不重複計）；回傳有效分鐘 */
export function mergeSleepMinutes(sessions: SleepSessionInput[]): number {
  const sorted = sessions.filter((s) => s.end_unix > s.start_unix).sort((a, b) => a.start_unix - b.start_unix);
  let total = 0;
  let curStart = -1;
  let curEnd = -1;
  for (const s of sorted) {
    if (s.start_unix > curEnd) {
      if (curEnd > curStart) total += curEnd - curStart;
      curStart = s.start_unix;
      curEnd = s.end_unix;
    } else if (s.end_unix > curEnd) {
      curEnd = s.end_unix;
    }
  }
  if (curEnd > curStart) total += curEnd - curStart;
  return Math.floor(total / 60);
}
