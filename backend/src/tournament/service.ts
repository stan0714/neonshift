/**
 * 賽事 API（PG-B-14，SD 4.1／4.2 UC-07／UC-08）。
 * - 賽事狀態、時段、質押金額全部讀鏈上 Tournament（ChainReader），後端不持有第二份真相。
 * - `/tournament/steps` 涉及已質押資產：request-specific 錢包簽章（domain NEONSHIFT_TOURNAMENT_STEPS_V1）、
 *   單次 challenge（task_date = week_id、task_type = 1）、request hash 與 Idempotency-Key；只有 Bearer JWT 不足。
 * - `verified_steps` 單調不減；只計 `starts_at <= reached_at < ends_at`；來源歸因與每小時 250×60 夾限、
 *   上限 40,000 × 天數。
 */
import type { ChallengeService } from "../auth/challenge.js";
import type { ChainReader } from "../chain/reader.js";
import { nextWeekId, weekIdOf, type TournamentView } from "../chain/tournament.js";
import { requestHashOf, type Json } from "../claim/canonical.js";
import { ALLOWED_SOURCE_KINDS, MAX_STEPS_PER_DAY, MAX_STEPS_PER_MINUTE } from "../claim/steps.js";
import { ApiError } from "../errors.js";
import type { Store } from "../store/types.js";
import { buildManifest } from "./manifest.js";
import { tournamentStepsRequestSchema } from "./schema.js";

export const LEADERBOARD_LIMIT = 100;

export type StepsOutcome = { httpStatus: number; body: Record<string, Json> };

export class TournamentService {
  constructor(
    private readonly store: Store,
    private readonly chain: ChainReader,
    private readonly challenge: ChallengeService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** 目前賽事：本週優先；本週不存在或已結束（settled／cancelled 且已過 ends_at）則看下一週 */
  async current(wallet: string | null) {
    const now = this.now();
    const nowUnix = Math.floor(now.getTime() / 1000);
    const thisWeek = weekIdOf(now);
    let t = await this.chain.getTournament(thisWeek);
    if (!t || ((t.status === "settled" || t.status === "cancelled") && nowUnix >= t.endsAt)) {
      const next = await this.chain.getTournament(nextWeekId(thisWeek, now));
      if (next) t = next;
    }
    if (!t) return { tournament: null, server_time: nowUnix };
    const joined = wallet ? await this.chain.hasEntry(t.weekId, wallet) : false;
    const mine = wallet ? await this.store.getTournamentSteps(t.weekId, wallet) : null;
    return {
      tournament: this.view(t, nowUnix),
      player: wallet ? { joined, verified_steps: mine?.verifiedSteps ?? 0, rank: joined ? await this.store.rankOf(t.weekId, wallet) : null } : null,
      server_time: nowUnix,
    };
  }

  view(t: TournamentView, nowUnix: number) {
    return {
      week_id: t.weekId,
      address: t.address,
      status: t.status,
      stake_amount: t.stakeAmount.toString(),
      treasury_injection_cap: t.treasuryInjectionCap.toString(),
      treasury_injection: t.treasuryInjection.toString(),
      entrant_count: t.entrantCount,
      valid_entrant_count: t.validEntrantCount,
      forfeited_count: t.forfeitedCount,
      min_entrants: t.minEntrants,
      group_a_size: t.groupASize,
      group_b_size: t.groupBSize,
      prize_a_bps: t.prizeABps,
      prize_b_bps: t.prizeBBps,
      loser_refund_bps: t.loserRefundBps,
      registration_ends_at: t.registrationEndsAt,
      starts_at: t.startsAt,
      ends_at: t.endsAt,
      rules_version: t.rulesVersion,
      registration_open: t.status === "registration" && nowUnix < t.registrationEndsAt,
      // 產出：可分配獎金池等只在結算後有意義
      settlement: t.status === "settling" || t.status === "settled" ? { distributable_pool: t.distributablePool.toString(), total_refund: t.totalRefund.toString(), total_prize: t.totalPrize.toString(), treasury_remainder: t.treasuryRemainder.toString(), results_submitted: t.resultsSubmitted } : null,
    };
  }

  /** 排行榜（含 generated_at 與本人名次；地址遮罩由 App 負責，本人 row 需要完整地址） */
  async leaderboard(weekId: number, wallet: string | null) {
    const t = await this.chain.getTournament(weekId);
    if (!t) throw new ApiError(404, "NOT_FOUND", "tournament not found");
    const rows = await this.store.listTournamentSteps(weekId, LEADERBOARD_LIMIT);
    const total = await this.store.countTournamentSteps(weekId);
    const now = this.now();
    const you = wallet ? { rank: await this.store.rankOf(weekId, wallet), verified_steps: (await this.store.getTournamentSteps(weekId, wallet))?.verifiedSteps ?? 0 } : null;
    return {
      week_id: weekId,
      status: t.status,
      generated_at: now.toISOString(),
      total_players: total,
      entries: rows.map((r, i) => ({ rank: i + 1, wallet: r.wallet, verified_steps: r.verifiedSteps, first_reached_at: r.firstReachedAt?.toISOString() ?? null, updated_at: r.updatedAt.toISOString() })),
      you,
    };
  }

  async submitSteps(wallet: string, idempotencyKey: string, rawBody: unknown): Promise<StepsOutcome> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
      throw new ApiError(400, "VALIDATION", "Idempotency-Key must be a UUID");
    }
    const parsed = tournamentStepsRequestSchema.safeParse(rawBody);
    if (!parsed.success) throw new ApiError(400, "VALIDATION", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const req = parsed.data;
    const requestHash = requestHashOf(rawBody as Record<string, Json>);
    const now = this.now();
    const nowUnix = Math.floor(now.getTime() / 1000);

    const begin = await this.store.beginClaim(wallet, idempotencyKey, requestHash, now);
    if (!begin.acquired) {
      const ex = begin.existing!;
      if (!ex.requestHash.equals(requestHash)) throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was used with a different payload");
      if (ex.status === "processing") throw new ApiError(409, "IDEMPOTENCY_IN_PROGRESS", "a request with this key is being processed");
      return { httpStatus: ex.httpStatus!, body: ex.response as StepsOutcome["body"] };
    }

    try {
      await this.challenge.verifyAndConsume(
        wallet,
        { purpose: "tournament_steps", requestHash, taskDate: req.week_id, taskType: 1 },
        { challengeB64: req.claim_authorization.challenge_b64, expiresAt: req.claim_authorization.expires_at, signatureB64: req.claim_authorization.signature_b64 },
      );

      const t = await this.chain.getTournament(req.week_id);
      if (!t) throw new ApiError(404, "NOT_FOUND", "tournament not found");
      if (t.status !== "running") throw new ApiError(409, "TOURNAMENT_NOT_RUNNING", `tournament is ${t.status}`);
      if (!(await this.chain.hasEntry(req.week_id, wallet))) throw new ApiError(403, "NOT_ENTERED", "wallet has no onchain entry for this tournament");
      if (req.reached_at < t.startsAt || req.reached_at >= t.endsAt) throw new ApiError(422, "OUTSIDE_WINDOW", "reached_at must be within the tournament window");
      if (req.reached_at > nowUnix + 60) throw new ApiError(422, "OUTSIDE_WINDOW", "reached_at is in the future");

      // 來源歸因 + 每小時桶夾限（250/min × 60）+ 天數上限
      const attributed = req.data_origins.filter((o) => ALLOWED_SOURCE_KINDS.has(o.source_kind)).reduce((n, o) => n + o.steps, 0);
      const hours = Math.ceil((t.endsAt - t.startsAt) / 3600);
      let clamped = 0;
      for (const [h, steps] of req.step_rate_summary.buckets) {
        if (h >= hours) throw new ApiError(400, "VALIDATION", "step_rate_summary bucket outside the tournament window");
        clamped += Math.min(steps, MAX_STEPS_PER_MINUTE * 60);
      }
      const bucketTotal = req.step_rate_summary.buckets.reduce((n, b) => n + b[1], 0);
      if (bucketTotal !== attributed) throw new ApiError(400, "VALIDATION", "step_rate_summary buckets do not add up to attributed steps");
      const dayCap = MAX_STEPS_PER_DAY * Math.ceil((t.endsAt - t.startsAt) / 86_400);
      const verified = Math.min(req.steps, attributed, clamped, dayCap);

      const { row, changed } = await this.store.upsertTournamentSteps(req.week_id, wallet, verified, new Date(req.reached_at * 1000), now);
      const body: StepsOutcome["body"] = {
        week_id: req.week_id,
        verified_steps: row.verifiedSteps,
        submitted_steps: req.steps,
        accepted: changed,
        first_reached_at: row.firstReachedAt?.toISOString() ?? null,
        rank: await this.store.rankOf(req.week_id, wallet),
      };
      await this.store.completeClaim(wallet, idempotencyKey, "succeeded", 200, body, now);
      return { httpStatus: 200, body };
    } catch (e) {
      if (e instanceof ApiError && e.statusCode >= 400 && e.statusCode < 500 && e.statusCode !== 401 && e.statusCode !== 409) {
        await this.store.completeClaim(wallet, idempotencyKey, "rejected", e.statusCode, e.toBody(), now);
      } else {
        await this.store.releaseClaim(wallet, idempotencyKey);
      }
      throw e;
    }
  }

