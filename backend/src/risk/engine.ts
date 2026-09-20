/**
 * 風險引擎（PG-B-08／B-09，SD 4.4、BR-07～BR-12）。
 * 順序：硬拒絕 → 夾限（來自 claim/steps）→ 達標檢查 → 評分 → 門檻。
 * 輸出含命中規則、分數、rules_version／rules_hash；API 回應不得含分數與門檻（由呼叫端過濾）。
 */
import type { ClaimRequest } from "../claim/schema.js";
import { attributeAndClampSteps, mergeSleepMinutes, type StepsAttribution } from "../claim/steps.js";
import type { WorkoutSession } from "../store/types.js";
import { qualifyWorkout, type WorkoutEvidence } from "../claim/workout.js";
import type { RuleSet } from "./rules.js";

export type RejectCode =
  | "SRC_UNATTRIBUTED"
  | "SRC_MANUAL"
  | "SLEEP_RANGE"
  | "NO_SENSOR"
  | "LIVE_MOTION_INCOMPLETE"
  | "TASK_NOT_MET"
  | "RISK_SCORE"
  | "WORKOUT_NOT_SYNCED"
  | "WORKOUT_UNDER_REVIEW";

export type RiskDecision = {
  decision: "pass" | "reject";
  rejectCode: RejectCode | null;
  /** 不回傳給 client */
  score: number;
  threshold: number;
  matched: string[];
  rulesVersion: number;
  rulesHash: Buffer;
  /** 夾限後有效值（步數或睡眠分鐘），供 UI 顯示進度與稽核 */
  effectiveValue: number;
  steps: StepsAttribution | null;
  sleepMinutes: number | null;
  sleepOverlapMinutes: number | null;
  /** 運動任務：採用的 session 證據（distance／moving／revision） */
  workout: WorkoutEvidence | null;
};

export type EvaluateContext = { workouts?: WorkoutSession[] };

