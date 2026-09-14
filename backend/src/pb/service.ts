/**
 * PersonalBestService（PG-R-07）：以錢包目前有效紀錄重算 PB 版本鏈並同步到 store（冪等）。
 * 觸發：運動匯入／刪除、成績發布（每個受影響錢包）、player 刪除（store 端一併刪）。
 */
import type { FastifyInstance } from "fastify";

import { requireAuth } from "../auth/routes.js";
import type { AuthService } from "../auth/service.js";
import type { PbRevision, Store } from "../store/types.js";
import { buildChains, candidatesFromResult, candidatesFromWorkout, keyOf, type PbCandidate } from "./compute.js";

export class PersonalBestService {
  constructor(private readonly store: Store, private readonly now: () => Date) {}

  async recompute(wallet: string): Promise<PbRevision[]> {
    const workouts = await this.store.listWorkouts(wallet, 1000, 0);
    const results = await this.store.listCurrentResultsForWallet(wallet);
    const cands: PbCandidate[] = [];
    for (const w of workouts) {
      if (w.sport !== "run" || w.status === "deleted") continue;
      const splits = (w.extras as { splits?: { distanceMm: number; durationMs: number; isPartial: boolean; uncertain: boolean }[] }).splits ?? null;
      cands.push(...candidatesFromWorkout({ sessionId: w.sessionId, sourceRevision: w.sourceRevision, startedAt: w.startedAt, endedAt: w.endedAt, environment: w.environment, distanceMm: w.distanceMm, pbEligible: w.pbEligible, splits }));
    }
    for (const r of results) if (r.discipline === "run") cands.push(...candidatesFromResult({ revisionId: r.revisionId, publishedAt: r.publishedAt, distanceM: r.distanceM, elapsedMs: r.elapsedMs, finishStatus: r.finishStatus }));
    const chains = buildChains(cands);
    const desired = [];
    for (const [key, chain] of chains) {
      for (let i = 0; i < chain.length; i++) {
        const c = chain[i]!;
        desired.push({ key, discipline: c.discipline, category: c.category, environment: c.environment, verificationClass: c.verificationClass, timingBasis: c.timingBasis, rulesMajor: c.rulesMajor, value: c.value, sourceKind: c.sourceKind, sourceId: c.sourceId, sourceRevision: c.sourceRevision, achievedAt: c.achievedAt, status: c.status, isBaseline: c.isBaseline, previousSourceId: i > 0 ? chain[i - 1]!.sourceId : null });
      }
    }
    return this.store.syncPbRevisions(wallet, desired, this.now());
  }
}

export function pbView(p: PbRevision) {
  return { pb_id: p.pbId, category: p.category, environment: p.environment, verification_class: p.verificationClass, timing_basis: p.timingBasis, rules_major: p.rulesMajor, value: p.value.toString(), unit: p.category === "longest_run" ? "mm" : "ms", source: { kind: p.sourceKind, id: p.sourceId, revision: p.sourceRevision }, achieved_at: p.achievedAt.toISOString(), status: p.status, is_baseline: p.isBaseline, previous_pb_id: p.previousPbId, invalidated_at: p.invalidatedAt?.toISOString() ?? null, reason: p.reason };
}

/** GET /me/personal-bests：每個 key 的 current 與歷史；附匯入涵蓋起點 */
export async function pbRoutes(app: FastifyInstance, opts: { auth: AuthService; store: Store; pbs: PersonalBestService }) {
  const { auth, store, pbs } = opts;
  app.get("/me/personal-bests", { preHandler: requireAuth(auth) }, async (req) => {
    const wallet = req.auth!.wallet;
    const rows = await pbs.recompute(wallet); // 讀取即重算（冪等；資料量小）
    const groups = new Map<string, PbRevision[]>();
    for (const r of rows) { const k = keyOf({ discipline: "run", category: r.category as never, environment: r.environment as never, verificationClass: r.verificationClass as never, timingBasis: r.timingBasis as never, rulesMajor: r.rulesMajor }); if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(r); }
    const workouts = await store.listWorkouts(wallet, 1000, 0);
    const since = workouts.reduce<Date | null>((m, w) => (m === null || w.startedAt < m ? w.startedAt : m), null);
    return {
      rules_major: 1,
      imported_since: since?.toISOString() ?? null,
      groups: [...groups.entries()].map(([key, list]) => ({ key, category: list[0]!.category, environment: list[0]!.environment, verification_class: list[0]!.verificationClass, timing_basis: list[0]!.timingBasis, current: list.find((x) => x.status === "current") ? pbView(list.find((x) => x.status === "current")!) : null, history: list.filter((x) => x.status !== "current").sort((a, b) => b.achievedAt.getTime() - a.achievedAt.getTime()).map(pbView) })),
    };
  });
}
