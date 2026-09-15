/**
 * 運動 session 摘要 API（PG-R-01，activity-running-gallery 7、SD 13／16）。
 * - POST /workouts/import：玩家授權匯入（≤ 50 筆／次、限流）；request hash 冪等；同來源 revision 去重（stale 409、same 200、newer 取代）；跨來源重疊只標可能重複，不合併不相加。
 * - GET /me/workouts、GET /me/workouts/{id}、DELETE /me/workouts/{id}（tombstone）。
 * 大整數以十進位字串回傳；原始 GPS／健康紀錄不進後端。
 */
import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireAuth } from "../auth/routes.js";
import type { AuthService } from "../auth/service.js";
import { canonicalize, type Json } from "../claim/canonical.js";
import { ApiError } from "../errors.js";
import type { Store, WorkoutSession } from "../store/types.js";
import type { PersonalBestService } from "../pb/service.js";
import { derive, importBody, WORKOUT_RULES_VERSION } from "./schema.js";

const uuid = z.string().uuid();
const str = (b: bigint | null) => (b === null ? null : b.toString());

export function workoutView(w: WorkoutSession) {
  const km = w.distanceMm === null ? null : Number(w.distanceMm) / 1_000_000;
  const elapsedS = Number(w.elapsedMs) / 1000;
  return {
    session_id: w.sessionId, sport: w.sport, environment: w.environment,
    source: { origin: w.origin, source_id: w.sourceId, external_record_id: w.externalRecordId, source_revision: w.sourceRevision },
    started_at: w.startedAt.toISOString(), ended_at: w.endedAt.toISOString(), elapsed_ms: str(w.elapsedMs), paused_ms: str(w.pausedMs),
    status: w.status, quality: w.quality, rules_version: w.rulesVersion, review_reasons: w.reviewReasons, possible_duplicate_of: w.possibleDuplicateOf,
    metrics: {
      distance: w.distanceMm === null ? null : { value_mm: str(w.distanceMm), method: w.distanceMethod },
      steps: w.steps,
      active_energy: w.activeEnergyMkcal === null ? null : { value_mkcal: str(w.activeEnergyMkcal), method: w.energyMethod },
      total_energy: w.totalEnergyMkcal === null ? null : { value_mkcal: str(w.totalEnergyMkcal) },
      avg_pace_s_per_km: km && km > 0 ? Math.round(elapsedS / km) : null,
      avg_speed_kmh: km && km > 0 ? Number((km / (elapsedS / 3600)).toFixed(3)) : null,
      step_length_mm: w.stepLengthMm,
    },
    pb_eligible: w.pbEligible, extras: w.extras, revision: w.revision, imported_at: w.importedAt.toISOString(), updated_at: w.updatedAt.toISOString(),
  };
}

export async function workoutRoutes(app: FastifyInstance, opts: { auth: AuthService; store: Store; now: () => Date; pbs?: PersonalBestService }) {
  const { auth, store, now, pbs } = opts;

  app.post("/workouts/import", { preHandler: requireAuth(auth), config: { rateLimit: { max: app.config.RATE_LIMIT_SENSITIVE_PER_MINUTE, timeWindow: "1 minute" } } }, async (req, reply) => {
    const parsed = importBody.safeParse(req.body);
    if (!parsed.success) throw new ApiError(422, "VALIDATION", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const t = now();
    const wallet = req.auth!.wallet;
    const results = [];
    let created = 0;
    for (const w of parsed.data.sessions) {
      const d = derive(w);
      if (d.status === "invalid") { results.push({ external_record_id: w.external_record_id, outcome: "invalid", reasons: d.reviewReasons }); continue; }
      // request hash：來源鍵＋內容（不含伺服器衍生），用於稽核與重放比對
      const hash = createHash("sha256").update(canonicalize(JSON.parse(JSON.stringify({ ...w, started_at: w.started_at.toISOString(), ended_at: w.ended_at.toISOString(), paused_ms: w.paused_ms.toString(), distance_mm: w.distance_mm?.toString() ?? null, active_energy_mkcal: w.active_energy_mkcal?.toString() ?? null, total_energy_mkcal: w.total_energy_mkcal?.toString() ?? null })) as Json)).digest();
      const r = await store.upsertWorkout(
        {
          sessionId: randomUUID(), wallet, sport: w.sport, environment: w.environment, origin: w.origin, sourceId: w.source_id, externalRecordId: w.external_record_id, sourceRevision: w.source_revision,
          startedAt: w.started_at, endedAt: w.ended_at, elapsedMs: d.elapsedMs, pausedMs: w.paused_ms, status: d.status, quality: d.quality, rulesVersion: WORKOUT_RULES_VERSION,
          distanceMm: d.distanceMm, distanceMethod: d.distanceMethod, steps: w.steps, activeEnergyMkcal: w.active_energy_mkcal, energyMethod: w.energy_method, totalEnergyMkcal: w.total_energy_mkcal, stepLengthMm: w.step_length_mm,
          pbEligible: d.pbEligible, reviewReasons: d.reviewReasons, extras: w.extras, requestHash: hash,
        },
        t,
      );
      if (r.outcome === "created") created += 1;
      results.push({ external_record_id: w.external_record_id, outcome: r.outcome, session: workoutView(r.session) });
    }
    if (pbs && results.some((r) => r.outcome === "created" || r.outcome === "superseded")) await pbs.recompute(wallet); // PG-R-07：匯入後重算 PB
    return reply.status(created > 0 ? 201 : 200).send({ imported: created, results });
  });

  app.get("/me/workouts", { preHandler: requireAuth(auth) }, async (req) => {
    const q = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) }).parse(req.query ?? {});
    const items = await store.listWorkouts(req.auth!.wallet, q.limit, q.offset);
    return { items: items.map(workoutView), rules_version: WORKOUT_RULES_VERSION };
  });

  app.get("/me/workouts/:id", { preHandler: requireAuth(auth) }, async (req) => {
    const id = uuid.safeParse((req.params as { id: string }).id);
    if (!id.success) throw new ApiError(422, "VALIDATION", "id must be a uuid");
    const w = await store.getWorkout(req.auth!.wallet, id.data);
    if (!w) throw new ApiError(404, "NOT_FOUND", "workout not found");
    return workoutView(w);
  });

  app.delete("/me/workouts/:id", { preHandler: requireAuth(auth) }, async (req, reply) => {
    const id = uuid.safeParse((req.params as { id: string }).id);
    if (!id.success) throw new ApiError(422, "VALIDATION", "id must be a uuid");
    const ok = await store.deleteWorkout(req.auth!.wallet, id.data, now());
    if (!ok) throw new ApiError(404, "NOT_FOUND", "workout not found");
    if (pbs) await pbs.recompute(req.auth!.wallet); // 刪除 → 撤銷候選、重算（BR-40）
    return reply.status(204).send();
  });
}
