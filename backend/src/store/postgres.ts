import type pg from "pg";

import type { Challenge, Player, Session, Store } from "./types.js";

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
       ON CONFLICT (wallet) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at
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
}
