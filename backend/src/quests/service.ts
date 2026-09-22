/**
 * 探索冊任務（PG-U-04；sport-experience-gameplay 5；SD 17）。
 * - 模板版本化；接受時固定模板版本、目標、時區與起訖 UTC（本地週一 00:00 起 7 天）；每玩家每模板每週期一份。
 * - 只計接受後開始、截止前結束的活動；截止後 48 小時接受延遲同步；同日多筆只算一個活躍日；拆分 session 不能累加為單次目標。
 * - 有效活動：saved 且非待審／估算、run／walk、非手動暫停時長 ≥ 10 分鐘；GPS 來源需 ≥ `QUEST_GPS_MIN_RULES_VERSION`（未設定＝不計）。
 * - 資格由伺服器依有效摘要計算（不接受 client 自報）；發放 receipt 與外觀權限同交易；來源刪除／修正重算，失去證據 → 撤銷並停用外觀。
 * - 獎勵只有帳號綁定外觀：無代幣、無維持點、無能力加成；不寫鏈上。
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireAuth } from "../auth/routes.js";
import type { AuthService } from "../auth/service.js";
import { ApiError } from "../errors.js";
import type { QuestContribution, QuestEnrollment, QuestTemplate, Store, WorkoutSession } from "../store/types.js";
import { WORKOUT_RULES_VERSION } from "../workouts/schema.js";

export const QUEST_MIN_ACTIVE_MS = 10 * 60_000;
export const QUEST_LATE_SYNC_MS = 48 * 3_600_000;
const PERIOD_MS = 7 * 86_400_000;

/** 指定時區的本地 YYYY-MM-DD */
export function localDay(d: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
/** 指定時區該時刻的 UTC 偏移（分鐘） */
function offsetMinutes(d: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - d.getTime()) / 60_000);
}
/** 本地週一 00:00 → UTC；週期 7 天（不因期中改時區重開） */
export function localWeekBoundsUtc(now: Date, timeZone: string): { periodStart: Date; periodEnd: Date } {
  const [y, m, d] = localDay(now, timeZone).split("-").map(Number) as [number, number, number];
  const localMidnight = new Date(Date.UTC(y, m - 1, d));
  const weekday = (localMidnight.getUTCDay() + 6) % 7; // Mon=0
  const mondayLocal = new Date(localMidnight.getTime() - weekday * 86_400_000);
  const approx = new Date(mondayLocal.getTime() - offsetMinutes(now, timeZone) * 60_000);
  const start = new Date(mondayLocal.getTime() - offsetMinutes(approx, timeZone) * 60_000); // 以週一當地時刻的偏移修正（DST）
  return { periodStart: start, periodEnd: new Date(start.getTime() + PERIOD_MS) };
}
export const isValidTimeZone = (tz: string) => { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; } };

export type QuestEvaluation = { contributions: QuestContribution[]; progress: { current: number; target: number }; completed: boolean; /** XD-01：週期內符合運動種類但仍待審／未同步完成的筆數（卡面「待驗證」；不當成進度） */ pendingReview: number };
/** XD-01 卡面狀態：可接受 → 已接受 → 進行中 → 待驗證 → 可領 → 已領／已撤銷／已過期（伺服器計算，App 不自行推定） */
export type QuestCardState = "available" | "accepted" | "in_progress" | "pending_verification" | "claimable" | "claimed" | "revoked" | "expired";
export function cardStateOf(e: QuestEnrollment, ev: QuestEvaluation | undefined): QuestCardState {
  if (e.status === "claimed") return "claimed";
  if (e.status === "revoked") return "revoked";
  if (e.status === "expired") return "expired";
  if (e.status === "completed") return "claimable";
  if (!ev) return "accepted";
  if (ev.pendingReview > 0) return "pending_verification";
  return ev.progress.current > 0 ? "in_progress" : "accepted";
}
/** 卡面難度（固定、非稀有度）：只依目標大小 */
export function difficultyOf(t: QuestTemplate, goal?: Record<string, unknown>): "easy" | "medium" {
  if (t.kind === "active_days") return Number((t.params as { days?: number }).days ?? 3) >= 3 ? "medium" : "easy";
  const minutes = Number((goal as { minutes?: number } | undefined)?.minutes ?? Math.min(...(((t.params as { minutes?: number[] }).minutes ?? [20]) as number[])));
  return minutes >= 30 ? "medium" : "easy";
}

export class QuestService {
  constructor(private readonly store: Store, private readonly now: () => Date, readonly gpsMinRulesVersion: number | null) {}

