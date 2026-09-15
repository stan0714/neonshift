import type pg from "pg";

import type { AttestationRow, AuditEntry, Challenge, ChainEventInput, ChainEventRow, ClaimResult, DeletionResult, Checkpoint, EventBenefit, EventParticipant, EventRedemption, FulfillOutcome, EventPatch, EventRole, EventRoleGrant, EventRow, EventRuleRevision, EventState, GalleryCollectible, GalleryPlayer, HealthSnapshotInput, HistoryItem, NfcTag, PartnerMembership, PartnerOrganization, Player, PurgeCounts, ReserveOutcome, ResultImport, ResultRevision, RiskDecisionInput, RuleSetRow, Achievement, PbDesired, PbRevision, Session, Store, TournamentStepsRow, WorkoutSession } from "./types.js";

type Row = Record<string, unknown>;

const toChallenge = (r: Row): Challenge => ({
  nonceHash: r.nonce_hash as Buffer,
  wallet: r.wallet as string,
  purpose: r.purpose as Challenge["purpose"],
  requestHash: (r.request_hash as Buffer | null) ?? null,
  taskDate: (r.task_date as number | null) ?? null,
  taskType: (r.task_type as number | null) ?? null,
  expiresAt: r.expires_at as Date,
  usedAt: (r.used_at as Date | null) ?? null,
});

const toSession = (r: Row): Session => ({
  jti: r.jti as string,
  familyId: r.family_id as string,
  wallet: r.wallet as string,
  refreshHash: r.refresh_hash as Buffer,
  expiresAt: r.expires_at as Date,
  usedAt: (r.used_at as Date | null) ?? null,
  rotatedTo: (r.rotated_to as string | null) ?? null,
  revokedAt: (r.revoked_at as Date | null) ?? null,
});

const toPlayer = (r: Row): Player => ({
  wallet: r.wallet as string,
  firstSeenAt: r.first_seen_at as Date,
  lastSeenAt: r.last_seen_at as Date,
  deletedAt: (r.deleted_at as Date | null) ?? null,
});

/** PostgreSQL 實作（SD 4.5）。所有一次性語意都靠單一 UPDATE … WHERE 的原子性，不做讀後寫。 */
export class PostgresStore implements Store {
  constructor(private readonly pool: pg.Pool) {}

