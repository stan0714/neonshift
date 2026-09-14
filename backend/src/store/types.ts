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
export type EventRow = { purgedAt?: Date | null;
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
  /** 活動名單（含取消者，供成績匯入比對） */
  listEventParticipants(eventId: string): Promise<EventParticipant[]>;
  updateParticipantPrivacy(eventId: string, wallet: string, patch: { displayName?: string | null; publicConsent?: boolean }, now: Date): Promise<EventParticipant | null>;
  bumpCampaign(eventId: string, source: string, day: string, field: "views" | "registrations" | "checkins" | "redemptions"): Promise<void>;
  listCampaign(eventId: string): Promise<{ source: string; day: string; views: number; registrations: number; checkins: number; redemptions: number }[]>;

  // ---- PG-E-04：站點與 NFC 載具 ----
  createCheckpoint(c: Checkpoint): Promise<void>;
  listCheckpoints(eventId: string): Promise<Checkpoint[]>;
  getCheckpoint(eventId: string, checkpointId: string): Promise<Checkpoint | null>;
  createTag(t: Omit<NfcTag, "issuedAt" | "revokedAt">, now: Date): Promise<void>;
  getTagByRef(opaqueRef: string): Promise<NfcTag | null>;
  listTags(eventId: string): Promise<NfcTag[]>;
  revokeTag(eventId: string, tagId: string, now: Date): Promise<boolean>;

  // ---- PG-E-05：報到 ----
  insertCheckinChallenge(c: { challengeHash: Buffer; eventId: string; wallet: string; checkpointId: string; expiresAt: Date }): Promise<void>;
  /** 原子消耗：未使用且未過期才成功 */
  consumeCheckinChallenge(challengeHash: Buffer, now: Date): Promise<{ eventId: string; wallet: string; checkpointId: string } | null>;
  /** 冪等：同 (event, wallet, checkpoint) 已存在回 false；成功時 participant 狀態改 checked_in */
  insertCheckin(c: { eventId: string; wallet: string; checkpointId: string; confirmedBy: string; method: "nfc" | "qr" | "manual" }, now: Date): Promise<boolean>;
  listCheckins(eventId: string, wallet?: string): Promise<{ eventId: string; wallet: string; checkpointId: string; confirmedBy: string; confirmedAt: Date; method: string }[]>;

  // ---- PG-E-06：品項庫存與核銷 ----
  createBenefit(b: EventBenefit): Promise<void>;
  listBenefits(eventId: string): Promise<EventBenefit[]>;
  getBenefit(eventId: string, benefitId: string): Promise<EventBenefit | null>;
  /**
   * 原子預留（SD 11.4 庫存交易）：鎖 event／benefit／participant，檢查活動 published、資格（報名；requires_checkin 則需 checked_in）、
   * 截止、每人上限（reserved+fulfilled+requested ≤ limit）、庫存（reserved+fulfilled+requested ≤ total）。
   * 同 (event, wallet, idempotency_key) 已存在直接回原紀錄（created=false）。digital_badge 在同交易直接 fulfilled 並簽發憑證。
   */
  reserveRedemption(r: { redemptionId: string; eventId: string; wallet: string; benefitId: string; quantity: number; idempotencyKey: string; claimCode: string; reservedUntil: Date; credentialId: string | null }, now: Date): Promise<ReserveOutcome>;
  /** 交付：只有 reserved（未逾期）可轉 fulfilled；已 fulfilled 回原紀錄（already=true）；逾期先轉 expired 再回 "expired" */
  fulfillRedemption(eventId: string, key: { redemptionId?: string; claimCode?: string }, staffWallet: string, now: Date): Promise<FulfillOutcome>;
  /** 逾期預留 → expired 並釋放 reserved_count；回處理筆數 */
  expireRedemptions(now: Date): Promise<number>;
  /** 活動取消（BR-33）：所有 reserved → cancelled 並釋放；已交付不動 */
  releaseEventReservations(eventId: string, now: Date): Promise<number>;
  listRedemptions(eventId: string, wallet?: string): Promise<EventRedemption[]>;
  getRedemption(redemptionId: string): Promise<EventRedemption | null>;

  // ---- PG-E-07／E-08：成績 staging、發布、更正歷史、公開榜 ----
  /** 建立 staging（同活動 import_version 遞增，交易內取號）；不發布 */
  createResultImport(r: Omit<ResultImport, "importVersion" | "createdAt" | "publishedAt" | "publishedBy">, now: Date): Promise<ResultImport>;
  getResultImport(eventId: string, importId: string): Promise<ResultImport | null>;
  listResultImports(eventId: string): Promise<ResultImport[]>;
  /**
   * 原子發布：import 未發布且 error_count = 0；每列建立 revision，若同 (event, wallet, discipline) 已有發布版則串 previous_revision_id（更正）。
   * 回 "not_found"｜"already"｜"has_errors" 或 { revisions, corrections }。
   */
  publishResultImport(eventId: string, importId: string, publisher: string, reason: string | null, now: Date): Promise<{ revisions: number; corrections: number } | "not_found" | "already" | "has_errors">;
  /** 最新已發布版：每 (wallet, discipline) 一筆，附參加者顯示名稱與公開同意 */
  listCurrentResults(eventId: string): Promise<(ResultRevision & { displayName: string | null; publicConsent: boolean })[]>;
  /** 本人全部版本（含被更正的舊版），新到舊 */
  listResultHistory(eventId: string, wallet: string): Promise<ResultRevision[]>;

  // ---- PG-E-09：活動資料保留與刪除（BR-32） ----
  /** 活動結束／取消超過保留期（COALESCE(cancelled_at, ends_at) < cutoff）且未清理：刪除個人層資料、標記 purged_at；回清理的活動與筆數 */
  purgeEventData(cutoff: Date, now: Date): Promise<{ events: string[]; participants: number; checkins: number; redemptions: number; results: number }>;
  /** DELETE /player/data 同步：刪除該錢包在所有活動的個人層資料（未交付預留釋放、已交付只留匿名計數） */
  deleteWalletEventData(wallet: string, now: Date): Promise<{ participants: number; checkins: number; redemptions: number; results: number }>;

  // ---- PG-R-01：運動 session 摘要 ----
  /**
   * 去重／版本：同 (wallet, origin, external_record_id) 已存在時，source_revision 較小回 "stale"、相同回 "same"（原紀錄）、較大則取代（revision+1、狀態重算）；
   * tombstone（deleted_at）擋掉 ≤ 已刪除 revision 的重建。跨來源時間重疊 ≥ 50% 的另一筆標 possible_duplicate_of（不合併、不相加）。
   */
  upsertWorkout(w: Omit<WorkoutSession, "revision" | "importedAt" | "updatedAt" | "deletedAt" | "possibleDuplicateOf">, now: Date): Promise<{ outcome: "created" | "superseded" | "same" | "stale" | "deleted"; session: WorkoutSession }>;
  listWorkouts(wallet: string, limit: number, offset: number): Promise<WorkoutSession[]>;
  getWorkout(wallet: string, sessionId: string): Promise<WorkoutSession | null>;
  /** tombstone：status=deleted、deleted_at；回 false 表示不存在或已刪 */
  deleteWorkout(wallet: string, sessionId: string, now: Date): Promise<boolean>;

  // ---- PG-R-07：個人最佳 ----
  listPbRevisions(wallet: string): Promise<PbRevision[]>;
  /** 以目前有效候選重建：同 (key, source) 保留 pb_id；不在 desired 者 → invalidated；重新出現者恢復。回全部列 */
  syncPbRevisions(wallet: string, desired: PbDesired[], now: Date): Promise<PbRevision[]>;
  /** 本人在各活動的最新已發布成績（供 PB） */
  listCurrentResultsForWallet(wallet: string): Promise<ResultRevision[]>;

  // ---- PG-R-08：成就 NFT ----
  /** 建立或更新（未 minted 時 metadata 變更 → 回到 pending_registry） */
  upsertAchievement(a: Omit<Achievement, "createdAt" | "updatedAt">, now: Date): Promise<Achievement>;
  getAchievement(achievementId: string): Promise<Achievement | null>;
  getAchievementByPb(pbId: string): Promise<Achievement | null>;
  listAchievements(wallet: string): Promise<Achievement[]>;
  listAchievementsByStatus(status: Achievement["status"][], limit: number): Promise<Achievement[]>;
  setAchievementStatus(achievementId: string, status: Achievement["status"], extra: { registrySignature?: string; asset?: string; mintedSignature?: string }, now: Date): Promise<Achievement | null>;
}