  /** 結算 manifest（ops）：只在 ends_at 之後、Running／Settling 狀態產生 */
  async manifest(weekId: number) {
    const t = await this.chain.getTournament(weekId);
    if (!t) throw new ApiError(404, "NOT_FOUND", "tournament not found");
    const nowUnix = Math.floor(this.now().getTime() / 1000);
    if (nowUnix < t.endsAt) throw new ApiError(409, "TOURNAMENT_NOT_ENDED", "tournament has not ended");
    if (t.status !== "running" && t.status !== "settling") throw new ApiError(409, "TOURNAMENT_NOT_RUNNING", `tournament is ${t.status}`);
    const entries = await this.chain.listEntries(weekId);
    const steps = await this.store.listTournamentSteps(weekId, Number.MAX_SAFE_INTEGER);
    const m = buildManifest(weekId, t.address, entries, steps);
    const chainExpected = t.validEntrantCount - t.forfeitedCount;
    return { ...m, chain_expected_count: chainExpected, consistent: chainExpected === m.expected_count, generated_at: this.now().toISOString(), rules_version: t.rulesVersion };
  }

  /** BR-25：有已質押且尚未 Settled／Cancelled 的賽事 → 刪除延後至該賽事 ends_at（不超過保留上限） */
  async activeStakedUntil(wallet: string): Promise<number | null> {
    const now = this.now();
    const thisWeek = weekIdOf(now);
    for (const weekId of [thisWeek, nextWeekId(thisWeek, now)]) {
      const t = await this.chain.getTournament(weekId);
      if (!t || t.status === "settled" || t.status === "cancelled" || t.status === "draft") continue;
      if (await this.chain.hasEntry(weekId, wallet)) return t.endsAt;
    }
    return null;
  }
}
