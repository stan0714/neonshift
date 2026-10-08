/**
 * 運動 session 匯入契約（PG-R-01；activity-running-gallery 3.2／4、SD 16 同步契約）。
 * 大整數以十進位字串或安全整數傳入；伺服器衍生欄位（elapsed、配速、品質、pb_eligible）不可由客戶端覆寫。
 */
import { z } from "zod";

export const WORKOUT_RULES_VERSION = 2;
export const IMPORT_MAX_SESSIONS = 50;
/** 與每日任務相同的每分鐘步數上限（SA 附錄 A） */
const STEPS_PER_MINUTE_CAP = 250;
/** 跑步／健走可信平均速度上限（km/h）；超過標 needs_review，不當作有效紀錄 */
const MAX_SPEED_KMH = { run: 25, walk: 12 } as const;
/** 5 秒最高速度上限（km/h；跑 36 ≈ 10 m/s、走 15）；App 自報的 extras.max_speed_5s_kmh 超過即 needs_review */
const MAX_SPEED_5S_KMH = { run: 36, walk: 15 } as const;
/** App 完整性旗標（GPS 規則 v2）：伺服器只承認這幾個；任一出現即 needs_review（防弊二線判定，不只信 App 自評） */
export const INTEGRITY_FLAGS = ["mock_location", "sustained_speed", "gap_teleport", "clock_drift", "motion_mismatch"] as const;
/** 伺服器側原因：同錢包時間重疊、單日筆數上限、取樣過疏 */
export const SERVER_REVIEW_REASONS = ["overlapping_session", "daily_cap_exceeded"] as const;
export const DAILY_SESSION_CAP = 12;
/** GPS 來源每秒取樣：接受點數低於運動秒數 × 此比例視為取樣過疏（partial，不具 PB 資格） */
const SPARSE_SAMPLE_RATIO = 0.2;
const REVIEW_TRIGGERS = new Set<string>(["steps_rate_exceeds_cap", "speed_exceeds_cap", "max_speed_5s_exceeds_cap", "moving_speed_exceeds_cap", ...INTEGRITY_FLAGS, ...SERVER_REVIEW_REASONS]);

const bigIntish = (max: bigint) =>
  z.union([z.number().int().min(0), z.string().regex(/^\d{1,19}$/)]).transform((v, ctx) => {
    const b = BigInt(v);
    if (b > max) { ctx.addIssue({ code: "custom", message: `must be ≤ ${max}` }); return z.NEVER; }
    return b;
  });
const iso = z.string().datetime({ offset: true }).transform((s) => new Date(s));