export type Achievement = { achievementId: string; wallet: string; pbId: string; category: string; verificationClass: "organizer" | "device"; sourceRevision: number; rulesMajor: number; publicConsent: boolean; metadata: Record<string, unknown>; metadataHash: Buffer; status: "pending_registry" | "approved" | "minted" | "revoke_pending" | "revoked"; registrySignature: string | null; registryUpdatedAt: Date | null; asset: string | null; mintedSignature: string | null; mintedAt: Date | null; createdAt: Date; updatedAt: Date };

export type PbDesired = { key: string; discipline: "run"; category: string; environment: string; verificationClass: string; timingBasis: string; rulesMajor: number; value: bigint; sourceKind: "workout" | "result"; sourceId: string; sourceRevision: number; achievedAt: Date; status: "current" | "historical"; isBaseline: boolean; previousSourceId: string | null };
export type PbRevision = { pbId: string; wallet: string; discipline: string; category: string; environment: string; verificationClass: string; timingBasis: string; rulesMajor: number; value: bigint; sourceKind: "workout" | "result"; sourceId: string; sourceRevision: number; achievedAt: Date; status: "current" | "historical" | "invalidated"; isBaseline: boolean; previousPbId: string | null; createdAt: Date; invalidatedAt: Date | null; reason: string | null };

