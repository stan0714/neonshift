import type { AttestationRow, Challenge, ClaimResult, DeletionResult, HealthSnapshotInput, HistoryItem, Player, RiskDecisionInput, RuleSetRow, Session, Store } from "./types.js";

/** 單元測試用；行為需與 PostgreSQL 實作一致（見 store.integration.test.ts） */
export class MemoryStore implements Store {
  challenges = new Map<string, Challenge>();
  players = new Map<string, Player>();
  sessions = new Map<string, Session>();
  ruleSets = new Map<number, RuleSetRow>();
  snapshots: (HealthSnapshotInput & { id: number })[] = [];
  decisions: RiskDecisionInput[] = [];
  attestations = new Map<string, AttestationRow>();
  claimResults = new Map<string, ClaimResult>();

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
    this.snapshots.push({ ...s, id });
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
      .map((a) => ({ taskDate: a.taskDate, taskType: a.taskType, issuedAt: a.issuedAt, expiresAt: a.expiresAt, redeemedSig: null }));
  }
  async hasActiveStakedTournament(_wallet: string) {
    return false;
  }
  async deletePlayerData(wallet: string, now: Date, deferUntil: Date | null): Promise<DeletionResult> {
    const sessions = await this.revokeWallet(wallet, now);
    const p = this.players.get(wallet);
    if (p) p.deletedAt = now;
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
