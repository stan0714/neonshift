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

export interface Store extends ClaimStore, PlayerDataStore {
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

// ---------------- PG-B-11：規則集、健康摘要、判定、attestation、idempotency ----------------

export type RuleSetRow = { rulesVersion: number; rulesHash: Buffer; config: unknown };

export type HealthSnapshotInput = {
  wallet: string;
  taskDate: number;
  taskType: number;
  attributedSteps: number | null;
  sleepMinutes: number | null;
  sourceSummary: unknown;
  stepRateSummary: unknown;
  sleepOverlapMinutes: number | null;
  sensorSummary: unknown;
  motionSummary: unknown;
  clientInfo: unknown;
  inputHash: Buffer;
};

export type RiskDecisionInput = {
  snapshotId: number;
  rulesVersion: number;
  riskScore: number;
  matchedRules: string[];
  decision: "pass" | "reject";
  rejectCode: string | null;
};

export type AttestationRow = {
  nonce: Buffer;
  idempotencyKey: string;
  requestHash: Buffer;
  wallet: string;
  taskDate: number;
  taskType: number;
  rulesVersion: number;
  evidenceHash: Buffer;
  issuedAt: Date;
  expiresAt: Date;
};

export type ClaimResult = {
  wallet: string;
  idempotencyKey: string;
  requestHash: Buffer;
  status: "processing" | "succeeded" | "rejected";
  httpStatus: number | null;
  response: unknown;
  createdAt: Date;
};

export interface ClaimStore {
  ensureRuleSet(row: RuleSetRow): Promise<void>;
  insertHealthSnapshot(s: HealthSnapshotInput): Promise<number>;
  insertRiskDecision(d: RiskDecisionInput): Promise<void>;
  insertAttestation(a: AttestationRow): Promise<void>;
  /** 原子取得處理權：不存在時建立 processing 並回 { acquired: true }；已存在回既有紀錄 */
  beginClaim(wallet: string, idempotencyKey: string, requestHash: Buffer, now: Date): Promise<{ acquired: boolean; existing: ClaimResult | null }>;
  completeClaim(wallet: string, idempotencyKey: string, status: "succeeded" | "rejected", httpStatus: number, response: unknown, now: Date): Promise<void>;
  /** processing 卡住（例如 signer 成功後 process crash）時釋放，讓同 key 可重新處理 */
  releaseClaim(wallet: string, idempotencyKey: string): Promise<void>;
}

// ---------------- PG-B-12／B-13：歷史與刪除 ----------------

export type HistoryItem = {
  taskDate: number;
  taskType: number;
  issuedAt: Date;
  expiresAt: Date;
  redeemedSig: string | null;
};

export type DeletionResult = {
  /** true：有進行中且已質押的賽事，摘要延後至 deletionDueAt */
  deferred: boolean;
  deletionDueAt: Date | null;
  deleted: { snapshots: number; attestations: number; claimResults: number; sessions: number };
};

export interface PlayerDataStore {
  listHistory(wallet: string, sinceTaskDate: number): Promise<HistoryItem[]>;
  /** 撤銷 session、刪除健康摘要與衍生資料、標記 players.deleted_at；有質押賽事時延後 */
  deletePlayerData(wallet: string, now: Date, deferUntil: Date | null): Promise<DeletionResult>;
  /** 是否有進行中且已質押的賽事（B-14 接入前恆為 false） */
  hasActiveStakedTournament(wallet: string): Promise<boolean>;
}
