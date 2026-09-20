/**
 * 維持規則 v2（DEC-04 方案 B）：運動 session 任務判定。
 * 只認 App 內 GPS 記錄（origin=gps）、已同步且 status=saved（品質審核通過、非待審）的跑步／健走；
 * 同一 UTC 任務日（依 started_at）內取「最長距離」的一筆；distance ≥ min_distance_mm 且移動時間（elapsed − paused）≥ min_moving_ms。
 * Health Connect 匯入／手動／主辦方成績不計（來源不可歸因到本裝置感測）。
 */
import type { WorkoutSession } from "../store/types.js";

export type WorkoutGoal = { min_distance_mm: number; min_moving_ms: number };
export type WorkoutEvidence = { sessionId: string; distanceMm: number; movingMs: number; origin: WorkoutSession["origin"]; status: WorkoutSession["status"]; revision: number };

export const taskDateOf = (d: Date) => Math.floor(d.getTime() / 86_400_000);

export type WorkoutQualification =
  | { kind: "ok"; best: WorkoutEvidence }
  | { kind: "not_synced" }
  | { kind: "under_review"; best: WorkoutEvidence }
  | { kind: "not_met"; best: WorkoutEvidence };

export function qualifyWorkout(sessions: WorkoutSession[], taskDate: number, goal: WorkoutGoal, sessionId?: string): WorkoutQualification {
  const evidence = (w: WorkoutSession): WorkoutEvidence => ({
    sessionId: w.sessionId,
    distanceMm: Number(w.distanceMm ?? 0n),
    movingMs: Math.max(0, Number(w.elapsedMs) - Number(w.pausedMs)),
    origin: w.origin,
    status: w.status,
    revision: w.revision,
  });
  const sameDay = sessions.filter((w) => w.origin === "gps" && taskDateOf(w.startedAt) === taskDate && w.status !== "deleted" && w.status !== "invalid" && (!sessionId || w.sessionId === sessionId));
  if (sameDay.length === 0) return { kind: "not_synced" };
  const meets = (e: WorkoutEvidence) => e.distanceMm >= goal.min_distance_mm && e.movingMs >= goal.min_moving_ms;
  // 先找通過審核且達標者（最長距離）；否則回報最接近的一筆與原因
  const saved = sameDay.filter((w) => w.status === "saved").map(evidence).sort((a, b) => b.distanceMm - a.distanceMm);
  const ok = saved.find(meets);
  if (ok) return { kind: "ok", best: ok };
  const review = sameDay.filter((w) => w.status === "needs_review").map(evidence).sort((a, b) => b.distanceMm - a.distanceMm).find(meets);
  if (review) return { kind: "under_review", best: review };
  const best = sameDay.map(evidence).sort((a, b) => b.distanceMm - a.distanceMm)[0]!;
  return { kind: "not_met", best };
}
