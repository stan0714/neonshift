/** 資料存取介面（SD 4.5）。記憶體實作供單元測試，PostgreSQL 實作供整合與正式。 */

export type Purpose = "login" | "claim" | "tournament_steps";

export type Challenge = {
  nonceHash: Buffer;
  wallet: string;
  purpose: Purpose;
  requestHash: Buffer | null;
  taskDate: number | null;
  taskType: number | null;
  expiresAt: Date;
  usedAt: Date | null;
};

export type Session = {
  jti: string;
  familyId: string;
  wallet: string;
  refreshHash: Buffer;
  expiresAt: Date;
  usedAt: Date | null;
  rotatedTo: string | null;
  revokedAt: Date | null;
};

export type Player = { wallet: string; firstSeenAt: Date; lastSeenAt: Date; deletedAt: Date | null };

export interface Store {
  insertChallenge(c: Challenge): Promise<void>;
  /** 原子消耗：只有未使用且未過期才會成功，回傳被消耗的 challenge */
  consumeChallenge(nonceHash: Buffer, now: Date): Promise<Challenge | null>;

  upsertPlayer(wallet: string, now: Date): Promise<Player>;
  getPlayer(wallet: string): Promise<Player | null>;

  insertSession(s: Session): Promise<void>;
  getSessionByRefreshHash(refreshHash: Buffer): Promise<Session | null>;
  getSession(jti: string): Promise<Session | null>;
  /** 標記已使用並指向新 session（輪替） */
  rotateSession(jti: string, rotatedTo: string, now: Date): Promise<void>;
  revokeFamily(familyId: string, now: Date): Promise<number>;
  revokeWallet(wallet: string, now: Date): Promise<number>;
}
