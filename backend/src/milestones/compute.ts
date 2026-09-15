/**
 * 首次里程碑判定（PG-M-01；commemorative-nfts 1、2、6；FR-17.1、BR-46）。純函式：來源 → 每個穩定 key 的「首次」。
 * - Genesis Distance：first_5k／first_10k／first_half／first_marathon，單次有效跑步（或主辦方 FINISHED 結果）距離 ≥ 門檻（整數毫米比較，不四捨五入）。
 * - First Finish：首個主辦方已發布 FINISHED 結果（run／walk）。
 * - 穩定 key＝(category, environment, verification_class)；不含來源 revision、匯入批次、規則版本（BR-47，M-02 沿用）。
 * - 「首次」＝目前有效來源中 achieved_at 最早者；同時間依 sourceId 穩定排序。不累加多次跑步、不用步數估距。
 * - 同一筆全馬可同時解鎖 5K／10K／半馬／全馬，皆引用同一來源。
 * - 裝置版半馬／全馬第一階段不開放（device_pending）；估算值／手動／待審資料不取得資格。
 */
export const MILESTONE_RULES_MAJOR = 1;
export type DistanceMilestone = "first_5k" | "first_10k" | "first_half" | "first_marathon";
export type MilestoneCategory = DistanceMilestone | "first_finish";
export type MilestoneEnvironment = "outdoor" | "indoor" | "unknown";
export type VerificationClass = "organizer" | "device";

export const MILESTONE_THRESHOLD_MM: Record<DistanceMilestone, bigint> = { first_5k: 5_000_000n, first_10k: 10_000_000n, first_half: 21_097_500n, first_marathon: 42_195_000n };
export const DISTANCE_MILESTONES: DistanceMilestone[] = ["first_5k", "first_10k", "first_half", "first_marathon"];
export const MILESTONE_CATEGORIES: MilestoneCategory[] = [...DISTANCE_MILESTONES, "first_finish"];
/** 裝置來源第一階段只開放 5K／10K；半馬／全馬待長距離品質規則與實機驗收 */
export const DEVICE_ENABLED: ReadonlySet<MilestoneCategory> = new Set<MilestoneCategory>(["first_5k", "first_10k"]);

export type MilestoneKey = { category: MilestoneCategory; environment: MilestoneEnvironment; verificationClass: VerificationClass };
export const milestoneKeyOf = (k: MilestoneKey) => `${k.category}|${k.environment}|${k.verificationClass}`;

/** 不合格原因（同時作為 UI 說明碼） */
export type IneligibleReason = "needs_review" | "estimated" | "manual" | "device_pending" | "missing_time";

export type MilestoneCandidate = MilestoneKey & {
  sourceKind: "workout" | "result";
  sourceId: string;
  sourceRevision: number;
  /** 來源的完成時間；缺可比時間（主辦方無賽事時間）→ null 且 reason=missing_time */
  achievedAt: Date | null;
  distanceMm: bigint;
  eligible: boolean;
  reason: IneligibleReason | null;
};

export type MilestoneStatus = "eligible" | "pending_review" | "device_pending" | "locked";
export type MilestoneResolution = MilestoneKey & {
  key: string;
  rulesMajor: number;
  thresholdMm: bigint | null;
  status: MilestoneStatus;
  /** eligible 時的首次來源；其餘 null */
  first: MilestoneCandidate | null;
  /** pending_review 時的最早待審來源（不揭露為成就） */
  pending: MilestoneCandidate | null;
};

export type WorkoutForMilestone = {
  sessionId: string; sourceRevision: number; endedAt: Date; sport: "run" | "walk"; environment: MilestoneEnvironment;
  origin: "health_connect" | "device" | "gps" | "organizer" | "manual"; status: "saved" | "needs_review" | "invalid" | "deleted";
  distanceMm: bigint | null; distanceMethod: "device" | "gps" | "estimated" | "organizer" | null; pbEligible: boolean;
};
export type ResultForMilestone = { revisionId: string; discipline: string; finishStatus: string; distanceM: number; /** 賽事時間（starts_at ?? ends_at）；缺 → null */ eventAt: Date | null };

