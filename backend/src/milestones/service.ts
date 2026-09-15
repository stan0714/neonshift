/**
 * MilestoneService（PG-M-01）：以錢包目前有效紀錄判定每個穩定 key 的「首次」（讀取即重算，冪等；M-02 再落地 registry／receipt）。
 * 主辦方結果的完成時間取賽事 starts_at ?? ends_at；缺少 → 待審，不用發布／匯入時間冒充首次時間。
 */
import type { FastifyInstance } from "fastify";

import { requireAuth } from "../auth/routes.js";
import type { AuthService } from "../auth/service.js";
import type { EventRow, Store } from "../store/types.js";
import { candidatesFromResult, candidatesFromWorkout, resolveMilestones, type MilestoneCandidate, type MilestoneResolution } from "./compute.js";

export class MilestoneService {
  constructor(private readonly store: Store) {}

  async resolve(wallet: string): Promise<{ resolutions: MilestoneResolution[]; candidates: MilestoneCandidate[]; importedSince: Date | null }> {
    const workouts = await this.store.listWorkouts(wallet, 1000, 0);
    const results = await this.store.listCurrentResultsForWallet(wallet);
    const cands: MilestoneCandidate[] = [];
    for (const w of workouts) cands.push(...candidatesFromWorkout({ sessionId: w.sessionId, sourceRevision: w.sourceRevision, endedAt: w.endedAt, sport: w.sport, environment: w.environment, origin: w.origin, status: w.status, distanceMm: w.distanceMm, distanceMethod: w.distanceMethod, pbEligible: w.pbEligible }));
    const events = new Map<string, EventRow | null>();
    for (const r of results) {
      if (!events.has(r.eventId)) events.set(r.eventId, await this.store.getEvent(r.eventId));
      const ev = events.get(r.eventId);
      cands.push(...candidatesFromResult({ revisionId: r.revisionId, discipline: r.discipline, finishStatus: r.finishStatus, distanceM: r.distanceM, eventAt: ev?.startsAt ?? ev?.endsAt ?? null }));
    }
    const importedSince = workouts.reduce<Date | null>((m, w) => (w.status === "deleted" ? m : m === null || w.startedAt < m ? w.startedAt : m), null);
    return { resolutions: resolveMilestones(cands), candidates: cands, importedSince };
  }
}

const candidateView = (c: MilestoneCandidate) => ({ source: { kind: c.sourceKind, id: c.sourceId, revision: c.sourceRevision }, achieved_at: c.achievedAt?.toISOString() ?? null, distance_mm: c.distanceMm.toString(), reason: c.reason });

export function milestoneView(m: MilestoneResolution) {
  return { key: m.key, category: m.category, environment: m.environment, verification_class: m.verificationClass, rules_major: m.rulesMajor, threshold_mm: m.thresholdMm?.toString() ?? null, status: m.status, first: m.first ? candidateView(m.first) : null, pending: m.pending ? candidateView(m.pending) : null };
}

/** GET /me/milestones：目錄（每 key 一張）、同一來源解鎖清單（「本次解鎖 N 個里程碑」）、匯入涵蓋起點 */
export async function milestoneRoutes(app: FastifyInstance, opts: { auth: AuthService; milestones: MilestoneService }) {
  app.get("/me/milestones", { preHandler: requireAuth(opts.auth) }, async (req) => {
    const { resolutions, importedSince } = await opts.milestones.resolve(req.auth!.wallet);
    const bySource = new Map<string, { kind: string; id: string; categories: string[] }>();
    for (const m of resolutions) {
      if (!m.first) continue;
      const id = `${m.first.sourceKind}:${m.first.sourceId}`;
      if (!bySource.has(id)) bySource.set(id, { kind: m.first.sourceKind, id: m.first.sourceId, categories: [] });
      bySource.get(id)!.categories.push(m.category);
    }
    return { rules_major: 1, imported_since: importedSince?.toISOString() ?? null, items: resolutions.map(milestoneView), unlocked_by_source: [...bySource.values()] };
  });
}
