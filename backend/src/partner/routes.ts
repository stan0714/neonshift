/**
 * 合作活動管理 API（PG-E-02，SD 11.2）：組織／成員、活動草稿（revision 樂觀鎖）、規則版本、發布／取消、活動角色；
 * 公開活動讀取（不含名單、wallet、聯絡資料）。組織建立與第一位 owner 由 ops（OPS_TOKEN）完成；其餘由 owner。
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { requireAuth } from "../auth/routes.js";
import type { AuthService } from "../auth/service.js";
import { sha256 } from "../auth/tokens.js";
import { canonicalize, type Json } from "../claim/canonical.js";
import { ApiError } from "../errors.js";
import type { EventBenefit, EventRedemption, EventRow, EventRuleRevision, ResultImport, ResultRevision, Store } from "../store/types.js";
import { PartnerAuthz } from "./authz.js";
import { csvSafeCell, RESULT_CSV_MAX_BYTES, stageResultsCsv } from "./csv.js";

const uuid = z.string().uuid();
export const CHECKIN_CHALLENGE_SECONDS = 120;
/** 實體品項預留有效期（SD 11.4：逾期釋放，staff 只能交付 reserved） */
export const REDEMPTION_HOLD_MINUTES = 15;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const humanCode = (n = 8) => [...randomBytes(n)].map((x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join("");
const base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/);
const iso = z.string().datetime({ offset: true }).transform((s) => new Date(s));

const eventFields = {
  title: z.string().min(1).max(120),
  description: z.string().max(4000),
  timezone: z.string().min(1).max(64),
  registration_opens_at: iso.nullable(),
  registration_closes_at: iso.nullable(),
  starts_at: iso.nullable(),
  ends_at: iso.nullable(),
  capacity: z.number().int().min(0).max(100_000),
  tournament_address: base58.nullable(),
};
const eventBody = z.object({
  slug,
  title: eventFields.title,
  description: eventFields.description.default(""),
  timezone: eventFields.timezone.default("UTC"),
  registration_opens_at: eventFields.registration_opens_at.default(null),
  registration_closes_at: eventFields.registration_closes_at.default(null),
  starts_at: eventFields.starts_at.default(null),
  ends_at: eventFields.ends_at.default(null),
  capacity: eventFields.capacity.default(0),
  tournament_address: eventFields.tournament_address.default(null),
});
// PATCH：沒有 default，未給的欄位不動
const eventPatch = z
  .object({
    title: eventFields.title.optional(),
    description: eventFields.description.optional(),
    timezone: eventFields.timezone.optional(),
    registration_opens_at: eventFields.registration_opens_at.optional(),
    registration_closes_at: eventFields.registration_closes_at.optional(),
    starts_at: eventFields.starts_at.optional(),
    ends_at: eventFields.ends_at.optional(),
    capacity: eventFields.capacity.optional(),
    tournament_address: eventFields.tournament_address.optional(),
    revision: z.number().int().min(1),
  })
  .strict();
const rulesBody = z.object({ rules: z.record(z.string(), z.unknown()) }).strict();

const parse = <T>(schema: z.ZodType<T>, body: unknown): T => {
  const r = schema.safeParse(body);
  if (!r.success) throw new ApiError(422, "VALIDATION", r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
};

export function publicEventView(e: EventRow, rule: EventRuleRevision | null) {
  return {
    event_id: e.eventId,
    slug: e.slug,
    title: e.title,
    description: e.description,
    state: e.state,
    timezone: e.timezone,
    registration_opens_at: e.registrationOpensAt?.toISOString() ?? null,
    registration_closes_at: e.registrationClosesAt?.toISOString() ?? null,
    starts_at: e.startsAt?.toISOString() ?? null,
    ends_at: e.endsAt?.toISOString() ?? null,
    capacity: e.capacity,
    registration_count: e.registrationCount,
    spots_left: e.capacity === 0 ? null : Math.max(0, e.capacity - e.registrationCount),
    tournament_address: e.tournamentAddress,
    rules: rule ? { version: rule.version, revision_id: rule.revisionId, rules: rule.rules, published_at: rule.publishedAt?.toISOString() ?? null } : null,
    cancel_reason: e.state === "cancelled" ? e.cancelReason : null,
  };
}

const partnerEventView = (e: EventRow) => ({ ...publicEventView(e, null), org_id: e.orgId, revision: e.revision, current_rule_revision: e.currentRuleRevision, created_by: e.createdBy, updated_at: e.updatedAt.toISOString() });

export async function partnerRoutes(app: FastifyInstance, opts: { auth: AuthService; store: Store; now: () => Date }) {
  const { auth, store, now } = opts;
  const authz = new PartnerAuthz(store, now);
  const ops = (req: FastifyRequest) => {
    const token = app.config.OPS_TOKEN;
    if (!token) throw new ApiError(404, "NOT_FOUND", "not found");
    if (req.headers.authorization !== `Bearer ${token}`) throw new ApiError(401, "UNAUTHORIZED", "ops token required");
  };

  // ---- 公開 ----
  app.get("/events", async (req) => {
    const q = req.query as { limit?: string; cursor?: string };
    const limit = Math.min(50, Math.max(1, Number(q.limit ?? 20) || 20));
    const offset = Math.max(0, Number(q.cursor ?? 0) || 0);
    const rows = await store.listPublishedEvents(limit, offset);
    const events = await Promise.all(rows.map(async (e) => publicEventView(e, e.currentRuleRevision ? await store.getRuleRevision(e.currentRuleRevision) : null)));
    return { events, next_cursor: rows.length === limit ? String(offset + rows.length) : null };
  });

  const resolveEvent = async (id: string) => {
    const e = uuid.safeParse(id).success ? await store.getEvent(id) : await store.getEventBySlug(id);
    if (!e || e.state === "draft") throw new ApiError(404, "NOT_FOUND", "event not found");
    return e;
  };
  const source = (req: FastifyRequest) => {
    const s = String((req.query as { source?: string }).source ?? "direct").slice(0, 32);
    return /^[a-z0-9_-]+$/i.test(s) ? s.toLowerCase() : "direct";
  };
  const day = () => now().toISOString().slice(0, 10);

  app.get("/events/:id", async (req) => {
    const e = await resolveEvent((req.params as { id: string }).id);
    await store.bumpCampaign(e.eventId, source(req), day(), "views");
    return publicEventView(e, e.currentRuleRevision ? await store.getRuleRevision(e.currentRuleRevision) : null);
  });

  // ---- participant：報名／取消／隱私／歷史（PG-E-03） ----
  const publicBenefitView = (b: EventBenefit) => ({ benefit_id: b.benefitId, kind: b.kind, name: b.name, remaining: Math.max(0, b.stockTotal - b.reservedCount - b.fulfilledCount), per_person_limit: b.perPersonLimit, requires_checkin: b.requiresCheckin, claim_deadline: b.claimDeadline?.toISOString() ?? null });
  const partnerBenefitView = (b: EventBenefit) => ({ ...publicBenefitView(b), stock_total: b.stockTotal, reserved_count: b.reservedCount, fulfilled_count: b.fulfilledCount, eligibility_rule_revision: b.eligibilityRuleRevision });
  /** 參加者視角：不含 idempotency_key；credential 只在數位徽章 */
  const redemptionView = (r: EventRedemption) => ({ redemption_id: r.redemptionId, benefit_id: r.benefitId, quantity: r.quantity, status: r.status, claim_code: r.status === "reserved" ? r.claimCode : null, reserved_at: r.reservedAt.toISOString(), reserved_until: r.reservedUntil.toISOString(), fulfilled_at: r.fulfilledAt?.toISOString() ?? null, credential_id: r.credentialId });
  const resultView = (r: ResultRevision) => ({ revision_id: r.revisionId, import_id: r.importId, discipline: r.discipline, division: r.division, finish_status: r.finishStatus, distance_m: r.distanceM, elapsed_ms: r.elapsedMs, rank: r.rank, previous_revision_id: r.previousRevisionId, reason: r.reason, published_at: r.publishedAt.toISOString() });
  const importView = (i: ResultImport, withRows: boolean) => ({ import_id: i.importId, source_kind: i.sourceKind, file_hash: i.fileHash.toString("hex"), import_version: i.importVersion, row_count: i.rowCount, error_count: i.errorCount, created_by: i.createdBy, created_at: i.createdAt.toISOString(), published_at: i.publishedAt?.toISOString() ?? null, published_by: i.publishedBy, errors: i.errors, ...(withRows ? { rows: i.stagedRows.map((r) => ({ line: r.line, wallet: r.wallet, discipline: r.discipline, division: r.division, finish_status: r.finishStatus, distance_m: r.distanceM, elapsed_ms: r.elapsedMs, rank: r.rank })) } : {}) });
  const participantView = (p: { status: string; acceptedRuleRevision: string; displayName: string | null; publicConsentAt: Date | null; registeredAt: Date; cancelledAt: Date | null }) => ({ status: p.status, accepted_rule_revision: p.acceptedRuleRevision, display_name: p.displayName, public_consent: p.publicConsentAt !== null, registered_at: p.registeredAt.toISOString(), cancelled_at: p.cancelledAt?.toISOString() ?? null });

  app.get("/events/:id/registration", { preHandler: requireAuth(auth) }, async (req) => {
    const e = await resolveEvent((req.params as { id: string }).id);
    const p = await store.getParticipant(e.eventId, req.auth!.wallet);
    return { registration: p ? participantView(p) : null };
  });

  app.post("/events/:id/registrations", { preHandler: requireAuth(auth) }, async (req, reply) => {
    const e = await resolveEvent((req.params as { id: string }).id);
    const b = parse(z.object({ accepted_rule_revision: uuid, display_name: z.string().min(1).max(40).nullable().default(null), public_consent: z.boolean().default(false) }).strict(), req.body);
    if (e.state !== "published") throw new ApiError(409, "EVENT_CANCELLED", `event is ${e.state}`);
    const t = now();
    if ((e.registrationOpensAt && t < e.registrationOpensAt) || (e.registrationClosesAt && t >= e.registrationClosesAt) || (e.endsAt && t >= e.endsAt)) throw new ApiError(409, "EVENT_NOT_OPEN", "registration is not open");
    if (b.accepted_rule_revision !== e.currentRuleRevision) throw new ApiError(409, "REVISION_CONFLICT", "rules changed; reload and accept the current rules");
    const r = await store.registerParticipant({ eventId: e.eventId, wallet: req.auth!.wallet, acceptedRuleRevision: b.accepted_rule_revision, displayName: b.display_name, publicConsent: b.public_consent }, t);
    if (r === "not_open") throw new ApiError(409, "EVENT_NOT_OPEN", "registration is not open");
    if (r === "full") throw new ApiError(409, "EVENT_FULL", "event is full");
    if (r === "exists") return reply.status(200).send({ registration: participantView((await store.getParticipant(e.eventId, req.auth!.wallet))!), already: true });
    await store.bumpCampaign(e.eventId, source(req), day(), "registrations");
    await authz.audit(req, { eventId: e.eventId, orgId: e.orgId, action: "registration.create", revisionId: b.accepted_rule_revision });
    return reply.status(201).send({ registration: participantView(r), already: false });
  });

  app.delete("/events/:id/registration", { preHandler: requireAuth(auth) }, async (req, reply) => {
    const e = await resolveEvent((req.params as { id: string }).id);
    if (e.startsAt && now() >= e.startsAt) throw new ApiError(409, "EVENT_NOT_OPEN", "event already started; contact the organizer");
    const p = await store.cancelRegistration(e.eventId, req.auth!.wallet, now());
    if (!p) throw new ApiError(404, "NOT_FOUND", "no active registration");
    await authz.audit(req, { eventId: e.eventId, orgId: e.orgId, action: "registration.cancel" });
    return reply.status(204).send();
  });

  app.patch("/events/:id/registration/privacy", { preHandler: requireAuth(auth) }, async (req) => {
    const e = await resolveEvent((req.params as { id: string }).id);
    const b = parse(z.object({ display_name: z.string().min(1).max(40).nullable().optional(), public_consent: z.boolean().optional() }).strict(), req.body);
    const p = await store.updateParticipantPrivacy(e.eventId, req.auth!.wallet, { ...(b.display_name !== undefined ? { displayName: b.display_name } : {}), ...(b.public_consent !== undefined ? { publicConsent: b.public_consent } : {}) }, now());
    if (!p) throw new ApiError(404, "NOT_FOUND", "no registration");
    return { registration: participantView(p) };
  });

  app.get("/me/event-history", { preHandler: requireAuth(auth) }, async (req) => {
    const parts = await store.listParticipations(req.auth!.wallet);
    return {
      items: await Promise.all(parts.map(async (p) => {
        const e = await store.getEvent(p.eventId);
        const checkins = await store.listCheckins(p.eventId, p.wallet);
        const redemptions = await store.listRedemptions(p.eventId, p.wallet);
        const results = await store.listResultHistory(p.eventId, p.wallet);
        return { event: e ? { event_id: e.eventId, slug: e.slug, title: e.title, state: e.state, starts_at: e.startsAt?.toISOString() ?? null, ends_at: e.endsAt?.toISOString() ?? null } : null, registration: participantView(p), check_ins: checkins.map((c) => ({ checkpoint_id: c.checkpointId, confirmed_at: c.confirmedAt.toISOString(), method: c.method })), redemptions: redemptions.map(redemptionView), results: results.map(resultView) };
      })),
    };
  });

  // ---- PG-E-04：站點與 NFC 載具 ----
  app.post("/partner/events/:id/checkpoints", { preHandler: requireAuth(auth) }, async (req, reply) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    const access = await authz.requireEventRole(id, req.auth!.wallet, []);
    if (!access.isOwner) throw new ApiError(403, "ROLE_FORBIDDEN", "organization owner required");
    const b = parse(z.object({ name: z.string().min(1).max(80), purpose: z.enum(["check_in", "redemption", "info"]) }).strict(), req.body);
    const checkpointId = randomUUID();
    await store.createCheckpoint({ checkpointId, eventId: id, name: b.name, purpose: b.purpose });
    await authz.audit(req, { eventId: id, orgId: access.event.orgId, action: "checkpoint.create", target: checkpointId, details: b });
    return reply.status(201).send({ checkpoint_id: checkpointId, ...b });
  });

  app.get("/partner/events/:id/checkpoints", { preHandler: requireAuth(auth) }, async (req) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    await authz.requireEventRole(id, req.auth!.wallet, ["staff", "result_editor", "publisher"]);
    return { checkpoints: (await store.listCheckpoints(id)).map((c) => ({ checkpoint_id: c.checkpointId, name: c.name, purpose: c.purpose })) };
  });

  /** 登記 NFC 載具：只存 opaque reference（32 bytes 隨機，base64url），標籤內容 = https://neonshift.cc/e/<slug>?tag=<ref>；不含任何憑證 */
  app.post("/partner/events/:id/tags", { preHandler: requireAuth(auth) }, async (req, reply) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    const b = parse(z.object({ purpose: z.enum(["checkpoint", "participant"]), checkpoint_id: uuid.nullable().default(null), participant_wallet: base58.nullable().default(null), quantity: z.number().int().min(1).max(200).default(1) }).strict(), req.body);
    const access = await authz.requireEventRole(id, req.auth!.wallet, ["staff"], b.checkpoint_id ? { checkpointId: b.checkpoint_id } : {});
    authz.requireRecentLogin(req);
    if (b.purpose === "checkpoint" && !b.checkpoint_id) throw new ApiError(422, "VALIDATION", "checkpoint_id required for checkpoint tags");
    if (b.purpose === "participant" && !b.participant_wallet) throw new ApiError(422, "VALIDATION", "participant_wallet required for participant tags");
    if (b.checkpoint_id && !(await store.getCheckpoint(id, b.checkpoint_id))) throw new ApiError(422, "VALIDATION", "checkpoint does not belong to this event");
    if (b.participant_wallet) {
      const p = await store.getParticipant(id, b.participant_wallet);
      if (!p || p.status === "cancelled") throw new ApiError(422, "NOT_ELIGIBLE", "wallet is not a registered participant");
      // 補發：停用該參加者舊載具（SD 11.4）
      for (const old of (await store.listTags(id)).filter((x) => x.participantWallet === b.participant_wallet && !x.revokedAt)) await store.revokeTag(id, old.tagId, now());
    }
    const tags = [];
    for (let i = 0; i < b.quantity; i++) {
      const tagId = randomUUID();
      const opaqueRef = randomBytes(24).toString("base64url");
      await store.createTag({ tagId, eventId: id, checkpointId: b.checkpoint_id, opaqueRef, purpose: b.purpose, participantWallet: b.participant_wallet, issuedBy: req.auth!.wallet }, now());
      tags.push({ tag_id: tagId, opaque_ref: opaqueRef, uri: `${app.config.SIWS_URI}/e/${access.event.slug}?tag=${opaqueRef}` });
    }
    await authz.audit(req, { eventId: id, orgId: access.event.orgId, action: "tag.issue", target: b.checkpoint_id ?? b.participant_wallet, details: { purpose: b.purpose, quantity: b.quantity } });
    return reply.status(201).send({ tags });
  });

  app.post("/partner/events/:id/tags/:tagId/revoke", { preHandler: requireAuth(auth) }, async (req, reply) => {
    const { id, tagId } = req.params as { id: string; tagId: string };
    const access = await authz.requireEventRole(parse(uuid, id), req.auth!.wallet, ["staff"]);
    authz.requireRecentLogin(req);
    if (!(await store.revokeTag(id, parse(uuid, tagId), now()))) throw new ApiError(404, "NOT_FOUND", "tag not found or already revoked");
    await authz.audit(req, { eventId: id, orgId: access.event.orgId, action: "tag.revoke", target: tagId });
    return reply.status(204).send();
  });

  /** 參加者感應後查 tag 狀態：不回傳資格、金額或內部欄位；標籤本身不可信 */
  app.get("/events/:id/tags/:ref", { preHandler: requireAuth(auth) }, async (req) => {
    const e = await resolveEvent((req.params as { id: string }).id);
    const ref = String((req.params as { ref: string }).ref);
    const tag = await store.getTagByRef(ref);
    if (!tag || tag.eventId !== e.eventId) throw new ApiError(404, "NOT_FOUND", "tag not found");
    if (tag.revokedAt) return { status: "revoked" as const };
    if (tag.purpose === "participant" && tag.participantWallet !== req.auth!.wallet) return { status: "not_yours" as const };
    const cp = tag.checkpointId ? await store.getCheckpoint(e.eventId, tag.checkpointId) : null;
    const registration = await store.getParticipant(e.eventId, req.auth!.wallet);
    return { status: "active" as const, purpose: tag.purpose, checkpoint: cp ? { checkpoint_id: cp.checkpointId, name: cp.name, purpose: cp.purpose } : null, registered: !!registration && registration.status !== "cancelled", event_state: e.state };
  });

  // ---- PG-E-05：報到 ----
  /** 參加者取得短期 challenge（120 秒；顯示為 QR／代碼給 staff）；只存 hash */
  app.post("/events/:id/check-in-challenges", { preHandler: requireAuth(auth) }, async (req, reply) => {
    const e = await resolveEvent((req.params as { id: string }).id);
    const b = parse(z.object({ checkpoint_id: uuid }).strict(), req.body);
    const p = await store.getParticipant(e.eventId, req.auth!.wallet);
    if (!p || p.status === "cancelled") throw new ApiError(403, "NOT_ELIGIBLE", "register for this event first");
    if (e.state !== "published") throw new ApiError(409, "EVENT_CANCELLED", `event is ${e.state}`);
    const cp = await store.getCheckpoint(e.eventId, b.checkpoint_id);
    if (!cp || cp.purpose !== "check_in") throw new ApiError(422, "VALIDATION", "checkpoint is not a check-in point");
    // 人類可讀 8 碼（去掉易混淆字元）＋機器碼；staff 輸入任一皆可
    const code = humanCode();
    const t = now();
    const expiresAt = new Date(t.getTime() + CHECKIN_CHALLENGE_SECONDS * 1000);
    await store.insertCheckinChallenge({ challengeHash: sha256(Buffer.from(`${e.eventId}|${code}`)), eventId: e.eventId, wallet: req.auth!.wallet, checkpointId: cp.checkpointId, expiresAt });
    return reply.status(201).send({ code, expires_at: expiresAt.toISOString(), checkpoint: { checkpoint_id: cp.checkpointId, name: cp.name }, qr_payload: `neonshift-checkin:${e.slug}:${code}` });
  });

  /** staff 確認到場：驗證 challenge（原子消耗）、站點授權、名單；冪等 */
  app.post("/partner/events/:id/check-ins", { preHandler: requireAuth(auth) }, async (req, reply) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    const b = parse(z.object({ code: z.string().min(6).max(64).optional(), wallet: base58.optional(), checkpoint_id: uuid, method: z.enum(["nfc", "qr", "manual"]).default("qr"), reason: z.string().max(200).optional() }).strict(), req.body);
    const access = await authz.requireEventRole(id, req.auth!.wallet, ["staff"], { checkpointId: b.checkpoint_id });
    const t = now();
    let wallet: string;
    if (b.code) {
      const code = b.code.trim().toUpperCase().replace(/^NEONSHIFT-CHECKIN:[^:]+:/i, "");
      const consumed = await store.consumeCheckinChallenge(sha256(Buffer.from(`${id}|${code}`)), t);
      if (!consumed) throw new ApiError(410, "CHECKIN_CHALLENGE_EXPIRED", "code expired, already used or unknown");
      if (consumed.checkpointId !== b.checkpoint_id) throw new ApiError(409, "CHECKIN_CHALLENGE_EXPIRED", "code was issued for a different checkpoint");
      wallet = consumed.wallet;
    } else if (b.wallet && b.method === "manual") {
      // 補登：需理由、留稽核；不降低名單檢查
      if (!b.reason || b.reason.length < 3) throw new ApiError(422, "VALIDATION", "manual check-in requires a reason");
      authz.requireRecentLogin(req);
      wallet = b.wallet;
    } else {
      throw new ApiError(422, "VALIDATION", "code (qr/nfc) or wallet+reason (manual) is required");
    }
    const p = await store.getParticipant(id, wallet);
    if (!p || p.status === "cancelled") throw new ApiError(403, "NOT_ELIGIBLE", "wallet is not on the participant list");
    const inserted = await store.insertCheckin({ eventId: id, wallet, checkpointId: b.checkpoint_id, confirmedBy: req.auth!.wallet, method: b.method }, t);
    await store.bumpCampaign(id, "onsite", day(), "checkins");
    await authz.audit(req, { eventId: id, orgId: access.event.orgId, action: inserted ? "checkin.confirm" : "checkin.repeat", target: wallet, details: { checkpoint_id: b.checkpoint_id, method: b.method, ...(b.reason ? { reason: b.reason } : {}) } });
    return reply.status(inserted ? 201 : 200).send({ wallet, checkpoint_id: b.checkpoint_id, display_name: p.displayName, already: !inserted, confirmed_at: t.toISOString() });
  });

  app.get("/partner/events/:id/check-ins", { preHandler: requireAuth(auth) }, async (req) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    await authz.requireEventRole(id, req.auth!.wallet, ["staff", "result_editor", "publisher"]);
    return { check_ins: (await store.listCheckins(id)).map((c) => ({ wallet: c.wallet, checkpoint_id: c.checkpointId, confirmed_by: c.confirmedBy, confirmed_at: c.confirmedAt.toISOString(), method: c.method })) };
  });

  // ---- PG-E-06：品項庫存與核銷（SD 11.4 庫存交易、BR-30／BR-33、FR-11.2／11.4） ----
  const benefitBody = z
    .object({
      kind: z.enum(["physical", "digital_badge"]),
      name: z.string().min(1).max(80),
      stock_total: z.number().int().min(0).max(100_000),
      per_person_limit: z.number().int().min(1).max(100).default(1),
      requires_checkin: z.boolean().default(true),
      claim_deadline: iso.nullable().default(null),
    })
    .strict();
  app.post("/partner/events/:id/benefits", { preHandler: requireAuth(auth) }, async (req, reply) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    const access = await authz.requireEventRole(id, req.auth!.wallet, []);
    if (!access.isOwner) throw new ApiError(403, "ROLE_FORBIDDEN", "organization owner required");
    const b = parse(benefitBody, req.body);
    const benefit: EventBenefit = { benefitId: randomUUID(), eventId: id, kind: b.kind, name: b.name, stockTotal: b.stock_total, reservedCount: 0, fulfilledCount: 0, perPersonLimit: b.per_person_limit, eligibilityRuleRevision: access.event.currentRuleRevision, requiresCheckin: b.requires_checkin, claimDeadline: b.claim_deadline };
    await store.createBenefit(benefit);
    await authz.audit(req, { eventId: id, orgId: access.event.orgId, action: "benefit.create", target: benefit.benefitId, details: { ...b, claim_deadline: b.claim_deadline?.toISOString() ?? null } });
    return reply.status(201).send(partnerBenefitView(benefit));
  });

  /** 對帳：staff／owner 看每品項預留／已交付／剩餘 */
  app.get("/partner/events/:id/benefits", { preHandler: requireAuth(auth) }, async (req) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    await authz.requireEventRole(id, req.auth!.wallet, ["staff", "result_editor", "publisher"]);
    await store.expireRedemptions(now());
    return { benefits: (await store.listBenefits(id)).map(partnerBenefitView) };
  });

  /** 公開投影：只有品項與剩餘量，不含名單 */
  app.get("/events/:id/benefits", async (req) => {
    const e = await resolveEvent((req.params as { id: string }).id);
    await store.expireRedemptions(now());
    return { benefits: (await store.listBenefits(e.eventId)).map(publicBenefitView) };
  });

  /** 參加者預留（實體）／直接發放（數位徽章）：idempotency_key 相同回同一筆；逾期由 expire 釋放 */
  app.post("/events/:id/redemptions", { preHandler: requireAuth(auth) }, async (req, reply) => {
    const e = await resolveEvent((req.params as { id: string }).id);
    const b = parse(z.object({ benefit_id: uuid, quantity: z.number().int().min(1).max(100).default(1), idempotency_key: uuid }).strict(), req.body);
    const t = now();
    const r = await store.reserveRedemption(
      { redemptionId: randomUUID(), eventId: e.eventId, wallet: req.auth!.wallet, benefitId: b.benefit_id, quantity: b.quantity, idempotencyKey: b.idempotency_key, claimCode: humanCode(), reservedUntil: new Date(t.getTime() + REDEMPTION_HOLD_MINUTES * 60_000), credentialId: `badge_${randomBytes(12).toString("base64url")}` },
      t,
    );
    if (r.kind !== "ok") {
      const map: Record<Exclude<typeof r.kind, "ok">, [number, string, string]> = {
        not_open: [409, "EVENT_CANCELLED", `event is ${e.state}`],
        no_benefit: [404, "NOT_FOUND", "benefit not found"],
        not_eligible: [403, "NOT_ELIGIBLE", "register for this event first"],
        checkin_required: [403, "CHECKIN_REQUIRED", "check in at the event first"],
        deadline_passed: [410, "CLAIM_DEADLINE_PASSED", "claim window closed"],
        limit_reached: [409, "BENEFIT_LIMIT_REACHED", "per-person limit reached"],
        out_of_stock: [409, "BENEFIT_OUT_OF_STOCK", "no stock left"],
      };
      const [status, code, msg] = map[r.kind];
      throw new ApiError(status, code, msg);
    }
    if (r.created) await store.bumpCampaign(e.eventId, "onsite", day(), "redemptions");
    return reply.status(r.created ? 201 : 200).send(redemptionView(r.redemption));
  });

  app.get("/events/:id/redemptions", { preHandler: requireAuth(auth) }, async (req) => {
    const e = await resolveEvent((req.params as { id: string }).id);
    await store.expireRedemptions(now());
    return { redemptions: (await store.listRedemptions(e.eventId, req.auth!.wallet)).map(redemptionView) };
  });

  /** staff 交付：以核銷代碼或 redemption_id；只有 reserved 可交付、重試回原結果（already）、逾期／取消 410／409 */
  const fulfill = async (req: FastifyRequest, eventId: string, key: { redemptionId?: string; claimCode?: string }, checkpointId?: string) => {
    const access = await authz.requireEventRole(eventId, req.auth!.wallet, ["staff"], checkpointId ? { checkpointId } : {});
    const r = await store.fulfillRedemption(eventId, key, req.auth!.wallet, now());
    if (r.kind === "not_found") throw new ApiError(404, "NOT_FOUND", "redemption not found");
    if (r.kind === "expired") throw new ApiError(410, "REDEMPTION_EXPIRED", "reservation expired; participant must reserve again");
    if (r.kind === "cancelled") throw new ApiError(409, "REDEMPTION_CANCELLED", "reservation was cancelled");
    if (r.kind !== "ok") throw new ApiError(500, "INTERNAL", "unexpected redemption state");
    await authz.audit(req, { eventId, orgId: access.event.orgId, action: r.already ? "redemption.fulfill.repeat" : "redemption.fulfill", target: r.redemption.redemptionId, details: { benefit_id: r.redemption.benefitId, wallet: r.redemption.wallet, quantity: r.redemption.quantity, ...(checkpointId ? { checkpoint_id: checkpointId } : {}) } });
    return r;
  };
  app.post("/partner/events/:id/redemptions/fulfill", { preHandler: requireAuth(auth) }, async (req, reply) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    const b = parse(z.object({ claim_code: z.string().min(6).max(64).optional(), redemption_id: uuid.optional(), checkpoint_id: uuid.optional() }).strict(), req.body);
    if (!b.claim_code && !b.redemption_id) throw new ApiError(422, "VALIDATION", "claim_code or redemption_id is required");
    const key = b.redemption_id ? { redemptionId: b.redemption_id } : { claimCode: b.claim_code!.trim().toUpperCase().replace(/^NEONSHIFT-REDEEM:[^:]+:/i, "").replace(/\s+/g, "") };
    const r = await fulfill(req, id, key, b.checkpoint_id);
    return reply.status(r.already ? 200 : 201).send({ ...redemptionView(r.redemption), already: r.already });
  });
  app.post("/partner/redemptions/:id/fulfill", { preHandler: requireAuth(auth) }, async (req, reply) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    const cur = await store.getRedemption(id);
    if (!cur) throw new ApiError(404, "NOT_FOUND", "redemption not found");
    const r = await fulfill(req, cur.eventId, { redemptionId: id });
    return reply.status(r.already ? 200 : 201).send({ ...redemptionView(r.redemption), already: r.already });
  });

  /** 對帳清單：分開呈現 reserved／fulfilled／expired／cancelled（FR-11.4） */
  app.get("/partner/events/:id/redemptions", { preHandler: requireAuth(auth) }, async (req) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    await authz.requireEventRole(id, req.auth!.wallet, ["staff", "result_editor", "publisher"]);
    await store.expireRedemptions(now());
    const rows = await store.listRedemptions(id);
    const counts = { reserved: 0, fulfilled: 0, expired: 0, cancelled: 0 };
    for (const x of rows) counts[x.status] += x.quantity;
    return { counts, redemptions: rows.map((x) => ({ ...redemptionView(x), wallet: x.wallet, fulfilled_by: x.fulfilledBy })) };
  });

  // ---- PG-E-07／E-08：成績 CSV staging → 發布（更正串前版）→ 公開榜（只回同意者）／個人成績冊（BR-31、BR-32） ----
  app.post("/partner/events/:id/result-imports", { preHandler: requireAuth(auth) }, async (req, reply) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    const access = await authz.requireEventRole(id, req.auth!.wallet, ["result_editor", "publisher"]);
    const b = parse(z.object({ source_kind: z.enum(["csv", "manual"]).default("csv"), csv: z.string().min(1).max(RESULT_CSV_MAX_BYTES * 2) }).strict(), req.body);
    const parts = new Map<string, "registered" | "checked_in" | "cancelled">();
    for (const p of await store.listEventParticipants(id)) parts.set(p.wallet, p.status);
    const staged = stageResultsCsv(b.csv, parts);
    const imp = await store.createResultImport({ importId: randomUUID(), eventId: id, sourceKind: b.source_kind, fileHash: createHash("sha256").update(b.csv).digest(), rowCount: staged.rows.length, errorCount: staged.errors.length, stagedRows: staged.rows, errors: staged.errors, createdBy: req.auth!.wallet }, now());
    await authz.audit(req, { eventId: id, orgId: access.event.orgId, action: "results.stage", target: imp.importId, details: { import_version: imp.importVersion, row_count: imp.rowCount, error_count: imp.errorCount, file_hash: imp.fileHash.toString("hex") } });
    return reply.status(201).send(importView(imp, true));
  });

  app.get("/partner/events/:id/result-imports", { preHandler: requireAuth(auth) }, async (req) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    await authz.requireEventRole(id, req.auth!.wallet, ["result_editor", "publisher"]);
    return { imports: (await store.listResultImports(id)).map((i) => importView(i, false)) };
  });

  app.get("/partner/events/:id/result-imports/:importId", { preHandler: requireAuth(auth) }, async (req) => {
    const { id, importId } = req.params as { id: string; importId: string };
    await authz.requireEventRole(parse(uuid, id), req.auth!.wallet, ["result_editor", "publisher"]);
    const imp = await store.getResultImport(id, parse(uuid, importId));
    if (!imp) throw new ApiError(404, "NOT_FOUND", "import not found");
    return importView(imp, true);
  });

  /** 發布：publisher＋近期登入；有錯誤列不可發布；更正（已有發布版）必須附原因；活動需 published */
  app.post("/partner/events/:id/result-imports/:importId/publish", { preHandler: requireAuth(auth) }, async (req) => {
    const { id: rawId, importId: rawImport } = req.params as { id: string; importId: string };
    const id = parse(uuid, rawId);
    const importId = parse(uuid, rawImport);
    const access = await authz.requireEventRole(id, req.auth!.wallet, ["publisher"]);
    authz.requireRecentLogin(req);
    const b = parse(z.object({ reason: z.string().min(3).max(500).optional() }).strict(), req.body ?? {});
    if (access.event.state !== "published") throw new ApiError(409, "EVENT_CANCELLED", `event is ${access.event.state}`);
    const imp = await store.getResultImport(id, importId);
    if (!imp) throw new ApiError(404, "NOT_FOUND", "import not found");
    if (imp.publishedAt) throw new ApiError(409, "RESULTS_ALREADY_PUBLISHED", "this import was already published");
    if (imp.errorCount > 0) throw new ApiError(409, "RESULTS_HAVE_ERRORS", `${imp.errorCount} row(s) have errors; fix the CSV and stage again`);
    // 更正判定：任一列已有發布版 → 需原因（BR-31）
    const current = await store.listCurrentResults(id);
    const existing = new Set(current.map((r) => `${r.wallet}|${r.discipline}`));
    const isCorrection = imp.stagedRows.some((r) => existing.has(`${r.wallet}|${r.discipline}`));
    if (isCorrection && !b.reason) throw new ApiError(422, "VALIDATION", "reason is required when correcting published results");
    const r = await store.publishResultImport(id, importId, req.auth!.wallet, b.reason ?? null, now());
    if (r === "not_found") throw new ApiError(404, "NOT_FOUND", "import not found");
    if (r === "already") throw new ApiError(409, "RESULTS_ALREADY_PUBLISHED", "this import was already published");
    if (r === "has_errors") throw new ApiError(409, "RESULTS_HAVE_ERRORS", "import has errors");
    await authz.audit(req, { eventId: id, orgId: access.event.orgId, action: isCorrection ? "results.correct" : "results.publish", target: importId, details: { import_version: imp.importVersion, revisions: r.revisions, corrections: r.corrections, ...(b.reason ? { reason: b.reason } : {}) } });
    return { import_id: importId, import_version: imp.importVersion, revisions: r.revisions, corrections: r.corrections, published_at: now().toISOString() };
  });

  /**
   * 公開成績榜：只回公開同意者的顯示名稱與最新發布版；finished 依來源名次（無則依時間）排序，DNF／DNS／DQ 另列不排名。
   * 不回 wallet、不回未同意者（BR-32）。
   */
  app.get("/events/:id/results", async (req) => {
    const e = await resolveEvent((req.params as { id: string }).id);
    const q = parse(z.object({ discipline: z.string().max(32).optional(), division: z.string().max(40).optional(), limit: z.coerce.number().int().min(1).max(500).default(100), offset: z.coerce.number().int().min(0).default(0) }), req.query ?? {});
    const rows = (await store.listCurrentResults(e.eventId)).filter((r) => r.publicConsent && (!q.discipline || r.discipline === q.discipline) && (!q.division || r.division === q.division));
    const finished = rows.filter((r) => r.finishStatus === "finished").sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) || a.elapsedMs - b.elapsedMs);
    const others = rows.filter((r) => r.finishStatus !== "finished");
    const pub = (r: (typeof rows)[number]) => ({ display_name: r.displayName ?? "Anonymous runner", discipline: r.discipline, division: r.division, finish_status: r.finishStatus, distance_m: r.distanceM, elapsed_ms: r.elapsedMs, rank: r.rank, rank_source: r.rank !== null ? "organizer" : null, published_at: r.publishedAt.toISOString() });
    return { event_id: e.eventId, slug: e.slug, total_finished: finished.length, results: finished.slice(q.offset, q.offset + q.limit).map(pub), non_finishers: others.map(pub), source: "organizer" };
  });

  app.get("/partner/events/:id/campaign-summary", { preHandler: requireAuth(auth) }, async (req, reply) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    const access = await authz.requireEventRole(id, req.auth!.wallet, []);
    if (!access.isOwner) throw new ApiError(403, "ROLE_FORBIDDEN", "organization owner required");
    const rows = await store.listCampaign(id);
    const bySource: Record<string, { views: number; registrations: number; checkins: number; redemptions: number }> = {};
    for (const r of rows) {
      const t = (bySource[r.source] ??= { views: 0, registrations: 0, checkins: 0, redemptions: 0 });
      t.views += r.views; t.registrations += r.registrations; t.checkins += r.checkins; t.redemptions += r.redemptions;
    }
    // 轉換率（FR-09.3）：來源 views → registrations → checkins；views 為 0 時不計
    const conv = Object.fromEntries(Object.entries(bySource).map(([k, v]) => [k, { registration_rate: v.views > 0 ? Number((v.registrations / v.views).toFixed(4)) : null, checkin_rate: v.registrations > 0 ? Number((v.checkins / v.registrations).toFixed(4)) : null }]));
    const format = (req.query as { format?: string } | undefined)?.format;
    if (format === "csv") {
      const lines = ["source,day,views,registrations,checkins,redemptions", ...rows.map((r) => [csvSafeCell(r.source), r.day, r.views, r.registrations, r.checkins, r.redemptions].join(","))];
      return reply.type("text/csv; charset=utf-8").header("content-disposition", `attachment; filename="campaign-${access.event.slug}.csv"`).send(`${lines.join("\n")}\n`);
    }
    return { event_id: id, registration_count: access.event.registrationCount, capacity: access.event.capacity, by_source: bySource, conversion: conv, daily: rows, retention: { purged_at: access.event.purgedAt?.toISOString() ?? null } };
  });

  // ---- ops：組織與第一位 owner ----
  app.post("/partner/orgs", async (req, reply) => {
    ops(req);
    const b = parse(z.object({ name: z.string().min(1).max(120), slug, owner_wallet: base58 }).strict(), req.body);
    if (await store.getOrganizationBySlug(b.slug)) throw new ApiError(409, "SLUG_TAKEN", "organization slug already exists");
    const org = await store.createOrganization({ orgId: randomUUID(), name: b.name, slug: b.slug, createdBy: "ops" }, now());
    await store.upsertMembership({ orgId: org.orgId, wallet: b.owner_wallet, role: "owner", grantedBy: "ops" }, now());
    await store.appendAudit({ eventId: null, orgId: org.orgId, actorWallet: "ops", action: "org.create", target: b.owner_wallet, revisionId: null, requestId: String(req.id), details: { slug: b.slug } }, now());
    return reply.status(201).send({ org_id: org.orgId, slug: org.slug, name: org.name });
  });

  // ---- owner：成員 ----
  app.get("/partner/me", { preHandler: requireAuth(auth) }, async (req) => {
    const memberships = await store.listMemberships(req.auth!.wallet);
    const roles = await store.listEventRolesForWallet(req.auth!.wallet);
    return {
      organizations: await Promise.all(memberships.map(async (m) => ({ org_id: m.orgId, role: m.role, name: (await store.getOrganization(m.orgId))?.name ?? null }))),
      event_roles: roles.map((r) => ({ event_id: r.eventId, role: r.role, checkpoint_id: r.checkpointId })),
    };
  });

  app.post("/partner/orgs/:orgId/members", { preHandler: requireAuth(auth) }, async (req, reply) => {
    const orgId = parse(uuid, (req.params as { orgId: string }).orgId);
    await authz.requireOrgOwner(orgId, req.auth!.wallet);
    authz.requireRecentLogin(req);
    const b = parse(z.object({ wallet: base58, role: z.enum(["owner", "member"]) }).strict(), req.body);
    await store.upsertMembership({ orgId, wallet: b.wallet, role: b.role, grantedBy: req.auth!.wallet }, now());
    await authz.audit(req, { orgId, action: "member.upsert", target: b.wallet, details: { role: b.role } });
    return reply.status(204).send();
  });

  app.delete("/partner/orgs/:orgId/members/:wallet", { preHandler: requireAuth(auth) }, async (req, reply) => {
    const { orgId, wallet } = req.params as { orgId: string; wallet: string };
    await authz.requireOrgOwner(parse(uuid, orgId), req.auth!.wallet);
    authz.requireRecentLogin(req);
    if (wallet === req.auth!.wallet) throw new ApiError(409, "LAST_OWNER", "owners cannot revoke themselves");
    await store.revokeMembership(orgId, wallet, now());
    await authz.audit(req, { orgId, action: "member.revoke", target: wallet });
    return reply.status(204).send();
  });

  // ---- owner：活動 ----
  app.get("/partner/orgs/:orgId/events", { preHandler: requireAuth(auth) }, async (req) => {
    const orgId = parse(uuid, (req.params as { orgId: string }).orgId);
    await authz.requireOrgOwner(orgId, req.auth!.wallet);
    return { events: (await store.listOrgEvents(orgId)).map(partnerEventView) };
  });

  app.post("/partner/events", { preHandler: requireAuth(auth) }, async (req, reply) => {
    const b = parse(eventBody.extend({ org_id: uuid }).strict(), req.body);
    await authz.requireOrgOwner(b.org_id, req.auth!.wallet);
    if (await store.getEventBySlug(b.slug)) throw new ApiError(409, "SLUG_TAKEN", "event slug already exists");
    if (b.starts_at && b.ends_at && b.starts_at >= b.ends_at) throw new ApiError(422, "VALIDATION", "starts_at must be before ends_at");
    const e = await store.createEvent({ eventId: randomUUID(), orgId: b.org_id, slug: b.slug, title: b.title, description: b.description, timezone: b.timezone, registrationOpensAt: b.registration_opens_at, registrationClosesAt: b.registration_closes_at, startsAt: b.starts_at, endsAt: b.ends_at, capacity: b.capacity, tournamentAddress: b.tournament_address, createdBy: req.auth!.wallet }, now());
    await authz.audit(req, { eventId: e.eventId, orgId: e.orgId, action: "event.create" });
    return reply.status(201).send(partnerEventView(e));
  });

  app.get("/partner/events/:id", { preHandler: requireAuth(auth) }, async (req) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    const access = await authz.requireEventRole(id, req.auth!.wallet, ["staff", "result_editor", "publisher"]);
    return { ...partnerEventView(access.event), rule_revisions: (await store.listRuleRevisions(id)).map((r) => ({ revision_id: r.revisionId, version: r.version, rules: r.rules, rules_hash: r.rulesHash.toString("hex"), published_at: r.publishedAt?.toISOString() ?? null })), your_roles: access.isOwner ? ["owner"] : [...access.roles] };
  });

  app.patch("/partner/events/:id", { preHandler: requireAuth(auth) }, async (req) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    const access = await authz.requireEventRole(id, req.auth!.wallet, []);
    if (!access.isOwner) throw new ApiError(403, "ROLE_FORBIDDEN", "organization owner required");
    if (access.event.state === "cancelled" || access.event.state === "completed") throw new ApiError(409, "EVENT_CANCELLED", `event is ${access.event.state}`);
    const b = parse(eventPatch, req.body);
    const { revision, ...rest } = b;
    const patch = Object.fromEntries(Object.entries({ title: rest.title, description: rest.description, timezone: rest.timezone, registrationOpensAt: rest.registration_opens_at, registrationClosesAt: rest.registration_closes_at, startsAt: rest.starts_at, endsAt: rest.ends_at, capacity: rest.capacity, tournamentAddress: rest.tournament_address }).filter(([, v]) => v !== undefined));
    if ("capacity" in patch && (patch.capacity as number) !== 0 && (patch.capacity as number) < access.event.registrationCount) throw new ApiError(422, "VALIDATION", "capacity below current registrations");
    const updated = await store.updateEvent(id, revision, patch, now());
    if (!updated) throw new ApiError(409, "REVISION_CONFLICT", "event was modified by someone else; reload and retry");
    await authz.audit(req, { eventId: id, orgId: updated.orgId, action: "event.update", details: { fields: Object.keys(patch), revision: updated.revision } });
    return partnerEventView(updated);
  });

  // ---- 規則版本（只增不改）----
  app.post("/partner/events/:id/rule-revisions", { preHandler: requireAuth(auth) }, async (req, reply) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    const access = await authz.requireEventRole(id, req.auth!.wallet, ["publisher"]);
    const b = parse(rulesBody, req.body);
    const existing = await store.listRuleRevisions(id);
    const version = (existing[existing.length - 1]?.version ?? 0) + 1;
    const rulesHash = createHash("sha256").update(canonicalize(b.rules as Json), "utf8").digest();
    const r = await store.addRuleRevision({ revisionId: randomUUID(), eventId: id, version, rules: b.rules, rulesHash, createdBy: req.auth!.wallet }, now());
    await authz.audit(req, { eventId: id, orgId: access.event.orgId, action: "rules.create", revisionId: r.revisionId, details: { version } });
    return reply.status(201).send({ revision_id: r.revisionId, version: r.version, rules_hash: rulesHash.toString("hex") });
  });

  // ---- 發布／取消 ----
  app.post("/partner/events/:id/publish", { preHandler: requireAuth(auth) }, async (req) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    const access = await authz.requireEventRole(id, req.auth!.wallet, ["publisher"]);
    authz.requireRecentLogin(req);
    const b = parse(z.object({ revision_id: uuid }).strict(), req.body);
    const rule = await store.getRuleRevision(b.revision_id);
    if (!rule || rule.eventId !== id) throw new ApiError(422, "VALIDATION", "revision_id does not belong to this event");
    const e = access.event;
    if (!e.startsAt || !e.endsAt) throw new ApiError(422, "VALIDATION", "starts_at and ends_at are required before publishing");
    const updated = await store.transitionEvent(id, ["draft", "published"], "published", { currentRuleRevision: rule.revisionId }, now());
    if (!updated) throw new ApiError(409, "EVENT_CANCELLED", `event is ${e.state}`);
    await store.markRuleRevisionPublished(rule.revisionId, now());
    await authz.audit(req, { eventId: id, orgId: e.orgId, action: "event.publish", revisionId: rule.revisionId, details: { version: rule.version } });
    return partnerEventView(updated);
  });

  app.post("/partner/events/:id/cancel", { preHandler: requireAuth(auth) }, async (req) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    const access = await authz.requireEventRole(id, req.auth!.wallet, ["publisher"]);
    authz.requireRecentLogin(req);
    const b = parse(z.object({ reason: z.string().min(3).max(500) }).strict(), req.body);
    const updated = await store.transitionEvent(id, ["draft", "published"], "cancelled", { cancelReason: b.reason }, now());
    if (!updated) throw new ApiError(409, "EVENT_CANCELLED", `event is ${access.event.state}`);
    // BR-33：未交付預留釋放；已交付保留事實
    const released = await store.releaseEventReservations(id, now());
    await authz.audit(req, { eventId: id, orgId: access.event.orgId, action: "event.cancel", details: { reason: b.reason, released_reservations: released } });
    return partnerEventView(updated);
  });

  // ---- 活動角色 ----
  app.post("/partner/events/:id/roles", { preHandler: requireAuth(auth) }, async (req, reply) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    const access = await authz.requireEventRole(id, req.auth!.wallet, []);
    if (!access.isOwner) throw new ApiError(403, "ROLE_FORBIDDEN", "organization owner required");
    authz.requireRecentLogin(req);
    const b = parse(z.object({ wallet: base58, role: z.enum(["staff", "result_editor", "publisher"]), checkpoint_id: uuid.nullable().default(null) }).strict(), req.body);
    await store.upsertEventRole({ eventId: id, wallet: b.wallet, role: b.role, checkpointId: b.checkpoint_id, grantedBy: req.auth!.wallet }, now());
    await authz.audit(req, { eventId: id, orgId: access.event.orgId, action: "role.grant", target: b.wallet, details: { role: b.role, checkpoint_id: b.checkpoint_id } });
    return reply.status(204).send();
  });

  app.delete("/partner/events/:id/roles/:wallet/:role", { preHandler: requireAuth(auth) }, async (req, reply) => {
    const { id, wallet, role } = req.params as { id: string; wallet: string; role: string };
    const access = await authz.requireEventRole(parse(uuid, id), req.auth!.wallet, []);
    if (!access.isOwner) throw new ApiError(403, "ROLE_FORBIDDEN", "organization owner required");
    authz.requireRecentLogin(req);
    const r = parse(z.enum(["staff", "result_editor", "publisher"]), role);
    await store.revokeEventRole(id, wallet, r, now());
    await authz.audit(req, { eventId: id, orgId: access.event.orgId, action: "role.revoke", target: wallet, details: { role: r } });
    return reply.status(204).send();
  });

  app.get("/partner/events/:id/audit", { preHandler: requireAuth(auth) }, async (req) => {
    const id = parse(uuid, (req.params as { id: string }).id);
    const access = await authz.requireEventRole(id, req.auth!.wallet, []);
    if (!access.isOwner) throw new ApiError(403, "ROLE_FORBIDDEN", "organization owner required");
    return { entries: (await store.listAudit(id, 200)).map((a) => ({ at: a.createdAt.toISOString(), actor: a.actorWallet, action: a.action, target: a.target, revision_id: a.revisionId, request_id: a.requestId, details: a.details })) };
  });
}