  /**
   * 任務卡「GPS 是否計入」必須和實際評分一致：門檻高於伺服器現行的運動品質版本時，
   * 沒有任何 GPS 活動過得了 isEligible，卡片就不能說會計入（設錯值只會讓任務永遠不完成）。
   */
  get gpsRewardsEnabled(): boolean {
    return this.gpsMinRulesVersion !== null && WORKOUT_RULES_VERSION >= this.gpsMinRulesVersion;
  }

  private eligible(w: WorkoutSession, e: QuestEnrollment): boolean {
    if (w.status !== "saved" || w.quality === "needs_review" || w.quality === "estimated" || w.quality === "invalid") return false;
    if (w.sport !== "run" && w.sport !== "walk") return false;
    if (w.startedAt < e.acceptedAt || w.endedAt >= e.periodEnd) return false;
    if (w.importedAt.getTime() > e.periodEnd.getTime() + QUEST_LATE_SYNC_MS) return false; // 晚到超過 48 小時不追溯
    if (w.elapsedMs - w.pausedMs < BigInt(QUEST_MIN_ACTIVE_MS)) return false;
    if (w.origin === "gps" && (this.gpsMinRulesVersion === null || w.rulesVersion < this.gpsMinRulesVersion)) return false; // R-10 品質規則版本未定案不發獎
    return true;
  }

  /** 週期內、種類正確、但因待審而暫不計的筆數（不含估算／手動／GPS 版本未開放：那些不是「等一下就會算」） */
  private pendingReviewCount(e: QuestEnrollment, workouts: WorkoutSession[]): number {
    return workouts.filter((w) => (w.sport === "run" || w.sport === "walk") && w.status === "needs_review" && w.startedAt >= e.acceptedAt && w.endedAt < e.periodEnd && w.elapsedMs - w.pausedMs >= BigInt(QUEST_MIN_ACTIVE_MS) && !(w.origin === "gps" && (this.gpsMinRulesVersion === null || w.rulesVersion < this.gpsMinRulesVersion))).length;
  }

  evaluate(e: QuestEnrollment, t: QuestTemplate, workouts: WorkoutSession[]): QuestEvaluation {
    const pendingReview = this.pendingReviewCount(e, workouts);
    const valid = workouts.filter((w) => this.eligible(w, e)).sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
    if (t.kind === "active_days") {
      const days = Number((t.params as { days?: number }).days ?? 3);
      const seen = new Map<string, WorkoutSession>();
      for (const w of valid) { const d = localDay(w.startedAt, e.timezone); if (!seen.has(d)) seen.set(d, w); } // 同日多筆只算一天
      const contributions = [...seen.entries()].slice(0, days).map(([d, w]) => ({ enrollmentId: e.enrollmentId, sourceKind: "workout" as const, sourceId: w.sessionId, sourceRevision: w.sourceRevision, localDay: d }));
      return { contributions, progress: { current: Math.min(days, seen.size), target: days }, completed: seen.size >= days, pendingReview };
    }
    // goal_time：單次 session 的目標快照與接受時選定分鐘一致，且非暫停時長 ≥ 目標（拆分不累加）
    const minutes = Number((e.goal as { minutes?: number }).minutes ?? 0);
    const hit = valid.find((w) => w.goalSnapshot?.kind === "time" && w.goalSnapshot.unit === "s" && w.goalSnapshot.target === minutes * 60 && w.elapsedMs - w.pausedMs >= BigInt(minutes * 60_000));
    return { contributions: hit ? [{ enrollmentId: e.enrollmentId, sourceKind: "workout", sourceId: hit.sessionId, sourceRevision: hit.sourceRevision, localDay: localDay(hit.startedAt, e.timezone) }] : [], progress: { current: hit ? 1 : 0, target: 1 }, completed: !!hit, pendingReview };
  }

  async accept(wallet: string, input: { templateId: string; goal: Record<string, unknown>; timezone: string; idempotencyKey: string }) {
    const t = (await this.store.listQuestTemplates()).find((x) => x.templateId === input.templateId);
    if (!t) throw new ApiError(404, "NOT_FOUND", "quest template not found");
    let goal: Record<string, unknown> = {};
    if (t.kind === "goal_time") {
      const allowed = ((t.params as { minutes?: number[] }).minutes ?? []) as number[];
      const minutes = Number((input.goal as { minutes?: unknown }).minutes);
      if (!allowed.includes(minutes)) throw new ApiError(422, "VALIDATION", `goal.minutes must be one of ${allowed.join("/")}`);
      goal = { minutes };
    }
    const now = this.now();
    const { periodStart, periodEnd } = localWeekBoundsUtc(now, input.timezone);
    // 每玩家每模板每週期一份：與既有同模板週期重疊（含改時區）→ 回既有，不另開
    const overlap = (await this.store.listQuestEnrollments(wallet)).find((x) => x.templateId === t.templateId && x.periodStart < periodEnd && x.periodEnd > periodStart);
    if (overlap) return { enrollment: overlap, created: false };
    return this.store.createQuestEnrollment({ enrollmentId: randomUUID(), wallet, templateId: t.templateId, templateVersion: t.version, goal, timezone: input.timezone, periodStart, periodEnd, acceptedAt: now, idempotencyKey: input.idempotencyKey }, now);
  }