export type WorkoutSession = {
  sessionId: string; wallet: string; sport: "run" | "walk"; environment: "outdoor" | "indoor" | "unknown"; origin: "health_connect" | "device" | "gps" | "organizer" | "manual";
  sourceId: string; externalRecordId: string; sourceRevision: number; startedAt: Date; endedAt: Date; elapsedMs: bigint; pausedMs: bigint;
  status: "saved" | "needs_review" | "invalid" | "deleted"; quality: "complete" | "partial" | "estimated" | "needs_review" | "invalid"; rulesVersion: number;
  distanceMm: bigint | null; distanceMethod: "device" | "gps" | "estimated" | "organizer" | null; steps: number | null; activeEnergyMkcal: bigint | null; energyMethod: "device" | "estimated" | "total" | null; totalEnergyMkcal: bigint | null; stepLengthMm: number | null;
  pbEligible: boolean; possibleDuplicateOf: string | null; reviewReasons: string[]; extras: Record<string, unknown>; requestHash: Buffer; revision: number; importedAt: Date; updatedAt: Date; deletedAt: Date | null;
};

export type ResultImport = { importId: string; eventId: string; sourceKind: "csv" | "manual"; fileHash: Buffer; importVersion: number; rowCount: number; errorCount: number; stagedRows: StagedResult[]; errors: { line: number; field: string; message: string }[]; createdBy: string; createdAt: Date; publishedAt: Date | null; publishedBy: string | null };
export type StagedResult = { line: number; wallet: string; discipline: string; division: string | null; finishStatus: "finished" | "dnf" | "dns" | "dq"; distanceM: number; elapsedMs: number; rank: number | null };
export type ResultRevision = { revisionId: string; eventId: string; importId: string; wallet: string; discipline: string; division: string | null; distanceM: number; elapsedMs: number; rank: number | null; finishStatus: "finished" | "dnf" | "dns" | "dq"; previousRevisionId: string | null; reason: string | null; publishedAt: Date };

export type EventBenefit = { benefitId: string; eventId: string; kind: "physical" | "digital_badge"; name: string; stockTotal: number; reservedCount: number; fulfilledCount: number; perPersonLimit: number; eligibilityRuleRevision: string | null; requiresCheckin: boolean; claimDeadline: Date | null };
export type RedemptionStatus = "reserved" | "fulfilled" | "expired" | "cancelled";
export type EventRedemption = { redemptionId: string; eventId: string; wallet: string; benefitId: string; quantity: number; status: RedemptionStatus; reservedAt: Date; reservedUntil: Date; fulfilledBy: string | null; fulfilledAt: Date | null; idempotencyKey: string; claimCode: string | null; credentialId: string | null };
export type ReserveOutcome = { kind: "ok"; redemption: EventRedemption; created: boolean } | { kind: "not_open" | "not_eligible" | "checkin_required" | "deadline_passed" | "limit_reached" | "out_of_stock" | "no_benefit" };
export type FulfillOutcome = { kind: "ok"; redemption: EventRedemption; already: boolean } | { kind: "not_found" | "expired" | "cancelled" };

export type Checkpoint = { checkpointId: string; eventId: string; name: string; purpose: "check_in" | "redemption" | "info" };
export type NfcTag = { tagId: string; eventId: string; checkpointId: string | null; opaqueRef: string; purpose: "checkpoint" | "participant"; participantWallet: string | null; issuedBy: string; issuedAt: Date; revokedAt: Date | null };

export type EventParticipant = { eventId: string; wallet: string; status: "registered" | "cancelled" | "checked_in"; acceptedRuleRevision: string; displayName: string | null; publicConsentAt: Date | null; registeredAt: Date; cancelledAt: Date | null; retentionDueAt: Date | null };
