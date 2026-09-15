import { randomUUID } from "node:crypto";
import { compareLeaderboard } from "./leaderboard.js";
import type { CosmeticEntitlement, QuestContribution, QuestEnrollment, QuestReceipt, QuestTemplate, GalleryBoard, LevelHistoryEntry, AttestationRow, AuditEntry, Challenge, ChainCursor, ChainEventInput, ChainEventRow, ClaimResult, DeletionResult, Checkpoint, EventBenefit, EventParticipant, EventRedemption, FulfillOutcome, EventPatch, EventRole, EventRoleGrant, EventRow, EventRuleRevision, EventState, GalleryCollectible, GalleryPlayer, HealthSnapshotInput, HistoryItem, NfcTag, PartnerMembership, PartnerOrganization, Player, PurgeCounts, ReserveOutcome, ResultImport, ResultRevision, RiskDecisionInput, RuleSetRow, Achievement, PbDesired, PbRevision, Session, Store, TournamentStepsRow, WorkoutSession } from "./types.js";

/** 單元測試用；行為需與 PostgreSQL 實作一致（見 store.integration.test.ts） */
export class MemoryStore implements Store {
  challenges = new Map<string, Challenge>();
  players = new Map<string, Player & { deletionDueAt?: Date | null }>();
  sessions = new Map<string, Session>();
  ruleSets = new Map<number, RuleSetRow>();
  snapshots: (HealthSnapshotInput & { id: number })[] = [];
  decisions: RiskDecisionInput[] = [];
  attestations = new Map<string, AttestationRow>();
  claimResults = new Map<string, ClaimResult>();
  tournamentSteps = new Map<string, TournamentStepsRow>();
  chainEvents = new Map<string, ChainEventRow>();
  cursors = new Map<string, ChainCursor>();
  redeemed = new Map<string, string>();
  galleryPlayers = new Map<string, GalleryPlayer>();
  galleryCollectibles = new Map<string, GalleryCollectible>();
  orgs = new Map<string, PartnerOrganization>();
  memberships = new Map<string, PartnerMembership>();
  events = new Map<string, EventRow>();
  ruleRevisions = new Map<string, EventRuleRevision>();
  eventRoles = new Map<string, EventRoleGrant>();
  audit: (AuditEntry & { createdAt: Date })[] = [];
  participants = new Map<string, EventParticipant>();
  checkpoints = new Map<string, Checkpoint>();
  tags = new Map<string, NfcTag>();
  checkinChallenges = new Map<string, { challengeHash: Buffer; eventId: string; wallet: string; checkpointId: string; expiresAt: Date; usedAt: Date | null }>();
  checkins: { eventId: string; wallet: string; checkpointId: string; confirmedBy: string; confirmedAt: Date; method: string }[] = [];
  campaign = new Map<string, { source: string; day: string; views: number; registrations: number; checkins: number; redemptions: number }>();
  benefits = new Map<string, EventBenefit>();
  resultImports = new Map<string, ResultImport>();
  workouts = new Map<string, WorkoutSession>();
  pbs = new Map<string, PbRevision>();
  achievements = new Map<string, Achievement>();
  galleryHidden = new Set<string>();
  resultRevisions: ResultRevision[] = [];
  redemptions = new Map<string, EventRedemption>();

  async insertChallenge(c: Challenge) {
    const k = c.nonceHash.toString("hex");
    if (this.challenges.has(k)) throw new Error("duplicate nonce");
    this.challenges.set(k, { ...c });
  }
  async consumeChallenge(nonceHash: Buffer, now: Date) {
    const c = this.challenges.get(nonceHash.toString("hex"));
    if (!c || c.usedAt || c.expiresAt <= now) return null;
    c.usedAt = now;
    return { ...c };
  }
  async upsertPlayer(wallet: string, now: Date) {
    const p = this.players.get(wallet) ?? { wallet, firstSeenAt: now, lastSeenAt: now, deletedAt: null };
    p.lastSeenAt = now;
    // 刪除後重新登入視為新的同意：重新啟用
    p.deletedAt = null;
    this.players.set(wallet, p);
    return { ...p };
  }
  async getPlayer(wallet: string) {
    const p = this.players.get(wallet);
    return p ? { ...p } : null;
  }
  async insertSession(s: Session) {
    this.sessions.set(s.jti, { ...s });
  }
  async getSessionByRefreshHash(h: Buffer) {
    for (const s of this.sessions.values()) if (s.refreshHash.equals(h)) return { ...s };
    return null;
  }
  async getSession(jti: string) {
    const s = this.sessions.get(jti);
    return s ? { ...s } : null;
  }
  async rotateSession(jti: string, rotatedTo: string, now: Date) {
    const s = this.sessions.get(jti);
    if (s) {
      s.usedAt = now;
      s.rotatedTo = rotatedTo;
    }
  }
  async revokeFamily(familyId: string, now: Date) {
    let n = 0;
    for (const s of this.sessions.values()) if (s.familyId === familyId && !s.revokedAt) { s.revokedAt = now; n++; }
    return n;
  }
  async revokeWallet(wallet: string, now: Date) {
    let n = 0;
    for (const s of this.sessions.values()) if (s.wallet === wallet && !s.revokedAt) { s.revokedAt = now; n++; }
    return n;
  }

  // ---- PG-B-11 ----
  async ensureRuleSet(row: RuleSetRow) {
    const cur = this.ruleSets.get(row.rulesVersion);
    if (cur && !cur.rulesHash.equals(row.rulesHash)) throw new Error(`rules_version ${row.rulesVersion} already exists with a different hash`);
    if (!cur) this.ruleSets.set(row.rulesVersion, row);
  }
  async insertHealthSnapshot(s: HealthSnapshotInput) {
    const id = this.snapshots.length + 1;
    this.snapshots.push({ ...s, id, createdAt: s.createdAt ?? new Date() });
    return id;
  }
  async insertRiskDecision(d: RiskDecisionInput) {
    this.decisions.push({ ...d });
  }
  async insertAttestation(a: AttestationRow) {
    const k = a.nonce.toString("hex");
    if (this.attestations.has(k)) throw new Error("duplicate nonce");
    this.attestations.set(k, { ...a });
  }
  async beginClaim(wallet: string, idempotencyKey: string, requestHash: Buffer, now: Date) {
    const k = `${wallet}:${idempotencyKey}`;
    const existing = this.claimResults.get(k);
    if (existing) return { acquired: false, existing: { ...existing } };
    this.claimResults.set(k, { wallet, idempotencyKey, requestHash, status: "processing", httpStatus: null, response: null, createdAt: now });
    return { acquired: true, existing: null };
  }
  async completeClaim(wallet: string, idempotencyKey: string, status: "succeeded" | "rejected", httpStatus: number, response: unknown, _now: Date) {
    const r = this.claimResults.get(`${wallet}:${idempotencyKey}`);
    if (r) Object.assign(r, { status, httpStatus, response });
  }
  async releaseClaim(wallet: string, idempotencyKey: string) {
    const k = `${wallet}:${idempotencyKey}`;
    if (this.claimResults.get(k)?.status === "processing") this.claimResults.delete(k);
  }