  async insertChallenge(c: Challenge) {
    await this.pool.query(
      `INSERT INTO auth_challenges (nonce_hash, wallet, purpose, request_hash, task_date, task_type, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [c.nonceHash, c.wallet, c.purpose, c.requestHash, c.taskDate, c.taskType, c.expiresAt],
    );
  }
  async consumeChallenge(nonceHash: Buffer, now: Date) {
    const r = await this.pool.query(
      `UPDATE auth_challenges SET used_at = $2
       WHERE nonce_hash = $1 AND used_at IS NULL AND expires_at > $2
       RETURNING *`,
      [nonceHash, now],
    );
    return r.rows[0] ? toChallenge(r.rows[0] as Row) : null;
  }
  async upsertPlayer(wallet: string, now: Date) {
    const r = await this.pool.query(
      `INSERT INTO players (wallet, first_seen_at, last_seen_at) VALUES ($1, $2, $2)
       ON CONFLICT (wallet) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at, deleted_at = NULL, deletion_requested_at = NULL, deletion_due_at = NULL
       RETURNING *`,
      [wallet, now],
    );
    return toPlayer(r.rows[0] as Row);
  }
  async getPlayer(wallet: string) {
    const r = await this.pool.query(`SELECT * FROM players WHERE wallet = $1`, [wallet]);
    return r.rows[0] ? toPlayer(r.rows[0] as Row) : null;
  }
  async insertSession(s: Session) {
    await this.pool.query(
      `INSERT INTO auth_sessions (jti, family_id, wallet, refresh_hash, expires_at) VALUES ($1, $2, $3, $4, $5)`,
      [s.jti, s.familyId, s.wallet, s.refreshHash, s.expiresAt],
    );
  }
  async getSessionByRefreshHash(h: Buffer) {
    const r = await this.pool.query(`SELECT * FROM auth_sessions WHERE refresh_hash = $1`, [h]);
    return r.rows[0] ? toSession(r.rows[0] as Row) : null;
  }
  async getSession(jti: string) {
    const r = await this.pool.query(`SELECT * FROM auth_sessions WHERE jti = $1`, [jti]);
    return r.rows[0] ? toSession(r.rows[0] as Row) : null;
  }
  async rotateSession(jti: string, rotatedTo: string, now: Date) {
    await this.pool.query(`UPDATE auth_sessions SET used_at = $2, rotated_to = $3 WHERE jti = $1`, [jti, now, rotatedTo]);
  }
  async revokeFamily(familyId: string, now: Date) {
    const r = await this.pool.query(`UPDATE auth_sessions SET revoked_at = $2 WHERE family_id = $1 AND revoked_at IS NULL`, [familyId, now]);
    return r.rowCount ?? 0;
  }
  async revokeWallet(wallet: string, now: Date) {
    const r = await this.pool.query(`UPDATE auth_sessions SET revoked_at = $2 WHERE wallet = $1 AND revoked_at IS NULL`, [wallet, now]);
    return r.rowCount ?? 0;
  }

  // ---- PG-B-11 ----
  async ensureRuleSet(row: RuleSetRow) {
    const r = await this.pool.query(
      `INSERT INTO rule_sets (rules_version, rules_hash, config) VALUES ($1, $2, $3)
       ON CONFLICT (rules_version) DO NOTHING
       RETURNING rules_version`,
      [row.rulesVersion, row.rulesHash, JSON.stringify(row.config)],
    );
    if (r.rowCount === 0) {
      const cur = await this.pool.query(`SELECT rules_hash FROM rule_sets WHERE rules_version = $1`, [row.rulesVersion]);
      if (!(cur.rows[0]?.rules_hash as Buffer).equals(row.rulesHash)) throw new Error(`rules_version ${row.rulesVersion} already exists with a different hash`);
    }
  }
  async insertHealthSnapshot(s: HealthSnapshotInput) {
    const r = await this.pool.query(
      `INSERT INTO health_snapshots (wallet, task_date, task_type, attributed_steps, sleep_minutes, source_summary, step_rate_summary,
         sleep_overlap_minutes, sensor_summary, motion_summary, client_info, input_hash, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, COALESCE($13, now())) RETURNING id`,
      [s.wallet, s.taskDate, s.taskType, s.attributedSteps, s.sleepMinutes, JSON.stringify(s.sourceSummary), s.stepRateSummary === null ? null : JSON.stringify(s.stepRateSummary),
        s.sleepOverlapMinutes, s.sensorSummary === null ? null : JSON.stringify(s.sensorSummary), s.motionSummary === null ? null : JSON.stringify(s.motionSummary), JSON.stringify(s.clientInfo), s.inputHash, s.createdAt ?? null],
    );
    return Number((r.rows[0] as Row).id);
  }
  async insertRiskDecision(d: RiskDecisionInput) {
    await this.pool.query(
      `INSERT INTO risk_decisions (snapshot_id, rules_version, risk_score, matched_rules, decision, reject_code) VALUES ($1,$2,$3,$4,$5,$6)`,
      [d.snapshotId, d.rulesVersion, d.riskScore, d.matchedRules, d.decision, d.rejectCode],
    );
  }
  async insertAttestation(a: AttestationRow) {
    await this.pool.query(
      `INSERT INTO attestations (nonce, idempotency_key, request_hash, wallet, task_date, task_type, rules_version, evidence_hash, issued_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [a.nonce, a.idempotencyKey, a.requestHash, a.wallet, a.taskDate, a.taskType, a.rulesVersion, a.evidenceHash, a.issuedAt, a.expiresAt],
    );
  }
  async beginClaim(wallet: string, idempotencyKey: string, requestHash: Buffer, now: Date) {
    const ins = await this.pool.query(
      `INSERT INTO claim_results (wallet, idempotency_key, request_hash, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'processing', $4, $4)
       ON CONFLICT (wallet, idempotency_key) DO NOTHING
       RETURNING wallet`,
      [wallet, idempotencyKey, requestHash, now],
    );
    if ((ins.rowCount ?? 0) > 0) return { acquired: true as const, existing: null };
    const r = await this.pool.query(`SELECT * FROM claim_results WHERE wallet = $1 AND idempotency_key = $2`, [wallet, idempotencyKey]);
    const row = r.rows[0] as Row;
    const existing: ClaimResult = {
      wallet: row.wallet as string,
      idempotencyKey: row.idempotency_key as string,
      requestHash: row.request_hash as Buffer,
      status: row.status as ClaimResult["status"],
      httpStatus: (row.http_status as number | null) ?? null,
      response: row.response ?? null,
      createdAt: row.created_at as Date,
    };
    return { acquired: false as const, existing };
  }
  async completeClaim(wallet: string, idempotencyKey: string, status: "succeeded" | "rejected", httpStatus: number, response: unknown, now: Date) {
    await this.pool.query(
      `UPDATE claim_results SET status = $3, http_status = $4, response = $5, updated_at = $6 WHERE wallet = $1 AND idempotency_key = $2`,
      [wallet, idempotencyKey, status, httpStatus, JSON.stringify(response), now],
    );
  }
  async releaseClaim(wallet: string, idempotencyKey: string) {
    await this.pool.query(`DELETE FROM claim_results WHERE wallet = $1 AND idempotency_key = $2 AND status = 'processing'`, [wallet, idempotencyKey]);
  }

  // ---- PG-B-12／B-13 ----
  async listHistory(wallet: string, sinceTaskDate: number): Promise<HistoryItem[]> {
    const r = await this.pool.query(
      `SELECT task_date, task_type, issued_at, expires_at, redeemed_sig FROM attestations
       WHERE wallet = $1 AND task_date >= $2 ORDER BY task_date DESC, issued_at DESC`,
      [wallet, sinceTaskDate],
    );
    return (r.rows as Row[]).map((x) => ({
      taskDate: x.task_date as number,
      taskType: x.task_type as number,
      issuedAt: x.issued_at as Date,
      expiresAt: x.expires_at as Date,
      redeemedSig: (x.redeemed_sig as string | null) ?? null,
    }));
  }
  async hasActiveStakedTournament(_wallet: string) {
    // 質押事實在鏈上，由 TournamentService 判斷（player routes）
    return false;
  }

  // ---- PG-E-01 ----
  private orgRow(x: Row): PartnerOrganization {
    return { orgId: x.org_id as string, name: x.name as string, slug: x.slug as string, createdBy: x.created_by as string, createdAt: x.created_at as Date, suspendedAt: (x.suspended_at as Date | null) ?? null };
  }
  private membershipRow(x: Row): PartnerMembership {
    return { orgId: x.org_id as string, wallet: x.wallet as string, role: x.role as PartnerMembership["role"], grantedBy: x.granted_by as string, grantedAt: x.granted_at as Date, revokedAt: (x.revoked_at as Date | null) ?? null };
  }
  private partnerEventRow(x: Row): EventRow {
    return {
      eventId: x.event_id as string, orgId: x.org_id as string, slug: x.slug as string, title: x.title as string, description: x.description as string, state: x.state as EventState, timezone: x.timezone as string,
      registrationOpensAt: (x.registration_opens_at as Date | null) ?? null, registrationClosesAt: (x.registration_closes_at as Date | null) ?? null, startsAt: (x.starts_at as Date | null) ?? null, endsAt: (x.ends_at as Date | null) ?? null,
      purgedAt: (x.purged_at as Date | null) ?? null,
      capacity: Number(x.capacity), registrationCount: Number(x.registration_count), currentRuleRevision: (x.current_rule_revision as string | null) ?? null, tournamentAddress: (x.tournament_address as string | null) ?? null,
      revision: Number(x.revision), cancelReason: (x.cancel_reason as string | null) ?? null, createdBy: x.created_by as string, createdAt: x.created_at as Date, updatedAt: x.updated_at as Date, publishedAt: (x.published_at as Date | null) ?? null, cancelledAt: (x.cancelled_at as Date | null) ?? null,
    };
  }
  private ruleRow(x: Row): EventRuleRevision {
    return { revisionId: x.revision_id as string, eventId: x.event_id as string, version: Number(x.version), rules: x.rules, rulesHash: x.rules_hash as Buffer, createdBy: x.created_by as string, createdAt: x.created_at as Date, publishedAt: (x.published_at as Date | null) ?? null };
  }
  private roleRow(x: Row): EventRoleGrant {
    return { eventId: x.event_id as string, wallet: x.wallet as string, role: x.role as EventRole, checkpointId: (x.checkpoint_id as string | null) ?? null, grantedBy: x.granted_by as string, grantedAt: x.granted_at as Date, revokedAt: (x.revoked_at as Date | null) ?? null };
  }
  async createOrganization(o: Omit<PartnerOrganization, "createdAt" | "suspendedAt">, now: Date) {
    const r = await this.pool.query(`INSERT INTO partner_organizations (org_id, name, slug, created_by, created_at) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [o.orgId, o.name, o.slug, o.createdBy, now]);
    return this.orgRow(r.rows[0] as Row);
  }
  async getOrganization(orgId: string) {
    const r = await this.pool.query(`SELECT * FROM partner_organizations WHERE org_id = $1`, [orgId]);
    return r.rows[0] ? this.orgRow(r.rows[0] as Row) : null;
  }
  async getOrganizationBySlug(slug: string) {
    const r = await this.pool.query(`SELECT * FROM partner_organizations WHERE slug = $1`, [slug]);
    return r.rows[0] ? this.orgRow(r.rows[0] as Row) : null;
  }
  async upsertMembership(m: Omit<PartnerMembership, "grantedAt" | "revokedAt">, now: Date) {
    await this.pool.query(`INSERT INTO partner_memberships (org_id, wallet, role, granted_by, granted_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (org_id, wallet) DO UPDATE SET role = EXCLUDED.role, granted_by = EXCLUDED.granted_by, granted_at = EXCLUDED.granted_at, revoked_at = NULL`, [m.orgId, m.wallet, m.role, m.grantedBy, now]);
  }
  async revokeMembership(orgId: string, wallet: string, now: Date) {
    return ((await this.pool.query(`UPDATE partner_memberships SET revoked_at = $3 WHERE org_id = $1 AND wallet = $2 AND revoked_at IS NULL`, [orgId, wallet, now])).rowCount ?? 0) > 0;
  }
  async listMemberships(wallet: string) {
    const r = await this.pool.query(`SELECT m.* FROM partner_memberships m JOIN partner_organizations o ON o.org_id = m.org_id WHERE m.wallet = $1 AND m.revoked_at IS NULL AND o.suspended_at IS NULL`, [wallet]);
    return (r.rows as Row[]).map((x) => this.membershipRow(x));
  }
  async getMembership(orgId: string, wallet: string) {
    const r = await this.pool.query(`SELECT * FROM partner_memberships WHERE org_id = $1 AND wallet = $2`, [orgId, wallet]);
    return r.rows[0] ? this.membershipRow(r.rows[0] as Row) : null;
  }
  async createEvent(e: Parameters<Store["createEvent"]>[0], now: Date) {
    const r = await this.pool.query(
      `INSERT INTO events (event_id, org_id, slug, title, description, timezone, registration_opens_at, registration_closes_at, starts_at, ends_at, capacity, tournament_address, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14) RETURNING *`,
      [e.eventId, e.orgId, e.slug, e.title, e.description, e.timezone, e.registrationOpensAt, e.registrationClosesAt, e.startsAt, e.endsAt, e.capacity, e.tournamentAddress, e.createdBy, now],
    );
    return this.partnerEventRow(r.rows[0] as Row);
  }
  async getEvent(eventId: string) {
    const r = await this.pool.query(`SELECT * FROM events WHERE event_id = $1`, [eventId]);
    return r.rows[0] ? this.partnerEventRow(r.rows[0] as Row) : null;
  }
  async getEventBySlug(slug: string) {
    const r = await this.pool.query(`SELECT * FROM events WHERE slug = $1`, [slug]);
    return r.rows[0] ? this.partnerEventRow(r.rows[0] as Row) : null;
  }
  async updateEvent(eventId: string, expectedRevision: number, patch: EventPatch, now: Date) {
    const cols: Record<string, string> = { title: "title", description: "description", timezone: "timezone", registrationOpensAt: "registration_opens_at", registrationClosesAt: "registration_closes_at", startsAt: "starts_at", endsAt: "ends_at", capacity: "capacity", tournamentAddress: "tournament_address" };
    const sets: string[] = [];
    const args: unknown[] = [eventId, expectedRevision, now];
    for (const [k, col] of Object.entries(cols)) {
      if (k in patch) {
        args.push((patch as Record<string, unknown>)[k]);
        sets.push(`${col} = $${args.length}`);
      }
    }
    const r = await this.pool.query(`UPDATE events SET ${[...sets, "revision = revision + 1", "updated_at = $3"].join(", ")} WHERE event_id = $1 AND revision = $2 RETURNING *`, args);
    return r.rows[0] ? this.partnerEventRow(r.rows[0] as Row) : null;
  }
  async transitionEvent(eventId: string, from: EventState[], to: EventState, extra: { cancelReason?: string; currentRuleRevision?: string }, now: Date) {
    const r = await this.pool.query(
      `UPDATE events SET state = $3, revision = revision + 1, updated_at = $4,
         published_at = CASE WHEN $3 = 'published' THEN $4 ELSE published_at END,
         current_rule_revision = CASE WHEN $3 = 'published' AND $5::uuid IS NOT NULL THEN $5::uuid ELSE current_rule_revision END,
         cancelled_at = CASE WHEN $3 = 'cancelled' THEN $4 ELSE cancelled_at END,
         cancel_reason = CASE WHEN $3 = 'cancelled' THEN $6 ELSE cancel_reason END
       WHERE event_id = $1 AND state = ANY($2::text[]) RETURNING *`,
      [eventId, from, to, now, extra.currentRuleRevision ?? null, extra.cancelReason ?? null],
    );
    return r.rows[0] ? this.partnerEventRow(r.rows[0] as Row) : null;
  }
  async listPublishedEvents(limit: number, offset: number) {
    const r = await this.pool.query(`SELECT * FROM events WHERE state = 'published' ORDER BY starts_at ASC NULLS LAST LIMIT $1 OFFSET $2`, [limit, offset]);
    return (r.rows as Row[]).map((x) => this.partnerEventRow(x));
  }
  async listOrgEvents(orgId: string) {
    const r = await this.pool.query(`SELECT * FROM events WHERE org_id = $1 ORDER BY created_at DESC`, [orgId]);
    return (r.rows as Row[]).map((x) => this.partnerEventRow(x));
  }
  async addRuleRevision(rv: Omit<EventRuleRevision, "createdAt" | "publishedAt">, now: Date) {
    const r = await this.pool.query(`INSERT INTO event_rule_revisions (revision_id, event_id, version, rules, rules_hash, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [rv.revisionId, rv.eventId, rv.version, JSON.stringify(rv.rules), rv.rulesHash, rv.createdBy, now]);
    return this.ruleRow(r.rows[0] as Row);
  }
  async getRuleRevision(revisionId: string) {
    const r = await this.pool.query(`SELECT * FROM event_rule_revisions WHERE revision_id = $1`, [revisionId]);
    return r.rows[0] ? this.ruleRow(r.rows[0] as Row) : null;
  }
  async listRuleRevisions(eventId: string) {
    const r = await this.pool.query(`SELECT * FROM event_rule_revisions WHERE event_id = $1 ORDER BY version ASC`, [eventId]);
    return (r.rows as Row[]).map((x) => this.ruleRow(x));
  }
  async markRuleRevisionPublished(revisionId: string, now: Date) {
    await this.pool.query(`UPDATE event_rule_revisions SET published_at = COALESCE(published_at, $2) WHERE revision_id = $1`, [revisionId, now]);
  }
  async upsertEventRole(g: Omit<EventRoleGrant, "grantedAt" | "revokedAt">, now: Date) {
    await this.pool.query(`INSERT INTO event_roles (event_id, wallet, role, checkpoint_id, granted_by, granted_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (event_id, wallet, role) DO UPDATE SET checkpoint_id = EXCLUDED.checkpoint_id, granted_by = EXCLUDED.granted_by, granted_at = EXCLUDED.granted_at, revoked_at = NULL`, [g.eventId, g.wallet, g.role, g.checkpointId, g.grantedBy, now]);
  }
  async revokeEventRole(eventId: string, wallet: string, role: EventRole, now: Date) {
    return ((await this.pool.query(`UPDATE event_roles SET revoked_at = $4 WHERE event_id = $1 AND wallet = $2 AND role = $3 AND revoked_at IS NULL`, [eventId, wallet, role, now])).rowCount ?? 0) > 0;
  }
  async listEventRoles(eventId: string, wallet: string) {
    const r = await this.pool.query(`SELECT * FROM event_roles WHERE event_id = $1 AND wallet = $2 AND revoked_at IS NULL`, [eventId, wallet]);
    return (r.rows as Row[]).map((x) => this.roleRow(x));
  }
  async listEventRolesForWallet(wallet: string) {
    const r = await this.pool.query(`SELECT * FROM event_roles WHERE wallet = $1 AND revoked_at IS NULL`, [wallet]);
    return (r.rows as Row[]).map((x) => this.roleRow(x));
  }
  async appendAudit(entry: AuditEntry, now: Date) {
    await this.pool.query(`INSERT INTO event_audit_logs (event_id, org_id, actor_wallet, action, target, revision_id, request_id, details, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [entry.eventId, entry.orgId, entry.actorWallet, entry.action, entry.target, entry.revisionId, entry.requestId, JSON.stringify(entry.details ?? {}), now]);
  }
  async listAudit(eventId: string, limit: number) {
    const r = await this.pool.query(`SELECT * FROM event_audit_logs WHERE event_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`, [eventId, limit]);
    return (r.rows as Row[]).map((x) => ({ eventId: x.event_id as string | null, orgId: x.org_id as string | null, actorWallet: x.actor_wallet as string, action: x.action as string, target: (x.target as string | null) ?? null, revisionId: (x.revision_id as string | null) ?? null, requestId: (x.request_id as string | null) ?? null, details: x.details, createdAt: x.created_at as Date }));
  }

  // ---- PG-E-03 ----
  private participantRow(x: Row): EventParticipant {
    return { eventId: x.event_id as string, wallet: x.wallet as string, status: x.status as EventParticipant["status"], acceptedRuleRevision: x.accepted_rule_revision as string, displayName: (x.display_name as string | null) ?? null, publicConsentAt: (x.public_consent_at as Date | null) ?? null, registeredAt: x.registered_at as Date, cancelledAt: (x.cancelled_at as Date | null) ?? null, retentionDueAt: (x.retention_due_at as Date | null) ?? null };
  }
  async registerParticipant(p: { eventId: string; wallet: string; acceptedRuleRevision: string; displayName: string | null; publicConsent: boolean }, now: Date) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const ev = await client.query(`SELECT state, capacity, registration_count FROM events WHERE event_id = $1 FOR UPDATE`, [p.eventId]);
      const e = ev.rows[0] as Row | undefined;
      if (!e || e.state !== "published") { await client.query("ROLLBACK"); return "not_open" as const; }
      const cur = await client.query(`SELECT * FROM event_participants WHERE event_id = $1 AND wallet = $2 FOR UPDATE`, [p.eventId, p.wallet]);
      if (cur.rows[0] && (cur.rows[0] as Row).status !== "cancelled") { await client.query("ROLLBACK"); return "exists" as const; }
      if (Number(e.capacity) !== 0 && Number(e.registration_count) >= Number(e.capacity)) { await client.query("ROLLBACK"); return "full" as const; }
      await client.query(`UPDATE events SET registration_count = registration_count + 1 WHERE event_id = $1`, [p.eventId]);
      const r = await client.query(
        `INSERT INTO event_participants (event_id, wallet, status, accepted_rule_revision, display_name, public_consent_at, registered_at, cancelled_at)
         VALUES ($1,$2,'registered',$3,$4,$5,$6,NULL)
         ON CONFLICT (event_id, wallet) DO UPDATE SET status = 'registered', accepted_rule_revision = EXCLUDED.accepted_rule_revision, display_name = EXCLUDED.display_name, public_consent_at = EXCLUDED.public_consent_at, registered_at = EXCLUDED.registered_at, cancelled_at = NULL
         RETURNING *`,
        [p.eventId, p.wallet, p.acceptedRuleRevision, p.displayName, p.publicConsent ? now : null, now],
      );
      await client.query("COMMIT");
      return this.participantRow(r.rows[0] as Row);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  async listEventParticipants(eventId: string) {
    const r = await this.pool.query(`SELECT * FROM event_participants WHERE event_id = $1`, [eventId]);
    return (r.rows as Row[]).map((x) => this.participantRow(x));
  }
  async cancelRegistration(eventId: string, wallet: string, now: Date) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT 1 FROM events WHERE event_id = $1 FOR UPDATE`, [eventId]);
      const r = await client.query(`UPDATE event_participants SET status = 'cancelled', cancelled_at = $3 WHERE event_id = $1 AND wallet = $2 AND status <> 'cancelled' RETURNING *`, [eventId, wallet, now]);
      if (r.rows[0]) await client.query(`UPDATE events SET registration_count = GREATEST(0, registration_count - 1) WHERE event_id = $1`, [eventId]);
      await client.query("COMMIT");
      return r.rows[0] ? this.participantRow(r.rows[0] as Row) : null;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  async getParticipant(eventId: string, wallet: string) {
    const r = await this.pool.query(`SELECT * FROM event_participants WHERE event_id = $1 AND wallet = $2`, [eventId, wallet]);
    return r.rows[0] ? this.participantRow(r.rows[0] as Row) : null;
  }
  async listParticipations(wallet: string) {
    const r = await this.pool.query(`SELECT * FROM event_participants WHERE wallet = $1 ORDER BY registered_at DESC`, [wallet]);
    return (r.rows as Row[]).map((x) => this.participantRow(x));
  }
  async updateParticipantPrivacy(eventId: string, wallet: string, patch: { displayName?: string | null; publicConsent?: boolean }, now: Date) {
    const r = await this.pool.query(
      `UPDATE event_participants SET display_name = CASE WHEN $3::boolean THEN $4 ELSE display_name END, public_consent_at = CASE WHEN $5::boolean THEN (CASE WHEN $6::boolean THEN $7 ELSE NULL END) ELSE public_consent_at END WHERE event_id = $1 AND wallet = $2 RETURNING *`,
      [eventId, wallet, patch.displayName !== undefined, patch.displayName ?? null, patch.publicConsent !== undefined, patch.publicConsent ?? false, now],
    );
    return r.rows[0] ? this.participantRow(r.rows[0] as Row) : null;
  }
  async bumpCampaign(eventId: string, source: string, day: string, field: "views" | "registrations" | "checkins" | "redemptions") {
    await this.pool.query(`INSERT INTO campaign_aggregates (event_id, source, day, ${field}) VALUES ($1,$2,$3,1) ON CONFLICT (event_id, source, day) DO UPDATE SET ${field} = campaign_aggregates.${field} + 1`, [eventId, source, day]);
  }
  async listCampaign(eventId: string) {
    const r = await this.pool.query(`SELECT source, day::text AS day, views, registrations, checkins, redemptions FROM campaign_aggregates WHERE event_id = $1 ORDER BY day, source`, [eventId]);
    return (r.rows as Row[]).map((x) => ({ source: x.source as string, day: x.day as string, views: Number(x.views), registrations: Number(x.registrations), checkins: Number(x.checkins), redemptions: Number(x.redemptions) }));
  }

  // ---- PG-E-04 ----
  private tagRow(x: Row): NfcTag {
    return { tagId: x.tag_id as string, eventId: x.event_id as string, checkpointId: (x.checkpoint_id as string | null) ?? null, opaqueRef: x.opaque_ref as string, purpose: x.purpose as NfcTag["purpose"], participantWallet: (x.participant_wallet as string | null) ?? null, issuedBy: x.issued_by as string, issuedAt: x.issued_at as Date, revokedAt: (x.revoked_at as Date | null) ?? null };
  }
  async createCheckpoint(c: Checkpoint) {
    await this.pool.query(`INSERT INTO checkpoints (checkpoint_id, event_id, name, purpose) VALUES ($1,$2,$3,$4)`, [c.checkpointId, c.eventId, c.name, c.purpose]);
  }
  async listCheckpoints(eventId: string) {
    const r = await this.pool.query(`SELECT * FROM checkpoints WHERE event_id = $1 ORDER BY name`, [eventId]);
    return (r.rows as Row[]).map((x) => ({ checkpointId: x.checkpoint_id as string, eventId: x.event_id as string, name: x.name as string, purpose: x.purpose as Checkpoint["purpose"] }));
  }
  async getCheckpoint(eventId: string, checkpointId: string) {
    const r = await this.pool.query(`SELECT * FROM checkpoints WHERE event_id = $1 AND checkpoint_id = $2`, [eventId, checkpointId]);
    const x = r.rows[0] as Row | undefined;
    return x ? { checkpointId: x.checkpoint_id as string, eventId: x.event_id as string, name: x.name as string, purpose: x.purpose as Checkpoint["purpose"] } : null;
  }
  async createTag(t: Omit<NfcTag, "issuedAt" | "revokedAt">, now: Date) {
    await this.pool.query(`INSERT INTO nfc_tags (tag_id, event_id, checkpoint_id, opaque_ref, purpose, participant_wallet, issued_by, issued_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [t.tagId, t.eventId, t.checkpointId, t.opaqueRef, t.purpose, t.participantWallet, t.issuedBy, now]);
  }
  async getTagByRef(opaqueRef: string) {
    const r = await this.pool.query(`SELECT * FROM nfc_tags WHERE opaque_ref = $1`, [opaqueRef]);
    return r.rows[0] ? this.tagRow(r.rows[0] as Row) : null;
  }
  async listTags(eventId: string) {
    const r = await this.pool.query(`SELECT * FROM nfc_tags WHERE event_id = $1 ORDER BY issued_at`, [eventId]);
    return (r.rows as Row[]).map((x) => this.tagRow(x));
  }
  async revokeTag(eventId: string, tagId: string, now: Date) {
    return ((await this.pool.query(`UPDATE nfc_tags SET revoked_at = $3 WHERE event_id = $1 AND tag_id = $2 AND revoked_at IS NULL`, [eventId, tagId, now])).rowCount ?? 0) > 0;
  }

  // ---- PG-E-05 ----
  async insertCheckinChallenge(c: { challengeHash: Buffer; eventId: string; wallet: string; checkpointId: string; expiresAt: Date }) {
    await this.pool.query(`INSERT INTO checkin_challenges (challenge_hash, event_id, wallet, checkpoint_id, expires_at) VALUES ($1,$2,$3,$4,$5)`, [c.challengeHash, c.eventId, c.wallet, c.checkpointId, c.expiresAt]);
  }
  async consumeCheckinChallenge(challengeHash: Buffer, now: Date) {
    const r = await this.pool.query(`UPDATE checkin_challenges SET used_at = $2 WHERE challenge_hash = $1 AND used_at IS NULL AND expires_at > $2 RETURNING event_id, wallet, checkpoint_id`, [challengeHash, now]);
    const x = r.rows[0] as Row | undefined;
    return x ? { eventId: x.event_id as string, wallet: x.wallet as string, checkpointId: x.checkpoint_id as string } : null;
  }
  async insertCheckin(c: { eventId: string; wallet: string; checkpointId: string; confirmedBy: string; method: "nfc" | "qr" | "manual" }, now: Date) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const r = await client.query(`INSERT INTO event_checkins (event_id, wallet, checkpoint_id, confirmed_by, confirmed_at, method) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, [c.eventId, c.wallet, c.checkpointId, c.confirmedBy, now, c.method]);
      const inserted = (r.rowCount ?? 0) > 0;
      if (inserted) await client.query(`UPDATE event_participants SET status = 'checked_in' WHERE event_id = $1 AND wallet = $2 AND status = 'registered'`, [c.eventId, c.wallet]);
      await client.query("COMMIT");
      return inserted;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  async listCheckins(eventId: string, wallet?: string) {
    const r = await this.pool.query(`SELECT * FROM event_checkins WHERE event_id = $1 ${wallet ? "AND wallet = $2" : ""} ORDER BY confirmed_at DESC`, wallet ? [eventId, wallet] : [eventId]);
    return (r.rows as Row[]).map((x) => ({ eventId: x.event_id as string, wallet: x.wallet as string, checkpointId: x.checkpoint_id as string, confirmedBy: x.confirmed_by as string, confirmedAt: x.confirmed_at as Date, method: x.method as string }));
  }

  // ---- PG-E-06 ----
  private benefitRow(x: Row): EventBenefit {
    return { benefitId: x.benefit_id as string, eventId: x.event_id as string, kind: x.kind as EventBenefit["kind"], name: x.name as string, stockTotal: Number(x.stock_total), reservedCount: Number(x.reserved_count), fulfilledCount: Number(x.fulfilled_count), perPersonLimit: Number(x.per_person_limit), eligibilityRuleRevision: (x.eligibility_rule_revision as string | null) ?? null, requiresCheckin: Boolean(x.requires_checkin), claimDeadline: (x.claim_deadline as Date | null) ?? null };
  }
  private redemptionRow(x: Row): EventRedemption {
    return { redemptionId: x.redemption_id as string, eventId: x.event_id as string, wallet: x.wallet as string, benefitId: x.benefit_id as string, quantity: Number(x.quantity), status: x.status as EventRedemption["status"], reservedAt: x.reserved_at as Date, reservedUntil: x.reserved_until as Date, fulfilledBy: (x.fulfilled_by as string | null) ?? null, fulfilledAt: (x.fulfilled_at as Date | null) ?? null, idempotencyKey: x.idempotency_key as string, claimCode: (x.claim_code as string | null) ?? null, credentialId: (x.credential_id as string | null) ?? null };
  }
  private static readonly REDEMPTION_SELECT = `SELECT r.*, b.credential_id FROM event_redemptions r LEFT JOIN event_badge_issues b ON b.redemption_id = r.redemption_id`;
  async createBenefit(b: EventBenefit) {
    await this.pool.query(
      `INSERT INTO event_benefits (benefit_id, event_id, kind, name, stock_total, reserved_count, fulfilled_count, per_person_limit, eligibility_rule_revision, requires_checkin, claim_deadline) VALUES ($1,$2,$3,$4,$5,0,0,$6,$7,$8,$9)`,
      [b.benefitId, b.eventId, b.kind, b.name, b.stockTotal, b.perPersonLimit, b.eligibilityRuleRevision, b.requiresCheckin, b.claimDeadline],
    );
  }
  async listBenefits(eventId: string) {
    const r = await this.pool.query(`SELECT * FROM event_benefits WHERE event_id = $1 ORDER BY name`, [eventId]);
    return (r.rows as Row[]).map((x) => this.benefitRow(x));
  }
  async getBenefit(eventId: string, benefitId: string) {
    const r = await this.pool.query(`SELECT * FROM event_benefits WHERE event_id = $1 AND benefit_id = $2`, [eventId, benefitId]);
    return r.rows[0] ? this.benefitRow(r.rows[0] as Row) : null;
  }
  async reserveRedemption(r: { redemptionId: string; eventId: string; wallet: string; benefitId: string; quantity: number; idempotencyKey: string; claimCode: string; reservedUntil: Date; credentialId: string | null }, now: Date): Promise<ReserveOutcome> {
    await this.expireRedemptions(now);
    const client = await this.pool.connect();
    const bail = async (kind: Exclude<ReserveOutcome, { kind: "ok" }>["kind"]): Promise<ReserveOutcome> => { await client.query("ROLLBACK"); return { kind }; };
    try {
      await client.query("BEGIN");
      // 鎖順序固定：event → benefit → participant（取消活動與新預留鎖同一 event）
      const ev = await client.query(`SELECT state FROM events WHERE event_id = $1 FOR UPDATE`, [r.eventId]);
      const dup = await client.query(`${PostgresStore.REDEMPTION_SELECT} WHERE r.event_id = $1 AND r.wallet = $2 AND r.idempotency_key = $3`, [r.eventId, r.wallet, r.idempotencyKey]);
      if (dup.rows[0]) { await client.query("ROLLBACK"); return { kind: "ok", redemption: this.redemptionRow(dup.rows[0] as Row), created: false }; }
      if (!ev.rows[0] || (ev.rows[0] as Row).state !== "published") return bail("not_open");
      const bq = await client.query(`SELECT * FROM event_benefits WHERE event_id = $1 AND benefit_id = $2 FOR UPDATE`, [r.eventId, r.benefitId]);
      if (!bq.rows[0]) return bail("no_benefit");
      const b = this.benefitRow(bq.rows[0] as Row);
      const pq = await client.query(`SELECT status FROM event_participants WHERE event_id = $1 AND wallet = $2 FOR UPDATE`, [r.eventId, r.wallet]);
      const status = (pq.rows[0] as Row | undefined)?.status as string | undefined;
      if (!status || status === "cancelled") return bail("not_eligible");
      if (b.requiresCheckin && status !== "checked_in") return bail("checkin_required");
      if (b.claimDeadline && b.claimDeadline <= now) return bail("deadline_passed");
      const mine = await client.query(`SELECT COALESCE(SUM(quantity),0) AS n FROM event_redemptions WHERE event_id = $1 AND wallet = $2 AND benefit_id = $3 AND status IN ('reserved','fulfilled')`, [r.eventId, r.wallet, r.benefitId]);
      if (Number((mine.rows[0] as Row).n) + r.quantity > b.perPersonLimit) return bail("limit_reached");
      if (b.reservedCount + b.fulfilledCount + r.quantity > b.stockTotal) return bail("out_of_stock");
      const digital = b.kind === "digital_badge";
      await client.query(digital ? `UPDATE event_benefits SET fulfilled_count = fulfilled_count + $3 WHERE event_id = $1 AND benefit_id = $2` : `UPDATE event_benefits SET reserved_count = reserved_count + $3 WHERE event_id = $1 AND benefit_id = $2`, [r.eventId, r.benefitId, r.quantity]);
      await client.query(
        `INSERT INTO event_redemptions (redemption_id, event_id, wallet, benefit_id, quantity, status, reserved_at, reserved_until, fulfilled_by, fulfilled_at, idempotency_key, claim_code) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [r.redemptionId, r.eventId, r.wallet, r.benefitId, r.quantity, digital ? "fulfilled" : "reserved", now, r.reservedUntil, digital ? "system" : null, digital ? now : null, r.idempotencyKey, r.claimCode],
      );
      if (digital) await client.query(`INSERT INTO event_badge_issues (redemption_id, credential_id, issued_at) VALUES ($1,$2,$3)`, [r.redemptionId, r.credentialId, now]);
      const out = await client.query(`${PostgresStore.REDEMPTION_SELECT} WHERE r.redemption_id = $1`, [r.redemptionId]);
      await client.query("COMMIT");
      return { kind: "ok", redemption: this.redemptionRow(out.rows[0] as Row), created: true };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  async fulfillRedemption(eventId: string, key: { redemptionId?: string; claimCode?: string }, staffWallet: string, now: Date): Promise<FulfillOutcome> {
    await this.expireRedemptions(now);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const q = key.redemptionId
        ? await client.query(`SELECT * FROM event_redemptions WHERE event_id = $1 AND redemption_id = $2 FOR UPDATE`, [eventId, key.redemptionId])
        : await client.query(`SELECT * FROM event_redemptions WHERE event_id = $1 AND claim_code = $2 FOR UPDATE`, [eventId, key.claimCode ?? ""]);
      const row = q.rows[0] as Row | undefined;
      if (!row) { await client.query("ROLLBACK"); return { kind: "not_found" }; }
      const status = row.status as EventRedemption["status"];
      if (status === "fulfilled") {
        const cur = await client.query(`${PostgresStore.REDEMPTION_SELECT} WHERE r.redemption_id = $1`, [row.redemption_id]);
        await client.query("ROLLBACK");
        return { kind: "ok", redemption: this.redemptionRow(cur.rows[0] as Row), already: true };
      }
      if (status !== "reserved") { await client.query("ROLLBACK"); return { kind: status }; }
      await client.query(`UPDATE event_benefits SET reserved_count = reserved_count - $3, fulfilled_count = fulfilled_count + $3 WHERE event_id = $1 AND benefit_id = $2`, [eventId, row.benefit_id, row.quantity]);
      const upd = await client.query(`UPDATE event_redemptions SET status = 'fulfilled', fulfilled_by = $2, fulfilled_at = $3 WHERE redemption_id = $1 RETURNING *`, [row.redemption_id, staffWallet, now]);
      await client.query("COMMIT");
      return { kind: "ok", redemption: this.redemptionRow({ ...(upd.rows[0] as Row), credential_id: null }), already: false };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  private async releaseWhere(where: string, params: unknown[], to: "expired" | "cancelled") {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const rows = await client.query(`SELECT redemption_id, event_id, benefit_id, quantity FROM event_redemptions WHERE status = 'reserved' AND ${where} FOR UPDATE`, params);
      for (const x of rows.rows as Row[]) {
        await client.query(`UPDATE event_benefits SET reserved_count = GREATEST(0, reserved_count - $3) WHERE event_id = $1 AND benefit_id = $2`, [x.event_id, x.benefit_id, x.quantity]);
        await client.query(`UPDATE event_redemptions SET status = $2 WHERE redemption_id = $1`, [x.redemption_id, to]);
      }
      await client.query("COMMIT");
      return rows.rowCount ?? 0;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  async expireRedemptions(now: Date) {
    return this.releaseWhere(`reserved_until <= $1`, [now], "expired");
  }
  async releaseEventReservations(eventId: string, _now: Date) {
    return this.releaseWhere(`event_id = $1`, [eventId], "cancelled");
  }
  async listRedemptions(eventId: string, wallet?: string) {
    const r = await this.pool.query(`${PostgresStore.REDEMPTION_SELECT} WHERE r.event_id = $1 ${wallet ? "AND r.wallet = $2" : ""} ORDER BY r.reserved_at DESC`, wallet ? [eventId, wallet] : [eventId]);
    return (r.rows as Row[]).map((x) => this.redemptionRow(x));
  }
  async getRedemption(redemptionId: string) {
    const r = await this.pool.query(`${PostgresStore.REDEMPTION_SELECT} WHERE r.redemption_id = $1`, [redemptionId]);
    return r.rows[0] ? this.redemptionRow(r.rows[0] as Row) : null;
  }

  // ---- PG-E-07／E-08 ----
  private importRow(x: Row): ResultImport {
    const staged = (x.staged_rows as { rows?: ResultImport["stagedRows"]; errors?: ResultImport["errors"] }) ?? {};
    return { importId: x.import_id as string, eventId: x.event_id as string, sourceKind: x.source_kind as ResultImport["sourceKind"], fileHash: x.file_hash as Buffer, importVersion: Number(x.import_version), rowCount: Number(x.row_count), errorCount: Number(x.error_count), stagedRows: staged.rows ?? [], errors: staged.errors ?? [], createdBy: x.created_by as string, createdAt: x.created_at as Date, publishedAt: (x.published_at as Date | null) ?? null, publishedBy: (x.published_by as string | null) ?? null };
  }
  private revisionRow(x: Row): ResultRevision {
    return { revisionId: x.revision_id as string, eventId: x.event_id as string, importId: x.import_id as string, wallet: x.wallet as string, discipline: x.discipline as string, division: (x.division as string | null) ?? null, distanceM: Number(x.distance_m), elapsedMs: Number(x.elapsed_ms), rank: x.rank === null ? null : Number(x.rank), finishStatus: x.finish_status as ResultRevision["finishStatus"], previousRevisionId: (x.previous_revision_id as string | null) ?? null, reason: (x.reason as string | null) ?? null, publishedAt: x.published_at as Date };
  }
  async createResultImport(r: Omit<ResultImport, "importVersion" | "createdAt" | "publishedAt" | "publishedBy">, now: Date) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT 1 FROM events WHERE event_id = $1 FOR UPDATE`, [r.eventId]);
      const v = await client.query(`SELECT COALESCE(MAX(import_version), 0) + 1 AS v FROM result_imports WHERE event_id = $1`, [r.eventId]);
      const version = Number((v.rows[0] as Row).v);
      const out = await client.query(
        `INSERT INTO result_imports (import_id, event_id, source_kind, file_hash, import_version, row_count, error_count, staged_rows, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [r.importId, r.eventId, r.sourceKind, r.fileHash, version, r.rowCount, r.errorCount, JSON.stringify({ rows: r.stagedRows, errors: r.errors }), r.createdBy, now],
      );
      await client.query("COMMIT");
      return this.importRow(out.rows[0] as Row);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  async getResultImport(eventId: string, importId: string) {
    const r = await this.pool.query(`SELECT * FROM result_imports WHERE event_id = $1 AND import_id = $2`, [eventId, importId]);
    return r.rows[0] ? this.importRow(r.rows[0] as Row) : null;
  }
  async listResultImports(eventId: string) {
    const r = await this.pool.query(`SELECT * FROM result_imports WHERE event_id = $1 ORDER BY import_version DESC`, [eventId]);
    return (r.rows as Row[]).map((x) => this.importRow(x));
  }
  async publishResultImport(eventId: string, importId: string, publisher: string, reason: string | null, now: Date) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // 發布互斥：鎖 event，避免兩個 import 同時發布交錯 previous 鏈
      await client.query(`SELECT 1 FROM events WHERE event_id = $1 FOR UPDATE`, [eventId]);
      const q = await client.query(`SELECT * FROM result_imports WHERE event_id = $1 AND import_id = $2 FOR UPDATE`, [eventId, importId]);
      if (!q.rows[0]) { await client.query("ROLLBACK"); return "not_found" as const; }
      const imp = this.importRow(q.rows[0] as Row);
      if (imp.publishedAt) { await client.query("ROLLBACK"); return "already" as const; }
      if (imp.errorCount > 0) { await client.query("ROLLBACK"); return "has_errors" as const; }
      let corrections = 0;
      for (const row of imp.stagedRows) {
        const prev = await client.query(`SELECT r.revision_id FROM result_revisions r JOIN result_imports i ON i.import_id = r.import_id WHERE r.event_id = $1 AND r.wallet = $2 AND r.discipline = $3 ORDER BY r.published_at DESC, i.import_version DESC LIMIT 1`, [eventId, row.wallet, row.discipline]);
        const prevId = (prev.rows[0] as Row | undefined)?.revision_id as string | undefined;
        if (prevId) corrections += 1;
        await client.query(
          `INSERT INTO result_revisions (revision_id, event_id, import_id, wallet, discipline, division, distance_m, elapsed_ms, rank, finish_status, previous_revision_id, reason, published_at) VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [eventId, importId, row.wallet, row.discipline, row.division, row.distanceM, row.elapsedMs, row.rank, row.finishStatus, prevId ?? null, prevId ? reason : null, now],
        );
      }
      await client.query(`UPDATE result_imports SET published_at = $3, published_by = $4 WHERE event_id = $1 AND import_id = $2`, [eventId, importId, now, publisher]);
      await client.query("COMMIT");
      return { revisions: imp.stagedRows.length, corrections };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  async listCurrentResults(eventId: string) {
    const r = await this.pool.query(
      `SELECT DISTINCT ON (r.wallet, r.discipline) r.*, p.display_name, p.public_consent_at FROM result_revisions r
       JOIN event_participants p ON p.event_id = r.event_id AND p.wallet = r.wallet JOIN result_imports i ON i.import_id = r.import_id
       WHERE r.event_id = $1 ORDER BY r.wallet, r.discipline, r.published_at DESC, i.import_version DESC`,
      [eventId],
    );
    return (r.rows as Row[]).map((x) => ({ ...this.revisionRow(x), displayName: (x.display_name as string | null) ?? null, publicConsent: x.public_consent_at !== null }));
  }
  // ---- PG-E-09 ----
  /** 交易內刪除某活動（可選：某錢包）的個人層資料；呼叫方負責 BEGIN／COMMIT */
  private async wipeEventRows(client: pg.PoolClient, eventId: string, wallet: string | null) {
    const w = wallet ? " AND wallet = $2" : "";
    const params = wallet ? [eventId, wallet] : [eventId];
    // 未交付預留先釋放庫存，再刪核銷（badge_issues 依 FK 先刪）
    const reserved = await client.query(`SELECT benefit_id, quantity FROM event_redemptions WHERE event_id = $1 AND status = 'reserved'${w}`, params);
    for (const x of reserved.rows as Row[]) await client.query(`UPDATE event_benefits SET reserved_count = GREATEST(0, reserved_count - $3) WHERE event_id = $1 AND benefit_id = $2`, [eventId, x.benefit_id, x.quantity]);
    await client.query(`DELETE FROM event_badge_issues WHERE redemption_id IN (SELECT redemption_id FROM event_redemptions WHERE event_id = $1${w})`, params);
    const redemptions = (await client.query(`DELETE FROM event_redemptions WHERE event_id = $1${w}`, params)).rowCount ?? 0;
    const checkins = (await client.query(`DELETE FROM event_checkins WHERE event_id = $1${w}`, params)).rowCount ?? 0;
    await client.query(`DELETE FROM checkin_challenges WHERE event_id = $1${w}`, params);
    const results = (await client.query(`DELETE FROM result_revisions WHERE event_id = $1${w}`, params)).rowCount ?? 0;
    if (wallet) await client.query(`UPDATE result_imports SET staged_rows = jsonb_set(staged_rows, '{rows}', COALESCE((SELECT jsonb_agg(r) FROM jsonb_array_elements(staged_rows->'rows') r WHERE r->>'wallet' <> $2), '[]'::jsonb)) WHERE event_id = $1`, [eventId, wallet]);
    else await client.query(`UPDATE result_imports SET staged_rows = jsonb_set(staged_rows, '{rows}', '[]'::jsonb) WHERE event_id = $1`, [eventId]);
    await client.query(`DELETE FROM nfc_tags WHERE event_id = $1 AND participant_wallet IS NOT NULL${wallet ? " AND participant_wallet = $2" : ""}`, params);
    const participants = (await client.query(`DELETE FROM event_participants WHERE event_id = $1${w}`, params)).rowCount ?? 0;
    return { participants, checkins, redemptions, results };
  }
  async purgeEventData(cutoff: Date, now: Date) {
    const counts = { events: [] as string[], participants: 0, checkins: 0, redemptions: 0, results: 0 };
    const due = await this.pool.query(`SELECT event_id FROM events WHERE purged_at IS NULL AND COALESCE(cancelled_at, ends_at) < $1`, [cutoff]);
    for (const x of due.rows as Row[]) {
      const eventId = x.event_id as string;
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`SELECT 1 FROM events WHERE event_id = $1 FOR UPDATE`, [eventId]);
        const c = await this.wipeEventRows(client, eventId, null);
        await client.query(`UPDATE events SET purged_at = $2 WHERE event_id = $1`, [eventId, now]);
        await client.query("COMMIT");
        counts.events.push(eventId);
        counts.participants += c.participants; counts.checkins += c.checkins; counts.redemptions += c.redemptions; counts.results += c.results;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    }
    return counts;
  }
  async deleteWalletEventData(wallet: string, _now: Date) {
    const counts = { participants: 0, checkins: 0, redemptions: 0, results: 0 };
    const evs = await this.pool.query(`SELECT event_id FROM event_participants WHERE wallet = $1`, [wallet]);
    for (const x of evs.rows as Row[]) {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`SELECT 1 FROM events WHERE event_id = $1 FOR UPDATE`, [x.event_id]);
        const c = await this.wipeEventRows(client, x.event_id as string, wallet);
        await client.query("COMMIT");
        counts.participants += c.participants; counts.checkins += c.checkins; counts.redemptions += c.redemptions; counts.results += c.results;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    }
    return counts;
  }
  // ---- PG-R-01 ----
  private workoutRow(x: Row): WorkoutSession {
    const big = (v: unknown) => (v === null || v === undefined ? null : BigInt(v as string));
    return {
      sessionId: x.session_id as string, wallet: x.wallet as string, sport: x.sport as WorkoutSession["sport"], environment: x.environment as WorkoutSession["environment"], origin: x.origin as WorkoutSession["origin"],
      sourceId: x.source_id as string, externalRecordId: x.external_record_id as string, sourceRevision: Number(x.source_revision), startedAt: x.started_at as Date, endedAt: x.ended_at as Date, elapsedMs: BigInt(x.elapsed_ms as string), pausedMs: BigInt(x.paused_ms as string),
      status: x.status as WorkoutSession["status"], quality: x.quality as WorkoutSession["quality"], rulesVersion: Number(x.rules_version),
      distanceMm: big(x.distance_mm), distanceMethod: (x.distance_method as WorkoutSession["distanceMethod"]) ?? null, steps: x.steps === null ? null : Number(x.steps), activeEnergyMkcal: big(x.active_energy_mkcal), energyMethod: (x.energy_method as WorkoutSession["energyMethod"]) ?? null, totalEnergyMkcal: big(x.total_energy_mkcal), stepLengthMm: x.step_length_mm === null ? null : Number(x.step_length_mm),
      pbEligible: Boolean(x.pb_eligible), possibleDuplicateOf: (x.possible_duplicate_of as string | null) ?? null, reviewReasons: (x.review_reasons as string[]) ?? [], extras: (x.extras as Record<string, unknown>) ?? {}, requestHash: x.request_hash as Buffer, revision: Number(x.revision), importedAt: x.imported_at as Date, updatedAt: x.updated_at as Date, deletedAt: (x.deleted_at as Date | null) ?? null,
    };
  }
  private static readonly WORKOUT_COLS = "wallet, sport, environment, origin, source_id, external_record_id, source_revision, started_at, ended_at, elapsed_ms, paused_ms, status, quality, rules_version, distance_mm, distance_method, steps, active_energy_mkcal, energy_method, total_energy_mkcal, step_length_mm, pb_eligible, review_reasons, extras, request_hash";
  private workoutParams(w: Omit<WorkoutSession, "revision" | "importedAt" | "updatedAt" | "deletedAt" | "possibleDuplicateOf">) {
    return [w.wallet, w.sport, w.environment, w.origin, w.sourceId, w.externalRecordId, w.sourceRevision, w.startedAt, w.endedAt, w.elapsedMs.toString(), w.pausedMs.toString(), w.status, w.quality, w.rulesVersion, w.distanceMm?.toString() ?? null, w.distanceMethod, w.steps, w.activeEnergyMkcal?.toString() ?? null, w.energyMethod, w.totalEnergyMkcal?.toString() ?? null, w.stepLengthMm, w.pbEligible, JSON.stringify(w.reviewReasons), JSON.stringify(w.extras), w.requestHash];
  }
  async upsertWorkout(w: Omit<WorkoutSession, "revision" | "importedAt" | "updatedAt" | "deletedAt" | "possibleDuplicateOf">, now: Date) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // 同錢包序列化（跨來源重複判定需看同一時刻的其他紀錄）
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`workout:${w.wallet}`]);
      const cur = await client.query(`SELECT * FROM workout_sessions WHERE wallet = $1 AND origin = $2 AND external_record_id = $3 FOR UPDATE`, [w.wallet, w.origin, w.externalRecordId]);
      const existing = cur.rows[0] ? this.workoutRow(cur.rows[0] as Row) : null;
      const dupOf = async (selfId: string | null) => {
        const d = await client.query(
          `SELECT session_id FROM workout_sessions WHERE wallet = $1 AND deleted_at IS NULL AND origin <> $2 AND ($5::uuid IS NULL OR session_id <> $5)
             AND GREATEST(0, EXTRACT(EPOCH FROM (LEAST(ended_at, $4::timestamptz) - GREATEST(started_at, $3::timestamptz)))) >= 0.5 * LEAST(EXTRACT(EPOCH FROM (ended_at - started_at)), EXTRACT(EPOCH FROM ($4::timestamptz - $3::timestamptz)))
           ORDER BY imported_at LIMIT 1`,
          [w.wallet, w.origin, w.startedAt, w.endedAt, selfId],
        );
        return ((d.rows[0] as Row | undefined)?.session_id as string | undefined) ?? null;
      };
      if (existing) {
        if (existing.deletedAt && w.sourceRevision <= existing.sourceRevision) { await client.query("ROLLBACK"); return { outcome: "deleted" as const, session: existing }; }
        if (w.sourceRevision < existing.sourceRevision) { await client.query("ROLLBACK"); return { outcome: "stale" as const, session: existing }; }
        if (w.sourceRevision === existing.sourceRevision && !existing.deletedAt) { await client.query("ROLLBACK"); return { outcome: "same" as const, session: existing }; }
        const dup = await dupOf(existing.sessionId);
        const sets = PostgresStore.WORKOUT_COLS.split(", ").map((c, i) => `${c} = $${i + 3}`).join(", ");
        const r = await client.query(`UPDATE workout_sessions SET ${sets}, revision = revision + 1, updated_at = $2, deleted_at = NULL, possible_duplicate_of = $${PostgresStore.WORKOUT_COLS.split(", ").length + 3} WHERE session_id = $1 RETURNING *`, [existing.sessionId, now, ...this.workoutParams(w), dup]);
        await client.query("COMMIT");
        return { outcome: "superseded" as const, session: this.workoutRow(r.rows[0] as Row) };
      }
      const dup = await dupOf(null);
      const n = PostgresStore.WORKOUT_COLS.split(", ").length;
      const placeholders = Array.from({ length: n }, (_, i) => `$${i + 3}`).join(",");
      const r = await client.query(`INSERT INTO workout_sessions (session_id, imported_at, updated_at, ${PostgresStore.WORKOUT_COLS}, possible_duplicate_of) VALUES ($1,$2,$2,${placeholders},$${n + 3}) RETURNING *`, [w.sessionId, now, ...this.workoutParams(w), dup]);
      await client.query("COMMIT");
      return { outcome: "created" as const, session: this.workoutRow(r.rows[0] as Row) };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  async listWorkouts(wallet: string, limit: number, offset: number) {
    const r = await this.pool.query(`SELECT * FROM workout_sessions WHERE wallet = $1 AND deleted_at IS NULL ORDER BY started_at DESC LIMIT $2 OFFSET $3`, [wallet, limit, offset]);
    return (r.rows as Row[]).map((x) => this.workoutRow(x));
  }
  async getWorkout(wallet: string, sessionId: string) {
    const r = await this.pool.query(`SELECT * FROM workout_sessions WHERE wallet = $1 AND session_id = $2 AND deleted_at IS NULL`, [wallet, sessionId]);
    return r.rows[0] ? this.workoutRow(r.rows[0] as Row) : null;
  }
  async deleteWorkout(wallet: string, sessionId: string, now: Date) {
    const r = await this.pool.query(`UPDATE workout_sessions SET deleted_at = $3, status = 'deleted', updated_at = $3 WHERE wallet = $1 AND session_id = $2 AND deleted_at IS NULL`, [wallet, sessionId, now]);
    if ((r.rowCount ?? 0) > 0) await this.pool.query(`UPDATE workout_sessions SET possible_duplicate_of = NULL WHERE possible_duplicate_of = $1`, [sessionId]);
    return (r.rowCount ?? 0) > 0;
  }
  // ---- PG-R-07 ----
  private pbRow(x: Row): PbRevision {
    return { pbId: x.pb_id as string, wallet: x.wallet as string, discipline: x.discipline as string, category: x.category as string, environment: x.environment as string, verificationClass: x.verification_class as string, timingBasis: x.timing_basis as string, rulesMajor: Number(x.rules_major), value: BigInt(x.value as string), sourceKind: x.source_kind as PbRevision["sourceKind"], sourceId: x.source_id as string, sourceRevision: Number(x.source_revision), achievedAt: x.achieved_at as Date, status: x.status as PbRevision["status"], isBaseline: Boolean(x.is_baseline), previousPbId: (x.previous_pb_id as string | null) ?? null, createdAt: x.created_at as Date, invalidatedAt: (x.invalidated_at as Date | null) ?? null, reason: (x.reason as string | null) ?? null };
  }
  async listPbRevisions(wallet: string) {
    const r = await this.pool.query(`SELECT * FROM pb_revisions WHERE wallet = $1 ORDER BY category, achieved_at`, [wallet]);
    return (r.rows as Row[]).map((x) => this.pbRow(x));
  }
  async syncPbRevisions(wallet: string, desired: PbDesired[], now: Date) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`pb:${wallet}`]);
      const cur = (await client.query(`SELECT * FROM pb_revisions WHERE wallet = $1 FOR UPDATE`, [wallet])).rows as Row[];
      const idOf = (r: { discipline: string; category: string; environment: string; verificationClass: string; timingBasis: string; rulesMajor: number; sourceKind: string; sourceId: string }) => `${r.discipline}|${r.category}|${r.environment}|${r.verificationClass}|${r.timingBasis}|${r.rulesMajor}|${r.sourceKind}|${r.sourceId}`;
      const existing = new Map(cur.map((x) => this.pbRow(x)).map((p) => [idOf(p), p]));
      const seen = new Set<string>();
      // 先建立／更新（previous 需先有 pb_id：依 desired 順序，鏈內前一筆先處理）
      for (const d of desired) {
        const id = `${d.key}|${d.sourceKind}|${d.sourceId}`;
        seen.add(id);
        const prev = d.previousSourceId ? existing.get(`${d.key}|${d.sourceKind}|${d.previousSourceId}`) ?? [...existing.values()].find((p) => `${p.discipline}|${p.category}|${p.environment}|${p.verificationClass}|${p.timingBasis}|${p.rulesMajor}` === d.key && p.sourceId === d.previousSourceId) : null;
        const have = existing.get(id);
        if (have) {
          const r = await client.query(`UPDATE pb_revisions SET value = $2, source_revision = $3, achieved_at = $4, status = $5, is_baseline = $6, previous_pb_id = $7, invalidated_at = NULL, reason = NULL WHERE pb_id = $1 RETURNING *`, [have.pbId, d.value.toString(), d.sourceRevision, d.achievedAt, d.status, d.isBaseline, prev?.pbId ?? null]);
          existing.set(id, this.pbRow(r.rows[0] as Row));
        } else {
          const r = await client.query(
            `INSERT INTO pb_revisions (pb_id, wallet, discipline, category, environment, verification_class, timing_basis, rules_major, value, source_kind, source_id, source_revision, achieved_at, status, is_baseline, previous_pb_id, created_at) VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
            [wallet, d.discipline, d.category, d.environment, d.verificationClass, d.timingBasis, d.rulesMajor, d.value.toString(), d.sourceKind, d.sourceId, d.sourceRevision, d.achievedAt, d.status, d.isBaseline, prev?.pbId ?? null, now],
          );
          existing.set(id, this.pbRow(r.rows[0] as Row));
        }
      }
      for (const [id, p] of existing) if (!seen.has(id) && p.status !== "invalidated") await client.query(`UPDATE pb_revisions SET status = 'invalidated', invalidated_at = $2, reason = 'source_removed_or_corrected' WHERE pb_id = $1`, [p.pbId, now]);
      await client.query("COMMIT");
      return this.listPbRevisions(wallet);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  // ---- PG-R-08 ----
  private achievementRow(x: Row): Achievement {
    return { achievementId: x.achievement_id as string, wallet: x.wallet as string, pbId: x.pb_id as string, category: x.category as string, verificationClass: x.verification_class as Achievement["verificationClass"], sourceRevision: Number(x.source_revision), rulesMajor: Number(x.rules_major), publicConsent: Boolean(x.public_consent), metadata: x.metadata as Record<string, unknown>, metadataHash: x.metadata_hash as Buffer, status: x.status as Achievement["status"], registrySignature: (x.registry_signature as string | null) ?? null, registryUpdatedAt: (x.registry_updated_at as Date | null) ?? null, asset: (x.asset as string | null) ?? null, mintedSignature: (x.minted_signature as string | null) ?? null, mintedAt: (x.minted_at as Date | null) ?? null, createdAt: x.created_at as Date, updatedAt: x.updated_at as Date };
  }
  async upsertAchievement(a: Omit<Achievement, "createdAt" | "updatedAt">, now: Date) {
    const r = await this.pool.query(
      `INSERT INTO achievements (achievement_id, wallet, pb_id, category, verification_class, source_revision, rules_major, public_consent, metadata, metadata_hash, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)
       ON CONFLICT (achievement_id) DO UPDATE SET metadata = EXCLUDED.metadata, metadata_hash = EXCLUDED.metadata_hash, public_consent = EXCLUDED.public_consent, source_revision = EXCLUDED.source_revision, status = 'pending_registry', updated_at = EXCLUDED.updated_at
         WHERE achievements.status <> 'minted' AND achievements.metadata_hash <> EXCLUDED.metadata_hash
       RETURNING *`,
      [a.achievementId, a.wallet, a.pbId, a.category, a.verificationClass, a.sourceRevision, a.rulesMajor, a.publicConsent, JSON.stringify(a.metadata), a.metadataHash, a.status, now],
    );
    if (r.rows[0]) return this.achievementRow(r.rows[0] as Row);
    return (await this.getAchievement(a.achievementId))!;
  }
  async getAchievement(achievementId: string) {
    const r = await this.pool.query(`SELECT * FROM achievements WHERE achievement_id = $1`, [achievementId]);
    return r.rows[0] ? this.achievementRow(r.rows[0] as Row) : null;
  }
  async getAchievementByPb(pbId: string) {
    const r = await this.pool.query(`SELECT * FROM achievements WHERE pb_id = $1`, [pbId]);
    return r.rows[0] ? this.achievementRow(r.rows[0] as Row) : null;
  }
  async listAchievements(wallet: string) {
    const r = await this.pool.query(`SELECT * FROM achievements WHERE wallet = $1 ORDER BY created_at DESC`, [wallet]);
    return (r.rows as Row[]).map((x) => this.achievementRow(x));
  }
  async listAchievementsByStatus(status: Achievement["status"][], limit: number) {
    const r = await this.pool.query(`SELECT * FROM achievements WHERE status = ANY($1) ORDER BY updated_at LIMIT $2`, [status, limit]);
    return (r.rows as Row[]).map((x) => this.achievementRow(x));
  }
  async setAchievementStatus(achievementId: string, status: Achievement["status"], extra: { registrySignature?: string; asset?: string; mintedSignature?: string }, now: Date) {
    const r = await this.pool.query(
      `UPDATE achievements SET status = $2, updated_at = $3,
         registry_signature = COALESCE($4, registry_signature), registry_updated_at = CASE WHEN $4 IS NULL THEN registry_updated_at ELSE $3 END,
         asset = COALESCE($5, asset), minted_signature = COALESCE($6, minted_signature), minted_at = CASE WHEN $6 IS NULL THEN minted_at ELSE $3 END
       WHERE achievement_id = $1 RETURNING *`,
      [achievementId, status, now, extra.registrySignature ?? null, extra.asset ?? null, extra.mintedSignature ?? null],
    );
    return r.rows[0] ? this.achievementRow(r.rows[0] as Row) : null;
  }
  async listCurrentResultsForWallet(wallet: string) {
    const r = await this.pool.query(`SELECT DISTINCT ON (r.event_id, r.discipline) r.* FROM result_revisions r JOIN result_imports i ON i.import_id = r.import_id WHERE r.wallet = $1 ORDER BY r.event_id, r.discipline, r.published_at DESC, i.import_version DESC`, [wallet]);
    return (r.rows as Row[]).map((x) => this.revisionRow(x));
  }
  async listResultHistory(eventId: string, wallet: string) {
    const r = await this.pool.query(`SELECT r.* FROM result_revisions r JOIN result_imports i ON i.import_id = r.import_id WHERE r.event_id = $1 AND r.wallet = $2 ORDER BY r.published_at DESC, i.import_version DESC`, [eventId, wallet]);
    return (r.rows as Row[]).map((x) => this.revisionRow(x));
  }

  // ---- PG-G-01 ----
  private galleryRow(x: Row): GalleryPlayer {
    return { wallet: x.wallet as string, shoeLevel: Number(x.shoe_level), coreLevel: Number(x.core_level), xp: BigInt(x.xp as string), streakDays: Number(x.streak_days), maxStreakDays: Number(x.max_streak_days), lastTaskDate: x.last_task_date === null ? null : Number(x.last_task_date), collectibleCount: Number(x.collectible_count), updatedSlot: Number(x.updated_slot), updatedAt: x.updated_at as Date };
  }
  private collectibleRow(x: Row): GalleryCollectible {
    return { wallet: x.wallet as string, kind: Number(x.kind), asset: x.asset as string, signature: x.signature as string, slot: Number(x.slot), claimedAt: x.claimed_at as Date };
  }
  async upsertGalleryPlayer(p: { wallet: string; shoeLevel: number; coreLevel: number; xp: bigint; streakDays: number; maxStreakDays: number; lastTaskDate: number | null; slot: number }, now: Date) {
    await this.pool.query(
      `INSERT INTO gallery_players (wallet, shoe_level, core_level, xp, streak_days, max_streak_days, last_task_date, first_seen_slot, updated_slot, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9)
       ON CONFLICT (wallet) DO UPDATE SET shoe_level = EXCLUDED.shoe_level, core_level = EXCLUDED.core_level, xp = EXCLUDED.xp, streak_days = EXCLUDED.streak_days,
         max_streak_days = EXCLUDED.max_streak_days, last_task_date = EXCLUDED.last_task_date, updated_slot = EXCLUDED.updated_slot, updated_at = EXCLUDED.updated_at
       WHERE gallery_players.updated_slot <= EXCLUDED.updated_slot`,
      [p.wallet, p.shoeLevel, p.coreLevel, p.xp.toString(), p.streakDays, p.maxStreakDays, p.lastTaskDate, p.slot, now],
    );
  }
  async insertGalleryCollectible(c: GalleryCollectible) {
    const r = await this.pool.query(`INSERT INTO gallery_collectibles (wallet, kind, asset, signature, slot, claimed_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (wallet, kind) DO NOTHING`, [c.wallet, c.kind, c.asset, c.signature, c.slot, c.claimedAt]);
    if ((r.rowCount ?? 0) === 0) return false;
    await this.pool.query(`UPDATE gallery_players SET collectible_count = collectible_count + 1 WHERE wallet = $1`, [c.wallet]);
    return true;
  }
  async getGalleryPlayer(wallet: string) {
    const r = await this.pool.query(`SELECT * FROM gallery_players WHERE wallet = $1`, [wallet]);
    return r.rows[0] ? this.galleryRow(r.rows[0] as Row) : null;
  }
  private static readonly GALLERY_VISIBLE = `NOT EXISTS (SELECT 1 FROM gallery_prefs gp WHERE gp.wallet = gallery_players.wallet AND gp.hidden)`;
  async listGalleryPlayers(limit: number, offset: number) {
    const r = await this.pool.query(`SELECT * FROM gallery_players WHERE ${PostgresStore.GALLERY_VISIBLE} ORDER BY shoe_level DESC, xp DESC, wallet COLLATE "C" ASC LIMIT $1 OFFSET $2`, [limit, offset]);
    return (r.rows as Row[]).map((x) => this.galleryRow(x));
  }
  async countGalleryPlayers() {
    return ((await this.pool.query(`SELECT count(*)::int AS n FROM gallery_players WHERE ${PostgresStore.GALLERY_VISIBLE}`)).rows[0] as { n: number }).n;
  }
  async galleryRankOf(wallet: string) {
    const r = await this.pool.query(`SELECT rank FROM (SELECT wallet, row_number() OVER (ORDER BY shoe_level DESC, xp DESC, wallet COLLATE "C" ASC) AS rank FROM gallery_players WHERE ${PostgresStore.GALLERY_VISIBLE}) t WHERE wallet = $1`, [wallet]);
    return r.rows[0] ? Number((r.rows[0] as { rank: string | number }).rank) : null;
  }
  async searchGalleryPlayers(prefix: string, limit: number) {
    const r = await this.pool.query(`SELECT * FROM gallery_players WHERE wallet LIKE $1 || '%' AND ${PostgresStore.GALLERY_VISIBLE} ORDER BY shoe_level DESC, xp DESC, wallet COLLATE "C" ASC LIMIT $2`, [prefix.replace(/[%_\\]/g, ""), limit]);
    return (r.rows as Row[]).map((x) => this.galleryRow(x));
  }
  async setGalleryHidden(wallet: string, hidden: boolean, now: Date) {
    await this.pool.query(`INSERT INTO gallery_prefs (wallet, hidden, updated_at) VALUES ($1,$2,$3) ON CONFLICT (wallet) DO UPDATE SET hidden = EXCLUDED.hidden, updated_at = EXCLUDED.updated_at`, [wallet, hidden, now]);
  }
  async isGalleryHidden(wallet: string) {
    const r = await this.pool.query(`SELECT hidden FROM gallery_prefs WHERE wallet = $1`, [wallet]);
    return Boolean((r.rows[0] as { hidden?: boolean } | undefined)?.hidden);
  }
  async getAchievementByAsset(asset: string) {
    const r = await this.pool.query(`SELECT * FROM achievements WHERE asset = $1`, [asset]);
    return r.rows[0] ? this.achievementRow(r.rows[0] as Row) : null;
  }
  async listGalleryCollectibles(wallet: string) {
    const r = await this.pool.query(`SELECT * FROM gallery_collectibles WHERE wallet = $1 ORDER BY kind ASC`, [wallet]);
    return (r.rows as Row[]).map((x) => this.collectibleRow(x));
  }

  async familyFirstExpiresAt(familyId: string) {
    const r = await this.pool.query(`SELECT min(expires_at) AS t FROM auth_sessions WHERE family_id = $1`, [familyId]);
    const t = (r.rows[0] as { t: Date | null } | undefined)?.t ?? null;
    return t;
  }

  // ---- PG-B-17 ----
  async purgeExpired(cutoff: Date, now: Date): Promise<PurgeCounts> {
    const n = async (sql: string, args: unknown[]) => (await this.pool.query(sql, args)).rowCount ?? 0;
    return {
      snapshots: await n(`DELETE FROM health_snapshots WHERE created_at < $1`, [cutoff]), // risk_decisions CASCADE
      attestations: await n(`DELETE FROM attestations WHERE issued_at < $1`, [cutoff]),
      claimResults: await n(`DELETE FROM claim_results WHERE created_at < $1`, [cutoff]),
      tournamentSteps: await n(`DELETE FROM tournament_steps WHERE updated_at < $1`, [cutoff]),
      challenges: await n(`DELETE FROM auth_challenges WHERE expires_at < $1`, [now]),
      sessions: await n(`DELETE FROM auth_sessions WHERE expires_at < $1 OR revoked_at < $2`, [now, cutoff]),
    };
  }
  async listDueDeletions(now: Date) {
    const r = await this.pool.query(`SELECT wallet FROM players WHERE deleted_at IS NOT NULL AND deletion_due_at IS NOT NULL AND deletion_due_at <= $1`, [now]);
    return (r.rows as Row[]).map((x) => x.wallet as string);
  }
  async markDeletionDone(wallet: string) {
    await this.pool.query(`UPDATE players SET deletion_due_at = NULL WHERE wallet = $1`, [wallet]);
  }

  // ---- PG-B-16 ----
  private eventRow(x: Row): ChainEventRow {
    return { signature: x.signature as string, eventIndex: x.event_index as number, slot: Number(x.slot), blockhash: x.blockhash as string, commitment: x.commitment as "confirmed" | "finalized", eventName: x.event_name as string, payload: x.payload as Record<string, unknown>, orphanedAt: (x.orphaned_at as Date | null) ?? null, ingestedAt: x.ingested_at as Date };
  }
  async getCursor(name: string) {
    const r = await this.pool.query(`SELECT signature, slot FROM chain_cursor WHERE name = $1`, [name]);
    return r.rows[0] ? { signature: (r.rows[0] as Row).signature as string, slot: Number((r.rows[0] as Row).slot) } : null;
  }
  async setCursor(name: string, signature: string, slot: number) {
    await this.pool.query(`INSERT INTO chain_cursor (name, signature, slot, updated_at) VALUES ($1, $2, $3, now()) ON CONFLICT (name) DO UPDATE SET signature = EXCLUDED.signature, slot = EXCLUDED.slot, updated_at = now()`, [name, signature, slot]);
  }
  async insertChainEvent(e: ChainEventInput, now: Date) {
    await this.pool.query(
      `INSERT INTO chain_events (signature, event_index, slot, blockhash, commitment, event_name, payload, ingested_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (signature, event_index) DO NOTHING`,
      [e.signature, e.eventIndex, e.slot, e.blockhash, e.commitment, e.eventName, JSON.stringify(e.payload), now],
    );
  }
  async listPendingChainEvents(limit: number) {
    const r = await this.pool.query(`SELECT * FROM chain_events WHERE commitment = 'confirmed' AND orphaned_at IS NULL ORDER BY slot ASC, event_index ASC LIMIT $1`, [limit]);
    return (r.rows as Row[]).map((x) => this.eventRow(x));
  }
  async finalizeChainEvent(signature: string, eventIndex: number) {
    await this.pool.query(`UPDATE chain_events SET commitment = 'finalized' WHERE signature = $1 AND event_index = $2`, [signature, eventIndex]);
  }
  async markChainEventOrphaned(signature: string, eventIndex: number, now: Date) {
    await this.pool.query(`UPDATE chain_events SET orphaned_at = $3 WHERE signature = $1 AND event_index = $2`, [signature, eventIndex, now]);
  }
  async listChainEvents(filter: { eventName?: string; wallet?: string; finalizedOnly?: boolean }, limit: number) {
    const conds: string[] = [];
    const args: unknown[] = [];
    if (filter.eventName) { args.push(filter.eventName); conds.push(`event_name = $${args.length}`); }
    if (filter.wallet) { args.push(filter.wallet); conds.push(`payload->>'wallet' = $${args.length}`); }
    if (filter.finalizedOnly) conds.push(`commitment = 'finalized' AND orphaned_at IS NULL`);
    args.push(limit);
    const r = await this.pool.query(`SELECT * FROM chain_events ${conds.length ? "WHERE " + conds.join(" AND ") : ""} ORDER BY slot DESC, event_index DESC LIMIT $${args.length}`, args);
    return (r.rows as Row[]).map((x) => this.eventRow(x));
  }
  async backfillRedeemedSig(nonce: Buffer, signature: string) {
    const r = await this.pool.query(`UPDATE attestations SET redeemed_sig = $2 WHERE nonce = $1 AND redeemed_sig IS NULL`, [nonce, signature]);
    return (r.rowCount ?? 0) > 0;
  }

  // ---- PG-B-14 ----
  private stepsRow(x: Row): TournamentStepsRow {
    return { weekId: x.week_id as number, wallet: x.wallet as string, verifiedSteps: Number(x.verified_steps), firstReachedAt: (x.first_reached_at as Date | null) ?? null, updatedAt: x.updated_at as Date };
  }
  async getTournamentSteps(weekId: number, wallet: string) {
    const r = await this.pool.query(`SELECT * FROM tournament_steps WHERE week_id = $1 AND wallet = $2`, [weekId, wallet]);
    return r.rows[0] ? this.stepsRow(r.rows[0] as Row) : null;
  }
  async upsertTournamentSteps(weekId: number, wallet: string, verifiedSteps: number, reachedAt: Date, now: Date) {
    // 單調不減：只有更大才更新（DO UPDATE 的 WHERE 條件）；未變更時 RETURNING 為空，再讀既有 row
    const r = await this.pool.query(
      `INSERT INTO tournament_steps (week_id, wallet, verified_steps, first_reached_at, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (week_id, wallet) DO UPDATE
         SET verified_steps = EXCLUDED.verified_steps, first_reached_at = EXCLUDED.first_reached_at, updated_at = EXCLUDED.updated_at
         WHERE tournament_steps.verified_steps < EXCLUDED.verified_steps
       RETURNING *`,
      [weekId, wallet, verifiedSteps, reachedAt, now],
    );
    if (r.rows[0]) return { row: this.stepsRow(r.rows[0] as Row), changed: true };
    return { row: (await this.getTournamentSteps(weekId, wallet))!, changed: false };
  }
  async listTournamentSteps(weekId: number, limit: number) {
    const r = await this.pool.query(
      `SELECT * FROM tournament_steps WHERE week_id = $1
       ORDER BY verified_steps DESC, first_reached_at ASC NULLS LAST, wallet COLLATE "C" ASC LIMIT $2`,
      [weekId, limit],
    );
    return (r.rows as Row[]).map((x) => this.stepsRow(x));
  }
  async countTournamentSteps(weekId: number) {
    const r = await this.pool.query(`SELECT count(*)::int AS n FROM tournament_steps WHERE week_id = $1`, [weekId]);
    return (r.rows[0] as { n: number }).n;
  }
  async rankOf(weekId: number, wallet: string) {
    const r = await this.pool.query(
      `SELECT rank FROM (
         SELECT wallet, row_number() OVER (ORDER BY verified_steps DESC, first_reached_at ASC NULLS LAST, wallet COLLATE "C" ASC) AS rank
         FROM tournament_steps WHERE week_id = $1
       ) t WHERE wallet = $2`,
      [weekId, wallet],
    );
    return r.rows[0] ? Number((r.rows[0] as { rank: string | number }).rank) : null;
  }
  async deletePlayerData(wallet: string, now: Date, deferUntil: Date | null): Promise<DeletionResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const sess = await client.query(`UPDATE auth_sessions SET revoked_at = $2 WHERE wallet = $1 AND revoked_at IS NULL`, [wallet, now]);
      await client.query(
        `UPDATE players SET deleted_at = COALESCE(deleted_at, $2), deletion_requested_at = COALESCE(deletion_requested_at, $2), deletion_due_at = $3 WHERE wallet = $1`,
        [wallet, now, deferUntil],
      );
      let snapshots = 0;
      let attestations = 0;
      let claimResults = 0;
      if (!deferUntil) {
        // risk_decisions 以 CASCADE 隨 snapshot 刪除
        snapshots = (await client.query(`DELETE FROM health_snapshots WHERE wallet = $1`, [wallet])).rowCount ?? 0;
        attestations = (await client.query(`DELETE FROM attestations WHERE wallet = $1`, [wallet])).rowCount ?? 0;
        claimResults = (await client.query(`DELETE FROM claim_results WHERE wallet = $1`, [wallet])).rowCount ?? 0;
        await client.query(`DELETE FROM tournament_steps WHERE wallet = $1`, [wallet]);
        await client.query(`UPDATE workout_sessions SET possible_duplicate_of = NULL WHERE wallet = $1`, [wallet]);
        await client.query(`DELETE FROM workout_sessions WHERE wallet = $1`, [wallet]); // PG-R-01：運動摘要一併刪除
        await client.query(`DELETE FROM achievements WHERE wallet = $1 AND minted_signature IS NULL`, [wallet]); // PG-R-08：未鑄造刪除；已鑄造保留鏈上事實
        await client.query(`INSERT INTO gallery_prefs (wallet, hidden, updated_at) VALUES ($1, true, $2) ON CONFLICT (wallet) DO UPDATE SET hidden = true, updated_at = EXCLUDED.updated_at`, [wallet, now]); // PG-R-09：停止藝廊展示
        await client.query(`UPDATE pb_revisions SET previous_pb_id = NULL WHERE wallet = $1`, [wallet]);
        await client.query(`DELETE FROM pb_revisions WHERE wallet = $1 AND pb_id NOT IN (SELECT pb_id FROM achievements WHERE wallet = $1)`, [wallet]); // PG-R-07：PB 一併刪除（已鑄造成就的 PB 列保留）
      }
      await client.query("COMMIT");
      if (!deferUntil) await this.deleteWalletEventData(wallet, now); // BR-32：活動個人層資料一併刪除（各活動獨立交易）
      return { deferred: deferUntil !== null, deletionDueAt: deferUntil, deleted: { snapshots, attestations, claimResults, sessions: sess.rowCount ?? 0 } };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
}
