import type pg from "pg";

import type { AttestationRow, Challenge, ChainEventInput, ChainEventRow, ClaimResult, DeletionResult, HealthSnapshotInput, HistoryItem, Player, PurgeCounts, RiskDecisionInput, RuleSetRow, Session, Store, TournamentStepsRow } from "./types.js";

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
      }
      await client.query("COMMIT");
      return { deferred: deferUntil !== null, deletionDueAt: deferUntil, deleted: { snapshots, attestations, claimResults, sessions: sess.rowCount ?? 0 } };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
}
