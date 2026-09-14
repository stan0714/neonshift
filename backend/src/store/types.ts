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

export interface Store extends ClaimStore, PlayerDataStore, TournamentStore, IndexerStore, RetentionStore, GalleryStore, PartnerStore {
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
  /** family 最早 session 的到期時間（登入時間 = 該值 − REFRESH_TTL）；供「近期登入」檢查（SD 11.1） */
  familyFirstExpiresAt(familyId: string): Promise<Date | null>;
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
  /** 預設 now；保留清理測試用 */
  createdAt?: Date;
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

// ---------------- PG-B-16：ChainIndexer ----------------

export type ChainEventInput = { signature: string; eventIndex: number; slot: number; blockhash: string; commitment: "confirmed" | "finalized"; eventName: string; payload: Record<string, unknown> };
export type ChainEventRow = ChainEventInput & { orphanedAt: Date | null; ingestedAt: Date };
export type ChainCursor = { signature: string; slot: number };

export interface IndexerStore {
  getCursor(name: string): Promise<ChainCursor | null>;
  setCursor(name: string, signature: string, slot: number): Promise<void>;
  /** 以 (signature, event_index) 冪等；已存在則不動 */
  insertChainEvent(e: ChainEventInput, now: Date): Promise<void>;
  /** commitment = confirmed 且未 orphaned，依 slot ASC */
  listPendingChainEvents(limit: number): Promise<ChainEventRow[]>;
  finalizeChainEvent(signature: string, eventIndex: number): Promise<void>;
  markChainEventOrphaned(signature: string, eventIndex: number, now: Date): Promise<void>;
  listChainEvents(filter: { eventName?: string; wallet?: string; finalizedOnly?: boolean }, limit: number): Promise<ChainEventRow[]>;
  /** ClockedIn finalized → attestations.redeemed_sig；nonce 不存在（例如已刪除個資）時略過 */
  backfillRedeemedSig(nonce: Buffer, signature: string): Promise<boolean>;
}

// ---------------- PG-B-17：30 天保留清理 ----------------

export type PurgeCounts = { snapshots: number; attestations: number; claimResults: number; tournamentSteps: number; challenges: number; sessions: number };

export interface RetentionStore {
  /** 刪除 `cutoff` 之前的健康摘要（CASCADE 判定）、attestation、idempotency 快取、賽事步數；順帶清過期 challenge／session */
  purgeExpired(cutoff: Date, now: Date): Promise<PurgeCounts>;
  /** 延後刪除已到期（deletion_due_at <= now 且尚未執行）的錢包 */
  listDueDeletions(now: Date): Promise<string[]>;
  /** 延後刪除執行完成：清 deletion_due_at（deleted_at 保留） */
  markDeletionDone(wallet: string): Promise<void>;
}

// ---------------- PG-G-01：藝廊投影 ----------------

export type GalleryPlayer = { wallet: string; shoeLevel: number; coreLevel: number; xp: bigint; streakDays: number; maxStreakDays: number; lastTaskDate: number | null; collectibleCount: number; updatedSlot: number; updatedAt: Date };
export type GalleryCollectible = { wallet: string; kind: number; asset: string; signature: string; slot: number; claimedAt: Date };

export interface GalleryStore {
  /** 事件投影（冪等）：只在 `slot` 不早於既有 `updated_slot` 時覆寫等級／XP 等欄位 */
  upsertGalleryPlayer(p: { wallet: string; shoeLevel: number; coreLevel: number; xp: bigint; streakDays: number; maxStreakDays: number; lastTaskDate: number | null; slot: number }, now: Date): Promise<void>;
  /** 冪等（wallet, kind）；成功新增時 collectible_count += 1 */
  insertGalleryCollectible(c: GalleryCollectible): Promise<boolean>;
  getGalleryPlayer(wallet: string): Promise<GalleryPlayer | null>;
  /** 排行：shoe_level DESC → xp DESC → wallet C 序；offset 分頁 */
  listGalleryPlayers(limit: number, offset: number): Promise<GalleryPlayer[]>;
  countGalleryPlayers(): Promise<number>;
  galleryRankOf(wallet: string): Promise<number | null>;
  searchGalleryPlayers(prefix: string, limit: number): Promise<GalleryPlayer[]>;
  listGalleryCollectibles(wallet: string): Promise<GalleryCollectible[]>;
}

// ---------------- PG-E-01：合作組織、角色與活動 ----------------

export type OrgRole = "owner" | "member";
export type EventRole = "staff" | "result_editor" | "publisher";
export type EventState = "draft" | "published" | "cancelled" | "completed";

export type PartnerOrganization = { orgId: string; name: string; slug: string; createdBy: string; createdAt: Date; suspendedAt: Date | null };
export type PartnerMembership = { orgId: string; wallet: string; role: OrgRole; grantedBy: string; grantedAt: Date; revokedAt: Date | null };
export type EventRow = {
  eventId: string; orgId: string; slug: string; title: string; description: string; state: EventState; timezone: string;
  registrationOpensAt: Date | null; registrationClosesAt: Date | null; startsAt: Date | null; endsAt: Date | null;
  capacity: number; registrationCount: number; currentRuleRevision: string | null; tournamentAddress: string | null;
  revision: number; cancelReason: string | null; createdBy: string; createdAt: Date; updatedAt: Date; publishedAt: Date | null; cancelledAt: Date | null;
};
export type EventPatch = Partial<Pick<EventRow, "title" | "description" | "timezone" | "registrationOpensAt" | "registrationClosesAt" | "startsAt" | "endsAt" | "capacity" | "tournamentAddress">>;
export type EventRuleRevision = { revisionId: string; eventId: string; version: number; rules: unknown; rulesHash: Buffer; createdBy: string; createdAt: Date; publishedAt: Date | null };
export type EventRoleGrant = { eventId: string; wallet: string; role: EventRole; checkpointId: string | null; grantedBy: string; grantedAt: Date; revokedAt: Date | null };
export type AuditEntry = { eventId: string | null; orgId: string | null; actorWallet: string; action: string; target: string | null; revisionId: string | null; requestId: string | null; details: unknown };

export interface PartnerStore {
  createOrganization(o: Omit<PartnerOrganization, "createdAt" | "suspendedAt">, now: Date): Promise<PartnerOrganization>;
  getOrganization(orgId: string): Promise<PartnerOrganization | null>;
  getOrganizationBySlug(slug: string): Promise<PartnerOrganization | null>;
  /** upsert：已存在則更新角色並清除 revoked_at */
  upsertMembership(m: Omit<PartnerMembership, "grantedAt" | "revokedAt">, now: Date): Promise<void>;
  revokeMembership(orgId: string, wallet: string, now: Date): Promise<boolean>;
  /** 有效（未撤銷、組織未停權）成員資格 */
  listMemberships(wallet: string): Promise<PartnerMembership[]>;
  getMembership(orgId: string, wallet: string): Promise<PartnerMembership | null>;