export function candidatesFromWorkout(w: WorkoutForMilestone): MilestoneCandidate[] {
  if (w.sport !== "run" || w.status === "deleted" || w.status === "invalid" || w.distanceMm === null || w.distanceMm <= 0n) return [];
  const reason: IneligibleReason | null = w.origin === "manual" ? "manual" : w.distanceMethod === "estimated" || w.distanceMethod === null ? "estimated" : w.status === "needs_review" || !w.pbEligible ? "needs_review" : null;
  const out: MilestoneCandidate[] = [];
  for (const category of DISTANCE_MILESTONES) {
    if (w.distanceMm < MILESTONE_THRESHOLD_MM[category]) continue; // 4,999.999 m ≠ 5K
    const r = reason ?? (DEVICE_ENABLED.has(category) ? null : "device_pending");
    out.push({ category, environment: w.environment, verificationClass: "device", sourceKind: "workout", sourceId: w.sessionId, sourceRevision: w.sourceRevision, achievedAt: w.endedAt, distanceMm: w.distanceMm, eligible: r === null, reason: r });
  }
  return out;
}

export function candidatesFromResult(r: ResultForMilestone): MilestoneCandidate[] {
  if (r.finishStatus !== "finished" || (r.discipline !== "run" && r.discipline !== "walk")) return []; // DNS／DNF／DSQ 不授予
  const distanceMm = BigInt(Math.round(r.distanceM * 1000));
  const reason: IneligibleReason | null = r.eventAt === null ? "missing_time" : null;
  const base = { environment: "outdoor" as const, verificationClass: "organizer" as const, sourceKind: "result" as const, sourceId: r.revisionId, sourceRevision: 1, achievedAt: r.eventAt, distanceMm, eligible: reason === null, reason };
  const out: MilestoneCandidate[] = [{ ...base, category: "first_finish" }];
  if (r.discipline === "run") for (const category of DISTANCE_MILESTONES) if (distanceMm >= MILESTONE_THRESHOLD_MM[category]) out.push({ ...base, category }); // 主辦方正式距離為準
  return out;
}

const byFirst = (a: MilestoneCandidate, b: MilestoneCandidate) => (a.achievedAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.achievedAt?.getTime() ?? Number.MAX_SAFE_INTEGER) || a.sourceId.localeCompare(b.sourceId);

/** 固定目錄：每類別 organizer／device（戶外）各一張；候選另有環境（室內）時附加 */
export function catalogueKeys(cands: MilestoneCandidate[]): MilestoneKey[] {
  const keys = new Map<string, MilestoneKey>();
  for (const category of MILESTONE_CATEGORIES) {
    keys.set(milestoneKeyOf({ category, environment: "outdoor", verificationClass: "organizer" }), { category, environment: "outdoor", verificationClass: "organizer" });
    if (category !== "first_finish") keys.set(milestoneKeyOf({ category, environment: "outdoor", verificationClass: "device" }), { category, environment: "outdoor", verificationClass: "device" });
  }
  for (const c of cands) { const k = milestoneKeyOf(c); if (!keys.has(k)) keys.set(k, { category: c.category, environment: c.environment, verificationClass: c.verificationClass }); }
  return [...keys.values()];
}

/** 每個穩定 key 解析成一個狀態：eligible（最早有效來源）＞ pending_review ＞ device_pending ＞ locked */
export function resolveMilestones(cands: MilestoneCandidate[]): MilestoneResolution[] {
  const groups = new Map<string, MilestoneCandidate[]>();
  for (const c of cands) { const k = milestoneKeyOf(c); if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(c); }
  return catalogueKeys(cands).map((key) => {
    const list = [...(groups.get(milestoneKeyOf(key)) ?? [])].sort(byFirst);
    const thresholdMm = key.category === "first_finish" ? null : MILESTONE_THRESHOLD_MM[key.category];
    const first = list.find((c) => c.eligible) ?? null;
    const pending = list.find((c) => c.reason === "needs_review" || c.reason === "missing_time") ?? null;
    const status: MilestoneStatus = first ? "eligible" : pending ? "pending_review" : list.some((c) => c.reason === "device_pending") ? "device_pending" : "locked";
    return { ...key, key: milestoneKeyOf(key), rulesMajor: MILESTONE_RULES_MAJOR, thresholdMm, status, first, pending: first ? null : pending };
  });
}
