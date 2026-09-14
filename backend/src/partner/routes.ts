/**
 * 合作活動管理 API（PG-E-02，SD 11.2）：組織／成員、活動草稿（revision 樂觀鎖）、規則版本、發布／取消、活動角色；
 * 公開活動讀取（不含名單、wallet、聯絡資料）。組織建立與第一位 owner 由 ops（OPS_TOKEN）完成；其餘由 owner。
 */
import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { requireAuth } from "../auth/routes.js";
import type { AuthService } from "../auth/service.js";
import { canonicalize, type Json } from "../claim/canonical.js";
import { ApiError } from "../errors.js";
import type { EventRow, EventRuleRevision, Store } from "../store/types.js";
import { PartnerAuthz } from "./authz.js";

const uuid = z.string().uuid();
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

  app.get("/events/:id", async (req) => {
    const id = (req.params as { id: string }).id;
    const e = uuid.safeParse(id).success ? await store.getEvent(id) : await store.getEventBySlug(id);
    if (!e || e.state === "draft") throw new ApiError(404, "NOT_FOUND", "event not found");
    return publicEventView(e, e.currentRuleRevision ? await store.getRuleRevision(e.currentRuleRevision) : null);
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
    await authz.audit(req, { eventId: id, orgId: access.event.orgId, action: "event.cancel", details: { reason: b.reason } });
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
