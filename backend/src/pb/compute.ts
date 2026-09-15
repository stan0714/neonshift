/**
 * PB 計算（PG-R-07；activity-running-gallery 5、BR-38）。純函式：候選 → 每個比較 key 的版本鏈。
 * - 候選來源：workout（裝置／GPS，需 pb_eligible；固定距離最快只在有完整分段序列時）與 result（主辦方已發布最新版、finished）。
 * - 比較 key：discipline＋category＋environment＋verification_class＋timing_basis＋rules_major；官方與裝置不混榜、戶外與室內不混比。
 * - 每 key 依 achieved_at 排序：首筆 Baseline；之後嚴格改善（更短時間／更長距離）才新增；相同數值不算。
 * - 只有總距離／總時間時不得推算最快路段（BR-38）：5K／10K 以連續完整非 uncertain 的 1 km 分段覆蓋 D 的最短區間。
 */
export const PB_RULES_MAJOR = 1;
export type PbCategory = "fastest_1k" | "fastest_5k" | "fastest_10k" | "fastest_half" | "fastest_marathon" | "longest_run";
export type PbKey = { discipline: "run"; category: PbCategory; environment: "outdoor" | "indoor" | "unknown"; verificationClass: "organizer" | "device"; timingBasis: "chip" | "gun" | "elapsed"; rulesMajor: number };
export type PbCandidate = PbKey & { value: bigint; sourceKind: "workout" | "result"; sourceId: string; sourceRevision: number; achievedAt: Date };
export type PbChainEntry = PbCandidate & { isBaseline: boolean; status: "current" | "historical" };

const FIXED: { category: PbCategory; meters: number; organizerOnly: boolean }[] = [
  { category: "fastest_1k", meters: 1000, organizerOnly: false },
  { category: "fastest_5k", meters: 5000, organizerOnly: false },
  { category: "fastest_10k", meters: 10000, organizerOnly: false },
  { category: "fastest_half", meters: 21097.5, organizerOnly: true },
  { category: "fastest_marathon", meters: 42195, organizerOnly: true },
];
const LONGEST_MIN_MM = 1_000_000n; // 最遠單次跑步至少 1 km 才建 PB

export const keyOf = (k: PbKey) => `${k.discipline}|${k.category}|${k.environment}|${k.verificationClass}|${k.timingBasis}|${k.rulesMajor}`;
const better = (category: PbCategory, a: bigint, b: bigint) => (category === "longest_run" ? a > b : a < b);

export type WorkoutForPb = { sessionId: string; sourceRevision: number; startedAt: Date; endedAt: Date; environment: "outdoor" | "indoor" | "unknown"; distanceMm: bigint | null; pbEligible: boolean; splits: { distanceMm: number; durationMs: number; isPartial: boolean; uncertain: boolean }[] | null };
export type ResultForPb = { revisionId: string; publishedAt: Date; distanceM: number; elapsedMs: number; finishStatus: string };

/** 從分段序列找完整覆蓋 D 的最短連續區間（只用完整、非 uncertain 的分段；不跨缺口） */
export function fastestWindowMs(splits: NonNullable<WorkoutForPb["splits"]>, targetMm: number): number | null {
  let best: number | null = null;
  for (let i = 0; i < splits.length; i++) {
    let dist = 0;
    let dur = 0;
    for (let j = i; j < splits.length; j++) {
      const s = splits[j]!;
      if (s.isPartial || s.uncertain) break; // 連續區間中斷
      dist += s.distanceMm;
      dur += s.durationMs;
      if (dist >= targetMm) {
        if (best === null || dur < best) best = dur;
        break;
      }
    }
  }
  return best;
}

export function candidatesFromWorkout(w: WorkoutForPb): PbCandidate[] {
  if (!w.pbEligible || w.distanceMm === null || w.distanceMm <= 0n) return [];
  const base = { discipline: "run" as const, environment: w.environment, verificationClass: "device" as const, timingBasis: "elapsed" as const, rulesMajor: PB_RULES_MAJOR, sourceKind: "workout" as const, sourceId: w.sessionId, sourceRevision: w.sourceRevision, achievedAt: w.endedAt };
  const out: PbCandidate[] = [];
  if (w.distanceMm >= LONGEST_MIN_MM) out.push({ ...base, category: "longest_run", value: w.distanceMm });
  if (w.splits && w.splits.length) {
    for (const f of FIXED) {
      if (f.organizerOnly) continue; // 半馬／全馬初期只接受主辦方
      const ms = fastestWindowMs(w.splits, f.meters * 1000);
      if (ms !== null && ms > 0) out.push({ ...base, category: f.category, value: BigInt(ms) });
    }
  }
  return out;
}

export function candidatesFromResult(r: ResultForPb): PbCandidate[] {
  if (r.finishStatus !== "finished" || r.elapsedMs <= 0 || r.distanceM <= 0) return [];
  const base = { discipline: "run" as const, environment: "outdoor" as const, verificationClass: "organizer" as const, timingBasis: "elapsed" as const, rulesMajor: PB_RULES_MAJOR, sourceKind: "result" as const, sourceId: r.revisionId, sourceRevision: 1, achievedAt: r.publishedAt };
  const out: PbCandidate[] = [];
  // 固定距離：與標準距離誤差 ≤ 1% 才歸類；否則只算最遠
  const fixed = FIXED.find((f) => Math.abs(r.distanceM - f.meters) / f.meters <= 0.01);
  if (fixed) out.push({ ...base, category: fixed.category, value: BigInt(r.elapsedMs) });
  if (r.distanceM * 1000 >= Number(LONGEST_MIN_MM)) out.push({ ...base, category: "longest_run", value: BigInt(Math.round(r.distanceM * 1000)) });
  return out;
}

/** 每個 key 的版本鏈：依 achieved_at（同時間依 sourceId 穩定）；Baseline → 嚴格改善才新增；最後一筆 current */
export function buildChains(cands: PbCandidate[]): Map<string, PbChainEntry[]> {
  const groups = new Map<string, PbCandidate[]>();
  for (const c of cands) {
    const k = keyOf(c);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(c);
  }
  const out = new Map<string, PbChainEntry[]>();
  for (const [k, list] of groups) {
    list.sort((a, b) => a.achievedAt.getTime() - b.achievedAt.getTime() || a.sourceId.localeCompare(b.sourceId));
    const chain: PbChainEntry[] = [];
    for (const c of list) {
      const last = chain[chain.length - 1];
      if (!last) chain.push({ ...c, isBaseline: true, status: "historical" });
      else if (better(c.category, c.value, last.value)) chain.push({ ...c, isBaseline: false, status: "historical" });
    }
    if (chain.length) chain[chain.length - 1]!.status = "current";
    out.set(k, chain);
  }
  return out;
}
