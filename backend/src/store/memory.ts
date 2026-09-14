import { compareLeaderboard } from "./leaderboard.js";
import type { AttestationRow, AuditEntry, Challenge, ChainCursor, ChainEventInput, ChainEventRow, ClaimResult, DeletionResult, Checkpoint, EventBenefit, EventParticipant, EventRedemption, FulfillOutcome, EventPatch, EventRole, EventRoleGrant, EventRow, EventRuleRevision, EventState, GalleryCollectible, GalleryPlayer, HealthSnapshotInput, HistoryItem, NfcTag, PartnerMembership, PartnerOrganization, Player, PurgeCounts, ReserveOutcome, RiskDecisionInput, RuleSetRow, Session, Store, TournamentStepsRow } from "./types.js";

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
  async registerParticipant(p: { eventId: string; wallet: string; acceptedRuleRevision: string; displayName: string | null; publicConsent: boolean }, now: Date) {
    const e = this.events.get(p.eventId);
    if (!e || e.state !== "published") return "not_open" as const;
    const k = `${p.eventId}:${p.wallet}`;
    const cur = this.participants.get(k);
    if (cur && cur.status !== "cancelled") return "exists" as const;
    if (e.capacity !== 0 && e.registrationCount >= e.capacity) return "full" as const;
    e.registrationCount += 1;
    const row: EventParticipant = { eventId: p.eventId, wallet: p.wallet, status: "registered", acceptedRuleRevision: p.acceptedRuleRevision, displayName: p.displayName, publicConsentAt: p.publicConsent ? now : null, registeredAt: now, cancelledAt: null, retentionDueAt: null };
    this.participants.set(k, row);
    return row;
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

  // ---- PG-G-01 ----
  private galleryRanked() {
    return [...this.galleryPlayers.values()].sort(compareGallery);
  }
  async upsertGalleryPlayer(p: { wallet: string; shoeLevel: number; coreLevel: number; xp: bigint; streakDays: number; maxStreakDays: number; lastTaskDate: number | null; slot: number }, now: Date) {
    const cur = this.galleryPlayers.get(p.wallet);
    if (cur && cur.updatedSlot > p.slot) return;
    this.galleryPlayers.set(p.wallet, { wallet: p.wallet, shoeLevel: p.shoeLevel, coreLevel: p.coreLevel, xp: p.xp, streakDays: p.streakDays, maxStreakDays: p.maxStreakDays, lastTaskDate: p.lastTaskDate, collectibleCount: cur?.collectibleCount ?? 0, updatedSlot: p.slot, updatedAt: now });
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
  async listGalleryPlayers(limit: number, offset: number) {
    return this.galleryRanked().slice(offset, offset + limit);
  }
  async countGalleryPlayers() {
    return this.galleryPlayers.size;
  }
  async galleryRankOf(wallet: string) {
    const i = this.galleryRanked().findIndex((p) => p.wallet === wallet);
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
  async deletePlayerData(wallet: string, now: Date, deferUntil: Date | null): Promise<DeletionResult> {
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
    return { deferred: false, deletionDueAt: null, deleted: { snapshots: before - this.snapshots.length, attestations, claimResults, sessions } };
  }
}

function sortLeaderboard(rows: TournamentStepsRow[]) {
  return rows.sort(compareLeaderboard);
}

/** 藝廊排行：shoe_level DESC → xp DESC → wallet base58 位元組序（與 PostgreSQL 索引一致） */
function compareGallery(a: GalleryPlayer, b: GalleryPlayer) {
  if (a.shoeLevel !== b.shoeLevel) return b.shoeLevel - a.shoeLevel;
  if (a.xp !== b.xp) return a.xp < b.xp ? 1 : -1;
  return Buffer.compare(Buffer.from(a.wallet, "ascii"), Buffer.from(b.wallet, "ascii"));
}
