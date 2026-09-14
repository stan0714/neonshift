import type { Challenge, Player, Session, Store } from "./types.js";

/** 單元測試用；行為需與 PostgreSQL 實作一致（見 store.integration.test.ts） */
export class MemoryStore implements Store {
  challenges = new Map<string, Challenge>();
  players = new Map<string, Player>();
  sessions = new Map<string, Session>();

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
}