  createEvent(e: Omit<EventRow, "state" | "registrationCount" | "currentRuleRevision" | "revision" | "cancelReason" | "createdAt" | "updatedAt" | "publishedAt" | "cancelledAt">, now: Date): Promise<EventRow>;
  getEvent(eventId: string): Promise<EventRow | null>;
  getEventBySlug(slug: string): Promise<EventRow | null>;
  /** 樂觀鎖：`expectedRevision` 不符回 null，不寫入 */
  updateEvent(eventId: string, expectedRevision: number, patch: EventPatch, now: Date): Promise<EventRow | null>;
  /** 狀態轉移（同時寫 published_at／cancelled_at／cancel_reason／current_rule_revision）；from 不符回 null */
  transitionEvent(eventId: string, from: EventState[], to: EventState, extra: { cancelReason?: string; currentRuleRevision?: string }, now: Date): Promise<EventRow | null>;
  listPublishedEvents(limit: number, offset: number): Promise<EventRow[]>;
  listOrgEvents(orgId: string): Promise<EventRow[]>;

  addRuleRevision(r: Omit<EventRuleRevision, "createdAt" | "publishedAt">, now: Date): Promise<EventRuleRevision>;
  getRuleRevision(revisionId: string): Promise<EventRuleRevision | null>;
  listRuleRevisions(eventId: string): Promise<EventRuleRevision[]>;
  markRuleRevisionPublished(revisionId: string, now: Date): Promise<void>;

  upsertEventRole(g: Omit<EventRoleGrant, "grantedAt" | "revokedAt">, now: Date): Promise<void>;
  revokeEventRole(eventId: string, wallet: string, role: EventRole, now: Date): Promise<boolean>;
  listEventRoles(eventId: string, wallet: string): Promise<EventRoleGrant[]>;
  listEventRolesForWallet(wallet: string): Promise<EventRoleGrant[]>;

  appendAudit(entry: AuditEntry, now: Date): Promise<void>;
  listAudit(eventId: string, limit: number): Promise<(AuditEntry & { createdAt: Date })[]>;

  // ---- PG-E-03：報名 ----
  /**
   * 原子報名：活動 published 且（capacity = 0 或 registration_count < capacity）才建立／復用 participant 並 +1。
   * 回 "full"（額滿）、"exists"（已報名）、或 participant。
   */
  registerParticipant(p: { eventId: string; wallet: string; acceptedRuleRevision: string; displayName: string | null; publicConsent: boolean }, now: Date): Promise<EventParticipant | "full" | "exists" | "not_open">;
  cancelRegistration(eventId: string, wallet: string, now: Date): Promise<EventParticipant | null>;
  getParticipant(eventId: string, wallet: string): Promise<EventParticipant | null>;
  listParticipations(wallet: string): Promise<EventParticipant[]>;
  updateParticipantPrivacy(eventId: string, wallet: string, patch: { displayName?: string | null; publicConsent?: boolean }, now: Date): Promise<EventParticipant | null>;
  bumpCampaign(eventId: string, source: string, day: string, field: "views" | "registrations" | "checkins" | "redemptions"): Promise<void>;
  listCampaign(eventId: string): Promise<{ source: string; day: string; views: number; registrations: number; checkins: number; redemptions: number }[]>;
}

export type EventParticipant = { eventId: string; wallet: string; status: "registered" | "cancelled" | "checked_in"; acceptedRuleRevision: string; displayName: string | null; publicConsentAt: Date | null; registeredAt: Date; cancelledAt: Date | null; retentionDueAt: Date | null };