  /** 重算所有 enrollment（匯入、刪除、更正後呼叫）；回傳最新狀態 */
  async reevaluate(wallet: string): Promise<{ enrollment: QuestEnrollment; template: QuestTemplate; evaluation: QuestEvaluation }[]> {
    const now = this.now();
    const [enrollments, templates, workouts] = await Promise.all([this.store.listQuestEnrollments(wallet), this.store.listQuestTemplates(), this.store.listWorkouts(wallet, 1000, 0)]);
    const out = [];
    for (let e of enrollments) {
      const t = templates.find((x) => x.templateId === e.templateId && x.version === e.templateVersion);
      if (!t) continue;
      const ev = this.evaluate(e, t, workouts);
      await this.store.replaceQuestContributions(e.enrollmentId, ev.contributions);
      if (e.status === "claimed" && !ev.completed) {
        await this.store.revokeQuestReceipt(e.enrollmentId, "source_removed_or_corrected", now); // 失去唯一有效證據 → 撤銷外觀，保留最小 receipt
        e = (await this.store.getQuestEnrollment(wallet, e.enrollmentId))!;
      } else if (e.status === "revoked" && ev.completed) {
        e = (await this.store.setQuestEnrollmentStatus(e.enrollmentId, "completed", now, now))!; // 重新符合：同 enrollment 可再領（receipt 沿用）
      } else if (e.status === "active" && ev.completed) {
        e = (await this.store.setQuestEnrollmentStatus(e.enrollmentId, "completed", now, now))!;
      } else if (e.status === "completed" && !ev.completed) {
        e = (await this.store.setQuestEnrollmentStatus(e.enrollmentId, "active", null, now))!;
      } else if (e.status === "active" && now.getTime() > e.periodEnd.getTime() + QUEST_LATE_SYNC_MS) {
        e = (await this.store.setQuestEnrollmentStatus(e.enrollmentId, "expired", null, now))!;
      }
      out.push({ enrollment: e, template: t, evaluation: ev });
    }
    return out;
  }

  async claim(wallet: string, enrollmentId: string) {
    const list = await this.reevaluate(wallet);
    const item = list.find((x) => x.enrollment.enrollmentId === enrollmentId);
    if (!item) throw new ApiError(404, "NOT_FOUND", "quest not found");
    if (item.enrollment.status === "claimed") return { receipt: (await this.store.getQuestReceipt(enrollmentId))!, created: false, enrollment: item.enrollment };
    if (!item.evaluation.completed) throw new ApiError(409, "QUEST_NOT_COMPLETED", `quest is ${item.enrollment.status}`);
    const existing = await this.store.getQuestReceipt(enrollmentId);
    const now = this.now();
    if (existing) {
      // 曾撤銷後重新符合：沿用同 receipt 與外觀，不重發
      await this.store.restoreQuestReceipt(enrollmentId, now);
      return { receipt: existing, created: false, enrollment: (await this.store.getQuestEnrollment(wallet, enrollmentId))! };
    }
    const r = await this.store.issueQuestReceipt({ receiptId: randomUUID(), wallet, enrollmentId, cosmeticId: item.template.cosmeticId, issuedAt: now }, now);
    return { ...r, enrollment: (await this.store.getQuestEnrollment(wallet, enrollmentId))! };
  }
}