export const workoutInput = z
  .object({
    sport: z.enum(["run", "walk"]),
    /** PG-U-01：使用模式（walk → casual｜brisk；run → run）；缺省 null（舊資料／匯入來源） */
    intent: z.enum(["casual", "brisk", "run"]).nullable().default(null),
    /** PG-U-01：開始時的目標快照；達標只提醒不自動停止 */
    goal: z.object({ kind: z.enum(["free", "time", "distance"]), target: z.number().int().min(0).max(1_000_000_000), unit: z.enum(["s", "mm"]), version: z.number().int().min(1).max(100) }).strict().nullable().default(null),
    environment: z.enum(["outdoor", "indoor", "unknown"]).default("unknown"),
    origin: z.enum(["health_connect", "device", "gps", "organizer", "manual"]),
    /** 來源識別（Health Connect 寫入 App package、手錶型號、活動 id…） */
    source_id: z.string().min(1).max(120),
    external_record_id: z.string().min(1).max(200),
    source_revision: z.number().int().min(1).max(1_000_000).default(1),
    started_at: iso,
    ended_at: iso,
    paused_ms: bigIntish(604_800_000n).default(0n),
    distance_mm: bigIntish(1_000_000_000n).nullable().default(null),
    distance_method: z.enum(["device", "gps", "estimated", "organizer"]).nullable().default(null),
    steps: z.number().int().min(0).max(1_000_000).nullable().default(null),
    active_energy_mkcal: bigIntish(100_000_000n).nullable().default(null),
    energy_method: z.enum(["device", "estimated", "total"]).nullable().default(null),
    total_energy_mkcal: bigIntish(100_000_000n).nullable().default(null),
    /** 估算距離時必填：每一步校準步長（mm），不是跨兩步 stride */
    step_length_mm: z.number().int().min(300).max(2000).nullable().default(null),
    /** 客戶端品質提示（GPS 缺口、部分權限…）；只作 review 原因，不決定 quality */
    client_flags: z.array(z.string().max(40)).max(20).default([]),
    /** 可選：分段／圈數等摘要（不含座標） */
    extras: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()
  .superRefine((w, ctx) => {
    // 模式與運動分類必須一致：健走／走路屬 walking，跑步屬 running
    if (w.intent === "run" && w.sport !== "run") ctx.addIssue({ code: "custom", path: ["intent"], message: "intent run requires sport run" });
    if ((w.intent === "casual" || w.intent === "brisk") && w.sport !== "walk") ctx.addIssue({ code: "custom", path: ["intent"], message: "walking intents require sport walk" });
    if (w.goal && w.goal.kind !== "free" && w.goal.target <= 0) ctx.addIssue({ code: "custom", path: ["goal"], message: "goal target must be positive" });
    if (w.goal && ((w.goal.kind === "time" && w.goal.unit !== "s") || (w.goal.kind === "distance" && w.goal.unit !== "mm"))) ctx.addIssue({ code: "custom", path: ["goal"], message: "goal unit mismatch" });
  });
export type WorkoutInput = z.infer<typeof workoutInput>;
/** 跑步 intent 可由 sport 推導；walking 不自動判定健走（使用者選擇） */
export const intentOf = (w: Pick<WorkoutInput, "sport" | "intent">) => w.intent ?? (w.sport === "run" ? "run" : null);

export const importBody = z.object({ sessions: z.array(workoutInput).min(1).max(IMPORT_MAX_SESSIONS) }).strict();

export type Derived = { elapsedMs: bigint; quality: "complete" | "partial" | "estimated" | "needs_review" | "invalid"; status: "saved" | "needs_review" | "invalid"; pbEligible: boolean; reviewReasons: string[]; distanceMm: bigint | null; distanceMethod: WorkoutInput["distance_method"]; avgPaceSPerKm: number | null; avgSpeedKmh: number | null };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** 伺服器衍生：經過時間、估算距離、品質與 PB 資格（活動 4／3.2 規則）；`serverReasons` 為 route 層查出的原因（重疊、單日上限） */
export function derive(w: WorkoutInput, serverReasons: readonly string[] = []): Derived {
  const reasons: string[] = [...serverReasons];
  const elapsedMs = BigInt(w.ended_at.getTime() - w.started_at.getTime());
  if (elapsedMs <= 0n || w.paused_ms >= elapsedMs) return { elapsedMs, quality: "invalid", status: "invalid", pbEligible: false, reviewReasons: [elapsedMs <= 0n ? "ended_before_start" : "paused_exceeds_elapsed"], distanceMm: null, distanceMethod: null, avgPaceSPerKm: null, avgSpeedKmh: null };
  let distanceMm = w.distance_mm;
  let distanceMethod = w.distance_method;
  let estimated = false;
  if (distanceMm !== null && distanceMethod === null) reasons.push("distance_method_missing");
  if (distanceMm === null && w.steps !== null && w.step_length_mm !== null) {
    // 估算：steps × 校準步長；無校準不套通用步長
    distanceMm = BigInt(w.steps) * BigInt(w.step_length_mm);
    distanceMethod = "estimated";
    estimated = true;
  } else if (distanceMethod === "estimated") estimated = true;
  const minutes = Number(elapsedMs) / 60_000;
  if (w.steps !== null && w.steps > minutes * STEPS_PER_MINUTE_CAP) reasons.push("steps_rate_exceeds_cap");
  let avgPaceSPerKm: number | null = null;
  let avgSpeedKmh: number | null = null;
  if (distanceMm !== null && distanceMm > 0n) {
    const km = Number(distanceMm) / 1_000_000;
    // 平均配速含暫停（經過時間，不是移動時間）
    avgPaceSPerKm = Math.round(Number(elapsedMs) / 1000 / km);
    avgSpeedKmh = Number((km / (Number(elapsedMs) / 3_600_000)).toFixed(3));
    if (avgSpeedKmh > MAX_SPEED_KMH[w.sport]) reasons.push("speed_exceeds_cap");
  }
  if (w.energy_method === "total" && w.active_energy_mkcal !== null) reasons.push("active_energy_labelled_total");
  for (const f of w.client_flags) if (f === "gps_gap" || f === "partial_permissions") reasons.push(f);
  // 完整性旗標：client_flags 與 extras.integrity.flags 取聯集（App 任一處帶到就算），只承認白名單
  const integrityExtra = (w.extras as { integrity?: { flags?: unknown } }).integrity?.flags;
  const flagged = new Set<string>([...w.client_flags, ...(Array.isArray(integrityExtra) ? integrityExtra.filter((x): x is string => typeof x === "string") : [])]);
  for (const f of INTEGRITY_FLAGS) if (flagged.has(f)) reasons.push(f);
  // GPS 來源的自報極值：5 秒最高速度、移動時間平均速度（含暫停的平均可能被長暫停稀釋）、取樣密度
  if (w.origin === "gps") {
    const max5s = num((w.extras as { max_speed_5s_kmh?: unknown }).max_speed_5s_kmh);
    if (max5s !== null && max5s > MAX_SPEED_5S_KMH[w.sport]) reasons.push("max_speed_5s_exceeds_cap");
    const movingMs = num((w.extras as { moving_ms?: unknown }).moving_ms);
    if (movingMs !== null && movingMs > 0 && distanceMm !== null && distanceMm > 0n) {
      const movingKmh = Number(distanceMm) / 1_000_000 / (movingMs / 3_600_000);
      if (movingKmh > MAX_SPEED_KMH[w.sport] && !reasons.includes("speed_exceeds_cap")) reasons.push("moving_speed_exceeds_cap");
      const accepted = num((w.extras as { quality?: { accepted?: unknown } }).quality?.accepted);
      if (accepted !== null && accepted < (movingMs / 1000) * SPARSE_SAMPLE_RATIO) reasons.push("sparse_samples");
    }
  }
  const manual = w.origin === "manual";
  if (manual) reasons.push("manual_entry");
  let quality: Derived["quality"];
  if (reasons.some((r) => REVIEW_TRIGGERS.has(r))) quality = "needs_review";
  else if (estimated) quality = "estimated";
  else if (distanceMm === null || reasons.length > 0) quality = "partial";
  else quality = "complete";
  const status = quality === "needs_review" ? "needs_review" : "saved";
  // PB 資格（R-07／08 使用）：只有跑步、量測距離（device／gps／organizer）、complete、非手動
  const pbEligible = w.sport === "run" && quality === "complete" && !manual && distanceMm !== null && distanceMm > 0n && distanceMethod !== "estimated";
  return { elapsedMs, quality, status, pbEligible, reviewReasons: reasons, distanceMm, distanceMethod, avgPaceSPerKm, avgSpeedKmh };
}
