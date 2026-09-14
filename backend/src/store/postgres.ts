import type pg from "pg";

import type { AttestationRow, Challenge, ClaimResult, DeletionResult, HealthSnapshotInput, HistoryItem, Player, RiskDecisionInput, RuleSetRow, Session, Store } from "./types.js";

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
         sleep_overlap_minutes, sensor_summary, motion_summary, client_info, input_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [s.wallet, s.taskDate, s.taskType, s.attributedSteps, s.sleepMinutes, JSON.stringify(s.sourceSummary), s.stepRateSummary === null ? null : JSON.stringify(s.stepRateSummary),
        s.sleepOverlapMinutes, s.sensorSummary === null ? null : JSON.stringify(s.sensorSummary), s.motionSummary === null ? null : JSON.stringify(s.motionSummary), JSON.stringify(s.clientInfo), s.inputHash],
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
    // B-14 賽事 API 接入前，尚無質押資料
    return false;
  }
  async deletePlayerData(wallet: string, now: Date, deferUntil: Date | null): Promise<DeletionResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const sess = await client.query(`UPDATE auth_sessions SET revoked_at = $2 WHERE wallet = $1 AND revoked_at IS NULL`, [wallet, now]);
      await client.query(
        `UPDATE players SET deleted_at = $2, deletion_requested_at = $2, deletion_due_at = $3 WHERE wallet = $1`,
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