/** XD-01 卡面欄位：來源、難度、資料要求、獎勵類型、開始時帶入的目標（App 不自行推定） */
const cardOf = (t: QuestTemplate, gpsEnabled: boolean, goal?: Record<string, unknown>) => ({
  source: "system" as const,
  difficulty: difficultyOf(t, goal),
  requirements: { min_active_minutes: QUEST_MIN_ACTIVE_MS / 60_000, sports: ["run", "walk"] as const, gps_counts: gpsEnabled, needs_sync: true },
  reward: { kind: "cosmetic" as const, cosmetic_id: t.cosmeticId },
  start: t.kind === "goal_time" ? { goal: { kind: "time" as const, minutes: Number((goal as { minutes?: number } | undefined)?.minutes ?? 0) || null } } : { goal: { kind: "free" as const } },
});
const templateView = (t: QuestTemplate, gpsEnabled: boolean) => ({ template_id: t.templateId, version: t.version, kind: t.kind, params: t.params, cosmetic_id: t.cosmeticId, card: cardOf(t, gpsEnabled) });
const enrollmentView = (e: QuestEnrollment, ev?: QuestEvaluation, t?: QuestTemplate, gpsEnabled = false) => ({ enrollment_id: e.enrollmentId, template_id: e.templateId, template_version: e.templateVersion, goal: e.goal, timezone: e.timezone, period_start: e.periodStart.toISOString(), period_end: e.periodEnd.toISOString(), late_sync_until: new Date(e.periodEnd.getTime() + QUEST_LATE_SYNC_MS).toISOString(), accepted_at: e.acceptedAt.toISOString(), status: e.status, card_state: cardStateOf(e, ev), pending_review_count: ev?.pendingReview ?? 0, card: t ? cardOf(t, gpsEnabled, e.goal) : null, completed_at: e.completedAt?.toISOString() ?? null, progress: ev?.progress ?? null, contributions: ev?.contributions.map((c) => ({ source: { kind: c.sourceKind, id: c.sourceId, revision: c.sourceRevision }, local_day: c.localDay })) ?? [] });

export async function questRoutes(app: FastifyInstance, opts: { auth: AuthService; store: Store; quests: QuestService }) {
  const { auth, store, quests } = opts;
  app.get("/me/quests", { preHandler: requireAuth(auth) }, async (req) => {
    const wallet = req.auth!.wallet;
    const [templates, list, cosmetics] = await Promise.all([store.listQuestTemplates(), quests.reevaluate(wallet), store.listCosmetics(wallet)]);
    const gpsEnabled = quests.gpsRewardsEnabled;
    return { templates: templates.map((t) => templateView(t, gpsEnabled)), enrollments: list.map((x) => enrollmentView(x.enrollment, x.evaluation, x.template, gpsEnabled)), cosmetics: cosmetics.map((c) => ({ cosmetic_id: c.cosmeticId, receipt_id: c.receiptId, status: c.status, granted_at: c.grantedAt.toISOString() })), rules: { min_active_minutes: QUEST_MIN_ACTIVE_MS / 60_000, late_sync_hours: QUEST_LATE_SYNC_MS / 3_600_000, gps_rewards_enabled: quests.gpsRewardsEnabled } };
  });
  app.post("/me/quests/accept", { preHandler: requireAuth(auth) }, async (req, reply) => {
    const b = z.object({ template_id: z.string().min(1).max(40), goal: z.record(z.string(), z.unknown()).default({}), timezone: z.string().min(1).max(64), idempotency_key: z.string().min(8).max(80) }).strict().safeParse(req.body ?? {});
    if (!b.success) throw new ApiError(422, "VALIDATION", "template_id, timezone and idempotency_key are required");
    if (!isValidTimeZone(b.data.timezone)) throw new ApiError(422, "VALIDATION", "timezone must be an IANA time zone");
    const r = await quests.accept(req.auth!.wallet, { templateId: b.data.template_id, goal: b.data.goal, timezone: b.data.timezone, idempotencyKey: b.data.idempotency_key });
    const t = (await store.listQuestTemplates()).find((x) => x.templateId === r.enrollment.templateId && x.version === r.enrollment.templateVersion);
    return reply.status(r.created ? 201 : 200).send({ enrollment: enrollmentView(r.enrollment, undefined, t, quests.gpsRewardsEnabled), already: !r.created });
  });
  app.post("/me/quests/:id/claim", { preHandler: requireAuth(auth) }, async (req) => {
    const id = z.string().uuid().safeParse((req.params as { id: string }).id);
    if (!id.success) throw new ApiError(422, "VALIDATION", "id must be a uuid");
    const r = await quests.claim(req.auth!.wallet, id.data);
    const t = (await store.listQuestTemplates()).find((x) => x.templateId === r.enrollment.templateId && x.version === r.enrollment.templateVersion);
    return { receipt: { receipt_id: r.receipt.receiptId, cosmetic_id: r.receipt.cosmeticId, issued_at: r.receipt.issuedAt.toISOString() }, already: !r.created, enrollment: enrollmentView(r.enrollment, undefined, t, quests.gpsRewardsEnabled) };
  });
}