export function evaluate(req: ClaimRequest, rules: RuleSet, ctx: EvaluateContext = {}): RiskDecision {
  const cfg = rules.config;
  const matched: string[] = [];
  const base = { rulesVersion: rules.version, rulesHash: rules.hash, threshold: cfg.threshold };
  const reject = (code: RejectCode, extra: Partial<RiskDecision>): RiskDecision => ({
    decision: "reject",
    rejectCode: code,
    score: 0,
    matched: [...matched, code],
    effectiveValue: 0,
    steps: null,
    sleepMinutes: null,
    sleepOverlapMinutes: null,
    workout: null,
    ...base,
    ...extra,
  });

  // 維持規則 v2（DEC-04）：運動 session 任務——不要求步數／SPN／live motion；證據來自伺服器已審核的 GPS session
  if (req.task_type === "workout") {
    if (!cfg.goals.workout) return reject("TASK_NOT_MET", { effectiveValue: 0 });
    const q = qualifyWorkout(ctx.workouts ?? [], req.task_date, cfg.goals.workout, req.workout_session_id);
    if (q.kind === "not_synced") return reject("WORKOUT_NOT_SYNCED", { effectiveValue: 0 });
    if (q.kind === "under_review") return reject("WORKOUT_UNDER_REVIEW", { workout: q.best, effectiveValue: q.best.distanceMm });
    if (q.kind === "not_met") return reject("TASK_NOT_MET", { workout: q.best, effectiveValue: q.best.distanceMm });
    return { decision: "pass", rejectCode: null, score: 0, matched, effectiveValue: q.best.distanceMm, steps: null, sleepMinutes: null, sleepOverlapMinutes: null, workout: q.best, ...base };
  }

  if (req.task_type === "steps") {
    const steps = attributeAndClampSteps(req.data_origins, req.step_rate_summary);
    matched.push(...steps.clamps);
    for (const r of cfg.hard_reject) {
      if (r.task !== "steps") continue;
      switch (r.id) {
        case "SRC_UNATTRIBUTED":
          if (steps.attributedSteps === 0) return reject("SRC_UNATTRIBUTED", { steps, effectiveValue: 0 });
          break;
        case "SRC_MANUAL":
          // 允許來源內不得混入手動輸入（App 端已依 recordingMethod 分類；這裡以來源標記為準）
          if (req.data_origins.some((o) => o.source_kind === "manual" && o.steps > 0 && steps.attributedSteps === 0)) return reject("SRC_MANUAL", { steps });
          break;
        case "NO_SENSOR":
          if (!req.sensor_summary) return reject("NO_SENSOR", { steps, effectiveValue: steps.effectiveSteps });
          break;
        case "LIVE_MOTION_INCOMPLETE":
          if (req.sensor_summary && req.sensor_summary.step_delta < r.min_step_delta) return reject("LIVE_MOTION_INCOMPLETE", { steps, effectiveValue: steps.effectiveSteps });
          break;
        default:
          break;
      }
    }
    if (steps.effectiveSteps < cfg.goals.steps) return reject("TASK_NOT_MET", { steps, effectiveValue: steps.effectiveSteps });

    let score = 0;
    const s = req.sensor_summary!;
    const m = req.motion_summary;
    for (const r of cfg.score) {
      if (r.task !== "steps") continue;
      let hit = false;
      switch (r.id) {
        case "freq_variance_low":
          hit = s.step_delta >= r.min_step_delta && s.freq_variance < r.max_freq_variance;
          break;
        case "no_displacement_high_steps":
          hit = !!m && m.gps_available && m.displacement_m < r.max_displacement_m && steps.attributedSteps > r.min_steps;
          break;
        case "stride_implausible": {
          // 步幅 = 位移 / 步數；無定位或室內無位移不得單獨導致拒絕（BR-11）：僅在有位移時計
          if (m && m.gps_available && m.displacement_m > 0 && steps.attributedSteps > 0) {
            const stride = m.displacement_m / steps.attributedSteps;
            hit = stride < r.min_stride_m || stride > r.max_stride_m;
          }
          break;
        }
        default:
          break;
      }
      if (hit) {
        matched.push(r.id);
        score += r.weight;
      }
    }
    if (score >= cfg.threshold) return reject("RISK_SCORE", { steps, score, matched: [...matched], effectiveValue: steps.effectiveSteps });
    return { decision: "pass", rejectCode: null, score, matched, effectiveValue: steps.effectiveSteps, steps, sleepMinutes: null, sleepOverlapMinutes: null, workout: null, ...base };
  }

  // sleep（v1 保留供舊規則檔／稽核重算；claim schema 已不接受 "sleep"）：不要求步數、SPN 或 live motion（SD 4.4）
  const sessions = req.sleep_sessions ?? [];
  const sleepMinutes = sessions.length > 0 ? mergeSleepMinutes(sessions) : (req.sleep_minutes ?? 0);
  const overlap = req.steps && req.step_rate_summary ? overlapMinutesWithSteps(sessions, req.step_rate_summary.buckets, req.task_date) : 0;
  for (const r of cfg.hard_reject) {
    if (r.task !== "sleep") continue;
    if (r.id === "SLEEP_RANGE" && (sleepMinutes < r.min_minutes || sleepMinutes > r.max_minutes)) {
      return reject("SLEEP_RANGE", { sleepMinutes, sleepOverlapMinutes: overlap, effectiveValue: sleepMinutes });
    }
  }
  if (sleepMinutes < cfg.goals.sleep_minutes) return reject("TASK_NOT_MET", { sleepMinutes, sleepOverlapMinutes: overlap, effectiveValue: sleepMinutes });
  let score = 0;
  for (const r of cfg.score) {
    if (r.task !== "sleep") continue;
    if (r.id === "sleep_overlap_stepping" && overlap > r.min_overlap_minutes) {
      matched.push(r.id);
      score += r.weight;
    }
  }
  if (score >= cfg.threshold) return reject("RISK_SCORE", { sleepMinutes, sleepOverlapMinutes: overlap, score, matched: [...matched], effectiveValue: sleepMinutes });
  return { decision: "pass", rejectCode: null, score, matched, effectiveValue: sleepMinutes, steps: null, sleepMinutes, sleepOverlapMinutes: overlap, workout: null, ...base };
}

/** 睡眠期間出現高步頻的分鐘數（BR-12：短暫重疊不直接拒絕，只加風險分） */
export function overlapMinutesWithSteps(sessions: { start_unix: number; end_unix: number }[], buckets: [number, number][], taskDate: number): number {
  const dayStart = taskDate * 86_400;
  let n = 0;
  for (const [minute, steps] of buckets) {
    if (steps < 30) continue; // 每分鐘 < 30 步視為翻身等短暫動作
    const t = dayStart + minute * 60;
    if (sessions.some((s) => t >= s.start_unix && t < s.end_unix)) n += 1;
  }
  return n;
}
