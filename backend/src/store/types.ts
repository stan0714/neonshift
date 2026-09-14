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

export interface Store extends ClaimStore, PlayerDataStore, TournamentStore {
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
  /**
   * 是否有進行中且已質押的賽事。質押事實在鏈上（TournamentEntry），由 TournamentService 判斷；
   * Store 只回答「本地是否有該錢包在未結算週次的步數紀錄」作為輔助訊號。
   */
  hasActiveStakedTournament(wallet: string): Promise<boolean>;
}

// ---------------- PG-B-14：賽事步數 ----------------

export type TournamentStepsRow = { weekId: number; wallet: string; verifiedSteps: number; firstReachedAt: Date | null; updatedAt: Date };

export interface TournamentStore {
  getTournamentSteps(weekId: number, wallet: string): Promise<TournamentStepsRow | null>;
  /**
   * 單調不減 upsert：只有 `verifiedSteps` 大於既有值才更新，並把 `firstReachedAt` 設為本次 `reachedAt`；
   * 回傳更新後的 row 與是否有變更。
   */
  upsertTournamentSteps(weekId: number, wallet: string, verifiedSteps: number, reachedAt: Date, now: Date): Promise<{ row: TournamentStepsRow; changed: boolean }>;
  /** 依 BR-20 排序：步數 DESC、first_reached_at ASC、wallet 位元組序 ASC */
  listTournamentSteps(weekId: number, limit: number): Promise<TournamentStepsRow[]>;
  countTournamentSteps(weekId: number): Promise<number>;
  /** 該錢包在此週的名次（1 起；無紀錄回 null） */
  rankOf(weekId: number, wallet: string): Promise<number | null>;
}