  // ---- PG-B-12／B-13 ----
  async listHistory(wallet: string, sinceTaskDate: number): Promise<HistoryItem[]> {
    return [...this.attestations.values()]
      .filter((a) => a.wallet === wallet && a.taskDate >= sinceTaskDate)
      .sort((a, b) => b.taskDate - a.taskDate || b.issuedAt.getTime() - a.issuedAt.getTime())
      .map((a) => ({ taskDate: a.taskDate, taskType: a.taskType, issuedAt: a.issuedAt, expiresAt: a.expiresAt, redeemedSig: this.redeemed.get(a.nonce.toString("hex")) ?? null }));
  }
  async hasActiveStakedTournament(_wallet: string) {
    return false;
  }

  // ---- PG-E-01 ----
  async createOrganization(o: Omit<PartnerOrganization, "createdAt" | "suspendedAt">, now: Date) {
    if ([...this.orgs.values()].some((x) => x.slug === o.slug)) throw new Error("duplicate slug");
    const row = { ...o, createdAt: now, suspendedAt: null };
    this.orgs.set(o.orgId, row);
    return row;
  }
  async getOrganization(orgId: string) {
    return this.orgs.get(orgId) ?? null;
  }
  async getOrganizationBySlug(slug: string) {
    return [...this.orgs.values()].find((x) => x.slug === slug) ?? null;
  }
  async upsertMembership(m: Omit<PartnerMembership, "grantedAt" | "revokedAt">, now: Date) {
    this.memberships.set(`${m.orgId}:${m.wallet}`, { ...m, grantedAt: now, revokedAt: null });
  }
  async revokeMembership(orgId: string, wallet: string, now: Date) {
    const m = this.memberships.get(`${orgId}:${wallet}`);
    if (!m || m.revokedAt) return false;
    m.revokedAt = now;
    return true;
  }
  async listMemberships(wallet: string) {
    return [...this.memberships.values()].filter((m) => m.wallet === wallet && !m.revokedAt && !this.orgs.get(m.orgId)?.suspendedAt);
  }
  async getMembership(orgId: string, wallet: string) {
    return this.memberships.get(`${orgId}:${wallet}`) ?? null;
  }
  async createEvent(e: Parameters<Store["createEvent"]>[0], now: Date) {
    if ([...this.events.values()].some((x) => x.slug === e.slug)) throw new Error("duplicate slug");
    const row: EventRow = { ...e, state: "draft", registrationCount: 0, currentRuleRevision: null, revision: 1, cancelReason: null, createdAt: now, updatedAt: now, publishedAt: null, cancelledAt: null };
    this.events.set(e.eventId, row);
    return row;
  }
  async getEvent(eventId: string) {
    return this.events.get(eventId) ?? null;
  }
  async getEventBySlug(slug: string) {
    return [...this.events.values()].find((x) => x.slug === slug) ?? null;
  }
  async updateEvent(eventId: string, expectedRevision: number, patch: EventPatch, now: Date) {
    const e = this.events.get(eventId);
    if (!e || e.revision !== expectedRevision) return null;
    Object.assign(e, patch, { revision: e.revision + 1, updatedAt: now });
    return e;
  }
  async transitionEvent(eventId: string, from: EventState[], to: EventState, extra: { cancelReason?: string; currentRuleRevision?: string }, now: Date) {
    const e = this.events.get(eventId);
    if (!e || !from.includes(e.state)) return null;
    e.state = to;
    e.revision += 1;
    e.updatedAt = now;
    if (to === "published") {
      e.publishedAt = now;
      if (extra.currentRuleRevision) e.currentRuleRevision = extra.currentRuleRevision;
    }
    if (to === "cancelled") {
      e.cancelledAt = now;
      e.cancelReason = extra.cancelReason ?? null;
    }
    return e;
  }
  async listPublishedEvents(limit: number, offset: number) {
    return [...this.events.values()].filter((e) => e.state === "published").sort((a, b) => (a.startsAt?.getTime() ?? 0) - (b.startsAt?.getTime() ?? 0)).slice(offset, offset + limit);
  }
  async listOrgEvents(orgId: string) {
    return [...this.events.values()].filter((e) => e.orgId === orgId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  async addRuleRevision(r: Omit<EventRuleRevision, "createdAt" | "publishedAt">, now: Date) {
    if ([...this.ruleRevisions.values()].some((x) => x.eventId === r.eventId && x.version === r.version)) throw new Error("duplicate version");
    const row = { ...r, createdAt: now, publishedAt: null };
    this.ruleRevisions.set(r.revisionId, row);
    return row;
  }
  async getRuleRevision(revisionId: string) {
    return this.ruleRevisions.get(revisionId) ?? null;
  }
  async listRuleRevisions(eventId: string) {
    return [...this.ruleRevisions.values()].filter((x) => x.eventId === eventId).sort((a, b) => a.version - b.version);
  }
  async markRuleRevisionPublished(revisionId: string, now: Date) {
    const r = this.ruleRevisions.get(revisionId);
    if (r) r.publishedAt = now;
  }
  async upsertEventRole(g: Omit<EventRoleGrant, "grantedAt" | "revokedAt">, now: Date) {
    this.eventRoles.set(`${g.eventId}:${g.wallet}:${g.role}`, { ...g, grantedAt: now, revokedAt: null });
  }
  async revokeEventRole(eventId: string, wallet: string, role: EventRole, now: Date) {
    const g = this.eventRoles.get(`${eventId}:${wallet}:${role}`);
    if (!g || g.revokedAt) return false;
    g.revokedAt = now;
    return true;
  }
  async listEventRoles(eventId: string, wallet: string) {
    return [...this.eventRoles.values()].filter((g) => g.eventId === eventId && g.wallet === wallet && !g.revokedAt);
  }
  async listEventRolesForWallet(wallet: string) {
    return [...this.eventRoles.values()].filter((g) => g.wallet === wallet && !g.revokedAt);
  }
  async appendAudit(entry: AuditEntry, now: Date) {
    this.audit.push({ ...entry, createdAt: now });
  }
  async listAudit(eventId: string, limit: number) {
    return this.audit.filter((a) => a.eventId === eventId).slice(-limit).reverse();
  }

  // ---- PG-E-03 ----
  async registerParticipant(p: { eventId: string; wallet: string; acceptedRuleRevision: string; displayName: string | null; publicConsent: boolean; levelAtRegistration?: number | null }, now: Date) {
    const e = this.events.get(p.eventId);
    if (!e || e.state !== "published") return "not_open" as const;
    const k = `${p.eventId}:${p.wallet}`;
    const cur = this.participants.get(k);
    if (cur && cur.status !== "cancelled") return "exists" as const;
    if (e.capacity !== 0 && e.registrationCount >= e.capacity) return "full" as const;
    e.registrationCount += 1;
    const row: EventParticipant = { eventId: p.eventId, wallet: p.wallet, status: "registered", acceptedRuleRevision: p.acceptedRuleRevision, displayName: p.displayName, publicConsentAt: p.publicConsent ? now : null, registeredAt: now, cancelledAt: null, retentionDueAt: null, levelAtRegistration: p.levelAtRegistration ?? null };
    this.participants.set(k, row);
    return row;
  }
  async listEventParticipants(eventId: string) {
    return [...this.participants.values()].filter((p) => p.eventId === eventId).map((p) => ({ ...p }));
  }
  async cancelRegistration(eventId: string, wallet: string, now: Date) {
    const cur = this.participants.get(`${eventId}:${wallet}`);
    if (!cur || cur.status === "cancelled") return null;
    cur.status = "cancelled";
    cur.cancelledAt = now;
    const e = this.events.get(eventId);
    if (e) e.registrationCount = Math.max(0, e.registrationCount - 1);
    return cur;
  }
  async getParticipant(eventId: string, wallet: string) {
    return this.participants.get(`${eventId}:${wallet}`) ?? null;
  }
  async listParticipations(wallet: string) {
    return [...this.participants.values()].filter((p) => p.wallet === wallet).sort((a, b) => b.registeredAt.getTime() - a.registeredAt.getTime());
  }
  async updateParticipantPrivacy(eventId: string, wallet: string, patch: { displayName?: string | null; publicConsent?: boolean }, now: Date) {
    const cur = this.participants.get(`${eventId}:${wallet}`);
    if (!cur) return null;
    if (patch.displayName !== undefined) cur.displayName = patch.displayName;
    if (patch.publicConsent !== undefined) cur.publicConsentAt = patch.publicConsent ? now : null;
    return cur;
  }
  async bumpCampaign(eventId: string, source: string, day: string, field: "views" | "registrations" | "checkins" | "redemptions") {
    const k = `${eventId}:${source}:${day}`;
    const row = this.campaign.get(k) ?? { source, day, views: 0, registrations: 0, checkins: 0, redemptions: 0 };
    row[field] += 1;
    this.campaign.set(k, row);
  }
  async listCampaign(eventId: string) {
    return [...this.campaign.entries()].filter(([k]) => k.startsWith(`${eventId}:`)).map(([, v]) => v);
  }

  // ---- PG-E-04 ----
  async createCheckpoint(c: Checkpoint) {
    this.checkpoints.set(c.checkpointId, c);
  }
  async listCheckpoints(eventId: string) {
    return [...this.checkpoints.values()].filter((c) => c.eventId === eventId);
  }
  async getCheckpoint(eventId: string, checkpointId: string) {
    const c = this.checkpoints.get(checkpointId);
    return c && c.eventId === eventId ? c : null;
  }
  async createTag(t: Omit<NfcTag, "issuedAt" | "revokedAt">, now: Date) {
    if ([...this.tags.values()].some((x) => x.opaqueRef === t.opaqueRef)) throw new Error("duplicate opaque_ref");
    this.tags.set(t.tagId, { ...t, issuedAt: now, revokedAt: null });
  }
  async getTagByRef(opaqueRef: string) {
    return [...this.tags.values()].find((x) => x.opaqueRef === opaqueRef) ?? null;
  }
  async listTags(eventId: string) {
    return [...this.tags.values()].filter((x) => x.eventId === eventId);
  }
  async revokeTag(eventId: string, tagId: string, now: Date) {
    const t = this.tags.get(tagId);
    if (!t || t.eventId !== eventId || t.revokedAt) return false;
    t.revokedAt = now;
    return true;
  }

  // ---- PG-E-05 ----
  async insertCheckinChallenge(c: { challengeHash: Buffer; eventId: string; wallet: string; checkpointId: string; expiresAt: Date }) {
    this.checkinChallenges.set(c.challengeHash.toString("hex"), { ...c, usedAt: null });
  }
  async consumeCheckinChallenge(challengeHash: Buffer, now: Date) {
    const c = this.checkinChallenges.get(challengeHash.toString("hex"));
    if (!c || c.usedAt || c.expiresAt <= now) return null;
    c.usedAt = now;
    return { eventId: c.eventId, wallet: c.wallet, checkpointId: c.checkpointId };
  }
  async insertCheckin(c: { eventId: string; wallet: string; checkpointId: string; confirmedBy: string; method: "nfc" | "qr" | "manual" }, now: Date) {
    if (this.checkins.some((x) => x.eventId === c.eventId && x.wallet === c.wallet && x.checkpointId === c.checkpointId)) return false;
    this.checkins.push({ ...c, confirmedAt: now });
    const p = this.participants.get(`${c.eventId}:${c.wallet}`);
    if (p && p.status === "registered") p.status = "checked_in";
    return true;
  }
  async listCheckins(eventId: string, wallet?: string) {
    return this.checkins.filter((x) => x.eventId === eventId && (!wallet || x.wallet === wallet));
  }

  // ---- PG-E-06 ----
  async createBenefit(b: EventBenefit) {
    this.benefits.set(b.benefitId, { ...b });
  }
  async listBenefits(eventId: string) {
    return [...this.benefits.values()].filter((b) => b.eventId === eventId).map((b) => ({ ...b }));
  }
  async getBenefit(eventId: string, benefitId: string) {
    const b = this.benefits.get(benefitId);
    return b && b.eventId === eventId ? { ...b } : null;
  }
  async reserveRedemption(r: { redemptionId: string; eventId: string; wallet: string; benefitId: string; quantity: number; idempotencyKey: string; claimCode: string; reservedUntil: Date; credentialId: string | null }, now: Date): Promise<ReserveOutcome> {
    await this.expireRedemptions(now);
    const existing = [...this.redemptions.values()].find((x) => x.eventId === r.eventId && x.wallet === r.wallet && x.idempotencyKey === r.idempotencyKey);
    if (existing) return { kind: "ok", redemption: { ...existing }, created: false };
    const e = this.events.get(r.eventId);
    if (!e || e.state !== "published") return { kind: "not_open" };
    const b = this.benefits.get(r.benefitId);
    if (!b || b.eventId !== r.eventId) return { kind: "no_benefit" };
    const p = this.participants.get(`${r.eventId}:${r.wallet}`);
    if (!p || p.status === "cancelled") return { kind: "not_eligible" };
    if (b.requiresCheckin && p.status !== "checked_in") return { kind: "checkin_required" };
    if (b.claimDeadline && b.claimDeadline <= now) return { kind: "deadline_passed" };
    const mine = [...this.redemptions.values()].filter((x) => x.eventId === r.eventId && x.wallet === r.wallet && x.benefitId === r.benefitId && (x.status === "reserved" || x.status === "fulfilled")).reduce((n, x) => n + x.quantity, 0);
    if (mine + r.quantity > b.perPersonLimit) return { kind: "limit_reached" };
    if (b.reservedCount + b.fulfilledCount + r.quantity > b.stockTotal) return { kind: "out_of_stock" };
    const digital = b.kind === "digital_badge";
    if (digital) b.fulfilledCount += r.quantity;
    else b.reservedCount += r.quantity;
    const row: EventRedemption = { redemptionId: r.redemptionId, eventId: r.eventId, wallet: r.wallet, benefitId: r.benefitId, quantity: r.quantity, status: digital ? "fulfilled" : "reserved", reservedAt: now, reservedUntil: r.reservedUntil, fulfilledBy: digital ? "system" : null, fulfilledAt: digital ? now : null, idempotencyKey: r.idempotencyKey, claimCode: r.claimCode, credentialId: digital ? r.credentialId : null };
    this.redemptions.set(row.redemptionId, row);
    return { kind: "ok", redemption: { ...row }, created: true };
  }
  async fulfillRedemption(eventId: string, key: { redemptionId?: string; claimCode?: string }, staffWallet: string, now: Date): Promise<FulfillOutcome> {
    await this.expireRedemptions(now);
    const row = [...this.redemptions.values()].find((x) => x.eventId === eventId && ((key.redemptionId && x.redemptionId === key.redemptionId) || (key.claimCode && x.claimCode === key.claimCode)));
    if (!row) return { kind: "not_found" };
    if (row.status === "fulfilled") return { kind: "ok", redemption: { ...row }, already: true };
    if (row.status !== "reserved") return { kind: row.status };
    const b = this.benefits.get(row.benefitId)!;
    b.reservedCount -= row.quantity;
    b.fulfilledCount += row.quantity;
    row.status = "fulfilled";
    row.fulfilledBy = staffWallet;
    row.fulfilledAt = now;
    return { kind: "ok", redemption: { ...row }, already: false };
  }
  private release(row: EventRedemption, to: "expired" | "cancelled") {
    const b = this.benefits.get(row.benefitId);
    if (b) b.reservedCount = Math.max(0, b.reservedCount - row.quantity);
    row.status = to;
  }
  async expireRedemptions(now: Date) {
    let n = 0;
    for (const row of this.redemptions.values()) if (row.status === "reserved" && row.reservedUntil <= now) { this.release(row, "expired"); n += 1; }
    return n;
  }
  async releaseEventReservations(eventId: string, _now: Date) {
    let n = 0;
    for (const row of this.redemptions.values()) if (row.eventId === eventId && row.status === "reserved") { this.release(row, "cancelled"); n += 1; }
    return n;
  }
  async listRedemptions(eventId: string, wallet?: string) {
    return [...this.redemptions.values()].filter((x) => x.eventId === eventId && (!wallet || x.wallet === wallet)).sort((a, b) => b.reservedAt.getTime() - a.reservedAt.getTime()).map((x) => ({ ...x }));
  }
  async getRedemption(redemptionId: string) {
    const x = this.redemptions.get(redemptionId);
    return x ? { ...x } : null;
  }

  // ---- PG-E-07／E-08 ----
  async createResultImport(r: Omit<ResultImport, "importVersion" | "createdAt" | "publishedAt" | "publishedBy">, now: Date) {
    const version = [...this.resultImports.values()].filter((x) => x.eventId === r.eventId).reduce((m, x) => Math.max(m, x.importVersion), 0) + 1;
    const row: ResultImport = { ...r, importVersion: version, createdAt: now, publishedAt: null, publishedBy: null };
    this.resultImports.set(row.importId, row);
    return { ...row };
  }
  async getResultImport(eventId: string, importId: string) {
    const x = this.resultImports.get(importId);
    return x && x.eventId === eventId ? { ...x } : null;
  }
  async listResultImports(eventId: string) {
    return [...this.resultImports.values()].filter((x) => x.eventId === eventId).sort((a, b) => b.importVersion - a.importVersion).map((x) => ({ ...x }));
  }
  async publishResultImport(eventId: string, importId: string, publisher: string, reason: string | null, now: Date) {
    const imp = this.resultImports.get(importId);
    if (!imp || imp.eventId !== eventId) return "not_found" as const;
    if (imp.publishedAt) return "already" as const;
    if (imp.errorCount > 0) return "has_errors" as const;
    let corrections = 0;
    for (const row of imp.stagedRows) {
      const prev = this.resultRevisions.filter((x) => x.eventId === eventId && x.wallet === row.wallet && x.discipline === row.discipline).sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())[0];
      if (prev) corrections += 1;
      this.resultRevisions.push({ revisionId: `${importId}:${row.wallet}:${row.discipline}`, eventId, importId, wallet: row.wallet, discipline: row.discipline, division: row.division, distanceM: row.distanceM, elapsedMs: row.elapsedMs, rank: row.rank, finishStatus: row.finishStatus, previousRevisionId: prev?.revisionId ?? null, reason: prev ? reason : null, publishedAt: now });
    }
    imp.publishedAt = now;
    imp.publishedBy = publisher;
    return { revisions: imp.stagedRows.length, corrections };
  }
  async listCurrentResults(eventId: string) {
    const latest = new Map<string, ResultRevision>();
    for (const x of [...this.resultRevisions].sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime())) if (x.eventId === eventId) latest.set(`${x.wallet}|${x.discipline}`, x);
    return [...latest.values()].map((x) => {
      const p = this.participants.get(`${eventId}:${x.wallet}`);
      return { ...x, displayName: p?.displayName ?? null, publicConsent: !!p?.publicConsentAt };
    });
  }
  // ---- PG-E-09 ----
  private wipeWalletInEvent(eventId: string, wallet: string, counts: { participants: number; checkins: number; redemptions: number; results: number }) {
    const before = this.checkins.length;
    this.checkins = this.checkins.filter((c) => !(c.eventId === eventId && c.wallet === wallet));
    counts.checkins += before - this.checkins.length;
    for (const [k, c] of this.checkinChallenges) if (c.eventId === eventId && c.wallet === wallet) this.checkinChallenges.delete(k);
    for (const [k, r] of this.redemptions) if (r.eventId === eventId && r.wallet === wallet) { if (r.status === "reserved") this.release(r, "cancelled"); this.redemptions.delete(k); counts.redemptions += 1; }
    const rb = this.resultRevisions.length;
    this.resultRevisions = this.resultRevisions.filter((r) => !(r.eventId === eventId && r.wallet === wallet));
    counts.results += rb - this.resultRevisions.length;
    for (const imp of this.resultImports.values()) if (imp.eventId === eventId) imp.stagedRows = imp.stagedRows.filter((r) => r.wallet !== wallet);
    for (const [k, t] of this.tags) if (t.eventId === eventId && t.participantWallet === wallet) this.tags.delete(k);
    if (this.participants.delete(`${eventId}:${wallet}`)) counts.participants += 1;
  }
  async purgeEventData(cutoff: Date, now: Date) {
    const counts = { events: [] as string[], participants: 0, checkins: 0, redemptions: 0, results: 0 };
    for (const e of this.events.values()) {
      const end = e.cancelledAt ?? e.endsAt;
      if (e.purgedAt || !end || end >= cutoff) continue;
      for (const p of [...this.participants.values()]) if (p.eventId === e.eventId) this.wipeWalletInEvent(e.eventId, p.wallet, counts);
      for (const imp of this.resultImports.values()) if (imp.eventId === e.eventId) imp.stagedRows = [];
      e.purgedAt = now;
      counts.events.push(e.eventId);
    }
    return counts;
  }
  async deleteWalletEventData(wallet: string, _now: Date) {
    const counts = { participants: 0, checkins: 0, redemptions: 0, results: 0 };
    for (const p of [...this.participants.values()]) if (p.wallet === wallet) this.wipeWalletInEvent(p.eventId, wallet, counts);
    return counts;
  }
  // ---- PG-R-01 ----
  private overlapRatio(a: { startedAt: Date; endedAt: Date }, b: { startedAt: Date; endedAt: Date }) {
    const s = Math.max(a.startedAt.getTime(), b.startedAt.getTime());
    const e = Math.min(a.endedAt.getTime(), b.endedAt.getTime());
    const shorter = Math.min(a.endedAt.getTime() - a.startedAt.getTime(), b.endedAt.getTime() - b.startedAt.getTime());
    return shorter > 0 ? Math.max(0, e - s) / shorter : 0;
  }
  async upsertWorkout(w: Omit<WorkoutSession, "revision" | "importedAt" | "updatedAt" | "deletedAt" | "possibleDuplicateOf">, now: Date) {
    const existing = [...this.workouts.values()].find((x) => x.wallet === w.wallet && x.origin === w.origin && x.externalRecordId === w.externalRecordId);
    if (existing) {
      if (existing.deletedAt && w.sourceRevision <= existing.sourceRevision) return { outcome: "deleted" as const, session: { ...existing } };
      if (w.sourceRevision < existing.sourceRevision) return { outcome: "stale" as const, session: { ...existing } };
      if (w.sourceRevision === existing.sourceRevision && !existing.deletedAt) return { outcome: "same" as const, session: { ...existing } };
      const dup = this.findDuplicate(w, existing.sessionId);
      Object.assign(existing, { ...w, sessionId: existing.sessionId, revision: existing.revision + 1, updatedAt: now, deletedAt: null, possibleDuplicateOf: dup });
      return { outcome: "superseded" as const, session: { ...existing } };
    }
    const dup = this.findDuplicate(w, null);
    const row: WorkoutSession = { ...w, revision: 1, importedAt: now, updatedAt: now, deletedAt: null, possibleDuplicateOf: dup };
    this.workouts.set(row.sessionId, row);
    return { outcome: "created" as const, session: { ...row } };
  }
  private findDuplicate(w: { wallet: string; origin: string; startedAt: Date; endedAt: Date }, selfId: string | null) {
    const other = [...this.workouts.values()].filter((x) => x.wallet === w.wallet && x.sessionId !== selfId && !x.deletedAt && x.origin !== w.origin && this.overlapRatio(x, w) >= 0.5).sort((a, b) => a.importedAt.getTime() - b.importedAt.getTime())[0];
    return other?.sessionId ?? null;
  }
  async listWorkouts(wallet: string, limit: number, offset: number) {
    return [...this.workouts.values()].filter((x) => x.wallet === wallet && !x.deletedAt).sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime()).slice(offset, offset + limit).map((x) => ({ ...x }));
  }
  async getWorkout(wallet: string, sessionId: string) {
    const x = this.workouts.get(sessionId);
    return x && x.wallet === wallet && !x.deletedAt ? { ...x } : null;
  }
  async deleteWorkout(wallet: string, sessionId: string, now: Date) {
    const x = this.workouts.get(sessionId);
    if (!x || x.wallet !== wallet || x.deletedAt) return false;
    x.deletedAt = now;
    x.status = "deleted";
    x.updatedAt = now;
    for (const o of this.workouts.values()) if (o.possibleDuplicateOf === sessionId) o.possibleDuplicateOf = null;
    return true;
  }
  // ---- PG-R-07 ----
  async listPbRevisions(wallet: string) {
    return [...this.pbs.values()].filter((p) => p.wallet === wallet).map((p) => ({ ...p }));
  }
  async syncPbRevisions(wallet: string, desired: PbDesired[], now: Date) {
    const mine = [...this.pbs.values()].filter((p) => p.wallet === wallet);
    const byKey = new Map(mine.map((p) => [`${p.discipline}|${p.category}|${p.environment}|${p.verificationClass}|${p.timingBasis}|${p.rulesMajor}|${p.sourceKind}|${p.sourceId}`, p]));
    const seen = new Set<string>();
    for (const d of desired) {
      const id = `${d.key}|${d.sourceKind}|${d.sourceId}`;
      seen.add(id);
      const prev = d.previousSourceId ? byKey.get(`${d.key}|${d.sourceKind}|${d.previousSourceId}`) ?? [...this.pbs.values()].find((p) => p.wallet === wallet && `${p.discipline}|${p.category}|${p.environment}|${p.verificationClass}|${p.timingBasis}|${p.rulesMajor}` === d.key && p.sourceId === d.previousSourceId) : null;
      const cur = byKey.get(id);
      if (cur) Object.assign(cur, { value: d.value, sourceRevision: d.sourceRevision, achievedAt: d.achievedAt, status: d.status, isBaseline: d.isBaseline, previousPbId: prev?.pbId ?? null, invalidatedAt: null, reason: null });
      else {
        const row: PbRevision = { pbId: randomUUID(), wallet, discipline: d.discipline, category: d.category, environment: d.environment, verificationClass: d.verificationClass, timingBasis: d.timingBasis, rulesMajor: d.rulesMajor, value: d.value, sourceKind: d.sourceKind, sourceId: d.sourceId, sourceRevision: d.sourceRevision, achievedAt: d.achievedAt, status: d.status, isBaseline: d.isBaseline, previousPbId: prev?.pbId ?? null, createdAt: now, invalidatedAt: null, reason: null };
        this.pbs.set(row.pbId, row);
        byKey.set(id, row);
      }
    }
    for (const p of mine) {
      const id = `${p.discipline}|${p.category}|${p.environment}|${p.verificationClass}|${p.timingBasis}|${p.rulesMajor}|${p.sourceKind}|${p.sourceId}`;
      if (!seen.has(id) && p.status !== "invalidated") { p.status = "invalidated"; p.invalidatedAt = now; p.reason = "source_removed_or_corrected"; }
    }
    return this.listPbRevisions(wallet);
  }
  // ---- PG-R-08 ----
  async upsertAchievement(a: Omit<Achievement, "createdAt" | "updatedAt">, now: Date) {
    const cur = this.achievements.get(a.achievementId);
    if (cur) {
      if (cur.status !== "minted" && !cur.metadataHash.equals(a.metadataHash)) Object.assign(cur, { metadata: a.metadata, metadataHash: a.metadataHash, publicConsent: a.publicConsent, sourceKind: a.sourceKind, sourceId: a.sourceId, sourceRevision: a.sourceRevision, status: "pending_registry", updatedAt: now });
      return { ...cur };
    }
    const row: Achievement = { ...a, createdAt: now, updatedAt: now };
    this.achievements.set(row.achievementId, row);
    return { ...row };
  }
  async getAchievement(achievementId: string) {
    const x = this.achievements.get(achievementId);
    return x ? { ...x } : null;
  }
  async setAchievementSource(achievementId: string, source: { sourceKind: "workout" | "result"; sourceId: string; sourceRevision: number }, now: Date) {
    const cur = this.achievements.get(achievementId);
    if (!cur) return null;
    Object.assign(cur, { ...source, updatedAt: now });
    return { ...cur };
  }
  async getAchievementByPb(pbId: string) {
    const x = [...this.achievements.values()].find((a) => a.pbId === pbId);
    return x ? { ...x } : null;
  }
  async listAchievements(wallet: string) {
    return [...this.achievements.values()].filter((a) => a.wallet === wallet).map((a) => ({ ...a }));
  }
  async listAchievementsByStatus(status: Achievement["status"][], limit: number) {
    return [...this.achievements.values()].filter((a) => status.includes(a.status)).slice(0, limit).map((a) => ({ ...a }));
  }
  async setAchievementStatus(achievementId: string, status: Achievement["status"], extra: { registrySignature?: string; asset?: string; mintedSignature?: string }, now: Date) {
    const x = this.achievements.get(achievementId);
    if (!x) return null;
    x.status = status;
    x.updatedAt = now;
    if (extra.registrySignature !== undefined) { x.registrySignature = extra.registrySignature; x.registryUpdatedAt = now; }
    if (extra.asset !== undefined) x.asset = extra.asset;
    if (extra.mintedSignature !== undefined) { x.mintedSignature = extra.mintedSignature; x.mintedAt = now; }
    return { ...x };
  }
  async listCurrentResultsForWallet(wallet: string) {
    const latest = new Map<string, ResultRevision>();
    for (const x of [...this.resultRevisions].sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime())) if (x.wallet === wallet) latest.set(`${x.eventId}|${x.discipline}`, x);
    return [...latest.values()].map((x) => ({ ...x }));
  }
  async listResultHistory(eventId: string, wallet: string) {
    // 同一時刻發布時以插入順序為準（後發布者在前）
    return this.resultRevisions.filter((x) => x.eventId === eventId && x.wallet === wallet).reverse().sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime()).map((x) => ({ ...x }));
  }

  // ---- PG-G-01 ----
  private galleryRanked(board: GalleryBoard = "active") {
    return [...this.galleryPlayers.values()].filter((p) => !this.galleryHidden.has(p.wallet)).sort(board === "lifetime" ? compareLifetime : compareGallery);
  }
  async setGalleryHidden(wallet: string, hidden: boolean, _now: Date) {
    if (hidden) this.galleryHidden.add(wallet);
    else this.galleryHidden.delete(wallet);
  }
  async isGalleryHidden(wallet: string) {
    return this.galleryHidden.has(wallet);
  }
  async getAchievementByAsset(asset: string) {
    const x = [...this.achievements.values()].find((a) => a.asset === asset);
    return x ? { ...x } : null;
  }
  async upsertGalleryPlayer(p: { wallet: string; shoeLevel: number; coreLevel: number; xp: bigint; streakDays: number; maxStreakDays: number; lastTaskDate: number | null; slot: number }, now: Date) {
    const cur = this.galleryPlayers.get(p.wallet);
    if (cur && cur.updatedSlot > p.slot) return;
    this.galleryPlayers.set(p.wallet, { wallet: p.wallet, shoeLevel: p.shoeLevel, coreLevel: p.coreLevel, xp: p.xp, streakDays: p.streakDays, maxStreakDays: p.maxStreakDays, lastTaskDate: p.lastTaskDate, collectibleCount: cur?.collectibleCount ?? 0, updatedSlot: p.slot, updatedAt: now, highestLevel: Math.max(cur?.highestLevel ?? 1, p.shoeLevel) });
  }
  private levelHistory: LevelHistoryEntry[] = [];
  async setGalleryHighestLevel(wallet: string, highestLevel: number, _slot: number, now: Date) {
    const cur = this.galleryPlayers.get(wallet);
    if (!cur) return;
    if (highestLevel > cur.highestLevel) Object.assign(cur, { highestLevel, updatedAt: now });
  }
  async insertLevelHistory(e: LevelHistoryEntry) {
    if (this.levelHistory.some((x) => x.wallet === e.wallet && x.signature === e.signature && x.source === e.source)) return false;
    this.levelHistory.push({ ...e });
    return true;
  }
  async levelAt(wallet: string, taskDate: number) {
    const list = this.levelHistory.filter((x) => x.wallet === wallet && x.effectiveFromDate <= taskDate).sort((a, b) => b.effectiveFromDate - a.effectiveFromDate || b.slot - a.slot);
    return list[0] ? { ...list[0] } : null;
  }
  async listLevelHistory(wallet: string, limit: number) {
    return this.levelHistory.filter((x) => x.wallet === wallet).sort((a, b) => b.effectiveFromDate - a.effectiveFromDate || b.slot - a.slot).slice(0, limit).map((x) => ({ ...x }));
  }
  async insertGalleryCollectible(c: GalleryCollectible) {
    const k = `${c.wallet}:${c.kind}`;
    if (this.galleryCollectibles.has(k)) return false;
    this.galleryCollectibles.set(k, c);
    const p = this.galleryPlayers.get(c.wallet);
    if (p) p.collectibleCount += 1;
    return true;
  }
  async getGalleryPlayer(wallet: string) {
    return this.galleryPlayers.get(wallet) ?? null;
  }
  async listGalleryPlayers(limit: number, offset: number, board: GalleryBoard = "active") {
    return this.galleryRanked(board).slice(offset, offset + limit);
  }
  async countGalleryPlayers() {
    return this.galleryRanked().length;
  }
  async galleryRankOf(wallet: string, board: GalleryBoard = "active") {
    const i = this.galleryRanked(board).findIndex((p) => p.wallet === wallet);
    return i < 0 ? null : i + 1;
  }
  async searchGalleryPlayers(prefix: string, limit: number) {
    return this.galleryRanked().filter((p) => p.wallet.startsWith(prefix)).slice(0, limit);
  }
  async listGalleryCollectibles(wallet: string) {
    return [...this.galleryCollectibles.values()].filter((c) => c.wallet === wallet).sort((a, b) => a.kind - b.kind);
  }

  async familyFirstExpiresAt(familyId: string) {
    const t = [...this.sessions.values()].filter((x) => x.familyId === familyId).map((x) => x.expiresAt.getTime());
    return t.length ? new Date(Math.min(...t)) : null;
  }

  // ---- PG-B-17 ----
  async purgeExpired(cutoff: Date, now: Date): Promise<PurgeCounts> {
    const before = this.snapshots.length;
    const removed = new Set(this.snapshots.filter((x) => (x.createdAt ?? now) < cutoff).map((x) => x.id));
    this.snapshots = this.snapshots.filter((x) => !removed.has(x.id));
    this.decisions = this.decisions.filter((d) => !removed.has(d.snapshotId));
    let attestations = 0;
    for (const [k, a] of this.attestations) if (a.issuedAt < cutoff) { this.attestations.delete(k); this.redeemed.delete(k); attestations++; }
    let claimResults = 0;
    for (const [k, r] of this.claimResults) if (r.createdAt < cutoff) { this.claimResults.delete(k); claimResults++; }
    let tournamentSteps = 0;
    for (const [k, r] of this.tournamentSteps) if (r.updatedAt < cutoff) { this.tournamentSteps.delete(k); tournamentSteps++; }
    let challenges = 0;
    for (const [k, c] of this.challenges) if (c.expiresAt < now) { this.challenges.delete(k); challenges++; }
    let sessions = 0;
    for (const [k, sess] of this.sessions) if (sess.expiresAt < now || (sess.revokedAt && sess.revokedAt < cutoff)) { this.sessions.delete(k); sessions++; }
    return { snapshots: before - this.snapshots.length, attestations, claimResults, tournamentSteps, challenges, sessions };
  }
  async listDueDeletions(now: Date) {
    return [...this.players.values()].filter((p) => p.deletedAt && p.deletionDueAt && p.deletionDueAt <= now).map((p) => p.wallet);
  }
  async markDeletionDone(wallet: string) {
    const p = this.players.get(wallet);
    if (p) p.deletionDueAt = null;
  }

  // ---- PG-B-16 ----
  async getCursor(name: string) {
    return this.cursors.get(name) ?? null;
  }
  async setCursor(name: string, signature: string, slot: number) {
    this.cursors.set(name, { signature, slot });
  }
  async insertChainEvent(e: ChainEventInput, now: Date) {
    const k = `${e.signature}:${e.eventIndex}`;
    if (!this.chainEvents.has(k)) this.chainEvents.set(k, { ...e, orphanedAt: null, ingestedAt: now });
  }
  async listPendingChainEvents(limit: number) {
    return [...this.chainEvents.values()].filter((e) => e.commitment === "confirmed" && !e.orphanedAt).sort((a, b) => a.slot - b.slot || a.eventIndex - b.eventIndex).slice(0, limit);
  }
  async finalizeChainEvent(signature: string, eventIndex: number) {
    const e = this.chainEvents.get(`${signature}:${eventIndex}`);
    if (e) e.commitment = "finalized";
  }
  async markChainEventOrphaned(signature: string, eventIndex: number, now: Date) {
    const e = this.chainEvents.get(`${signature}:${eventIndex}`);
    if (e) e.orphanedAt = now;
  }
  async listChainEvents(filter: { eventName?: string; wallet?: string; finalizedOnly?: boolean }, limit: number) {
    return [...this.chainEvents.values()]
      .filter((e) => (!filter.eventName || e.eventName === filter.eventName) && (!filter.wallet || e.payload.wallet === filter.wallet) && (!filter.finalizedOnly || (e.commitment === "finalized" && !e.orphanedAt)))
      .sort((a, b) => b.slot - a.slot || b.eventIndex - a.eventIndex)
      .slice(0, limit);
  }
  async backfillRedeemedSig(nonce: Buffer, signature: string) {
    const k = nonce.toString("hex");
    if (!this.attestations.has(k) || this.redeemed.has(k)) return false;
    this.redeemed.set(k, signature);
    return true;
  }

  // ---- PG-B-14 ----
  async getTournamentSteps(weekId: number, wallet: string) {
    return this.tournamentSteps.get(`${weekId}:${wallet}`) ?? null;
  }
  async upsertTournamentSteps(weekId: number, wallet: string, verifiedSteps: number, reachedAt: Date, now: Date) {
    const k = `${weekId}:${wallet}`;
    const cur = this.tournamentSteps.get(k);
    if (cur && cur.verifiedSteps >= verifiedSteps) return { row: cur, changed: false };
    const row: TournamentStepsRow = { weekId, wallet, verifiedSteps, firstReachedAt: reachedAt, updatedAt: now };
    this.tournamentSteps.set(k, row);
    return { row, changed: true };
  }
  async listTournamentSteps(weekId: number, limit: number) {
    return sortLeaderboard([...this.tournamentSteps.values()].filter((r) => r.weekId === weekId)).slice(0, limit);
  }
  async countTournamentSteps(weekId: number) {
    return [...this.tournamentSteps.values()].filter((r) => r.weekId === weekId).length;
  }
  async rankOf(weekId: number, wallet: string) {
    const i = sortLeaderboard([...this.tournamentSteps.values()].filter((r) => r.weekId === weekId)).findIndex((r) => r.wallet === wallet);
    return i < 0 ? null : i + 1;
  }
  // ---- PG-U-04：探索冊 ----
  private questTemplates: QuestTemplate[] = [
    { templateId: "three_days", version: 1, kind: "active_days", params: { days: 3 }, cosmeticId: "chapter_01_three_days", active: true },
    { templateId: "timed_goal", version: 1, kind: "goal_time", params: { minutes: [10, 20, 30] }, cosmeticId: "chapter_01_timed_goal", active: true },
  ];
  private questEnrollments = new Map<string, QuestEnrollment>();
  private questContributions = new Map<string, QuestContribution[]>();
  private questReceipts = new Map<string, QuestReceipt>(); // by enrollmentId
  private cosmetics: CosmeticEntitlement[] = [];
  async listQuestTemplates() { return this.questTemplates.filter((t) => t.active).map((t) => ({ ...t })); }
  async listQuestEnrollments(wallet: string) { return [...this.questEnrollments.values()].filter((e) => e.wallet === wallet).sort((a, b) => b.periodEnd.getTime() - a.periodEnd.getTime()).map((e) => ({ ...e })); }
  async getQuestEnrollment(wallet: string, enrollmentId: string) { const e = this.questEnrollments.get(enrollmentId); return e && e.wallet === wallet ? { ...e } : null; }
  async createQuestEnrollment(e: Omit<QuestEnrollment, "status" | "completedAt" | "updatedAt">, now: Date) {
    const dup = [...this.questEnrollments.values()].find((x) => x.wallet === e.wallet && (x.idempotencyKey === e.idempotencyKey || (x.templateId === e.templateId && x.periodStart.getTime() === e.periodStart.getTime())));
    if (dup) return { enrollment: { ...dup }, created: false };
    const row: QuestEnrollment = { ...e, status: "active", completedAt: null, updatedAt: now };
    this.questEnrollments.set(row.enrollmentId, row);
    return { enrollment: { ...row }, created: true };
  }
  async replaceQuestContributions(enrollmentId: string, list: QuestContribution[]) { this.questContributions.set(enrollmentId, list.map((c) => ({ ...c }))); }
  async listQuestContributions(enrollmentId: string) { return (this.questContributions.get(enrollmentId) ?? []).map((c) => ({ ...c })); }
  async setQuestEnrollmentStatus(enrollmentId: string, status: QuestEnrollment["status"], completedAt: Date | null, now: Date) {
    const e = this.questEnrollments.get(enrollmentId);
    if (!e) return null;
    Object.assign(e, { status, completedAt, updatedAt: now });
    return { ...e };
  }
  async issueQuestReceipt(r: Omit<QuestReceipt, "revokedAt" | "revokeReason">, now: Date) {
    const cur = this.questReceipts.get(r.enrollmentId);
    if (cur) return { receipt: { ...cur }, created: false };
    const receipt: QuestReceipt = { ...r, revokedAt: null, revokeReason: null };
    this.questReceipts.set(r.enrollmentId, receipt);
    this.cosmetics.push({ wallet: r.wallet, cosmeticId: r.cosmeticId, receiptId: r.receiptId, status: "active", grantedAt: now, updatedAt: now });
    await this.setQuestEnrollmentStatus(r.enrollmentId, "claimed", this.questEnrollments.get(r.enrollmentId)?.completedAt ?? now, now);
    return { receipt: { ...receipt }, created: true };
  }
  async getQuestReceipt(enrollmentId: string) { const r = this.questReceipts.get(enrollmentId); return r ? { ...r } : null; }
  async revokeQuestReceipt(enrollmentId: string, reason: string, now: Date) {
    const r = this.questReceipts.get(enrollmentId);
    if (r && !r.revokedAt) Object.assign(r, { revokedAt: now, revokeReason: reason });
    for (const c of this.cosmetics) if (r && c.receiptId === r.receiptId) Object.assign(c, { status: "revoked", updatedAt: now });
    await this.setQuestEnrollmentStatus(enrollmentId, "revoked", null, now);
  }
  async restoreQuestReceipt(enrollmentId: string, now: Date) {
    const r = this.questReceipts.get(enrollmentId);
    if (!r) return;
    Object.assign(r, { revokedAt: null, revokeReason: null });
    for (const c of this.cosmetics) if (c.receiptId === r.receiptId) Object.assign(c, { status: "active", updatedAt: now });
    await this.setQuestEnrollmentStatus(enrollmentId, "claimed", this.questEnrollments.get(enrollmentId)?.completedAt ?? now, now);
  }
  async listCosmetics(wallet: string) { return this.cosmetics.filter((c) => c.wallet === wallet).map((c) => ({ ...c })); }

  async deletePlayerData(wallet: string, now: Date, deferUntil: Date | null): Promise<DeletionResult> {
    // PG-U-04：探索冊資料隨錢包刪除
    for (const [id, e] of this.questEnrollments) if (e.wallet === wallet) { this.questEnrollments.delete(id); this.questContributions.delete(id); this.questReceipts.delete(id); }
    this.cosmetics = this.cosmetics.filter((c) => c.wallet !== wallet);
    const sessions = await this.revokeWallet(wallet, now);
    const p = this.players.get(wallet);
    if (p) {
      p.deletedAt ??= now; // 延後刪除到期執行時保留最初的請求時間
      p.deletionDueAt = deferUntil;
    }
    if (deferUntil) return { deferred: true, deletionDueAt: deferUntil, deleted: { snapshots: 0, attestations: 0, claimResults: 0, sessions } };
    const before = this.snapshots.length;
    const removedIds = new Set(this.snapshots.filter((s) => s.wallet === wallet).map((s) => s.id));
    this.snapshots = this.snapshots.filter((s) => s.wallet !== wallet);
    this.decisions = this.decisions.filter((d) => !removedIds.has(d.snapshotId));
    let attestations = 0;
    for (const [k, a] of this.attestations) if (a.wallet === wallet) { this.attestations.delete(k); attestations++; }
    let claimResults = 0;
    for (const [k, r] of this.claimResults) if (r.wallet === wallet) { this.claimResults.delete(k); claimResults++; }
    await this.deleteWalletEventData(wallet, now); // BR-32：活動個人層資料一併刪除
    for (const [k, x] of this.workouts) if (x.wallet === wallet) this.workouts.delete(k); // PG-R-01：運動摘要一併刪除
    for (const [k, x] of this.achievements) if (x.wallet === wallet && x.mintedSignature === null) this.achievements.delete(k); // PG-R-08：未鑄造的成就刪除；已鑄造保留鏈上事實
    this.galleryHidden.add(wallet); // PG-R-09：停止藝廊展示（鏈上資料無法刪除）
    for (const [k, x] of this.pbs) if (x.wallet === wallet && ![...this.achievements.values()].some((a) => a.pbId === x.pbId)) this.pbs.delete(k); // PG-R-07：PB 一併刪除
    return { deferred: false, deletionDueAt: null, deleted: { snapshots: before - this.snapshots.length, attestations, claimResults, sessions } };
  }
}

function sortLeaderboard(rows: TournamentStepsRow[]) {
  return rows.sort(compareLeaderboard);
}

/** 藝廊排行：shoe_level DESC → xp DESC → wallet base58 位元組序（與 PostgreSQL 索引一致） */
/** PG-V-04 Lifetime 榜：歷史最高 → 收藏數 → XP → 錢包 C 序 */
function compareLifetime(a: GalleryPlayer, b: GalleryPlayer) {
  if (a.highestLevel !== b.highestLevel) return b.highestLevel - a.highestLevel;
  if (a.collectibleCount !== b.collectibleCount) return b.collectibleCount - a.collectibleCount;
  if (a.xp !== b.xp) return a.xp > b.xp ? -1 : 1;
  return a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0;
}
function compareGallery(a: GalleryPlayer, b: GalleryPlayer) {
  if (a.shoeLevel !== b.shoeLevel) return b.shoeLevel - a.shoeLevel;
  if (a.xp !== b.xp) return a.xp < b.xp ? 1 : -1;
  return Buffer.compare(Buffer.from(a.wallet, "ascii"), Buffer.from(b.wallet, "ascii"));
}
