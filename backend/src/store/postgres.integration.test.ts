/**
 * PostgresStore 整合測試：需要 TEST_DATABASE_URL（已套用 migrations）。
 * scripts/test-all.sh 與 CI 會提供；本機未設定時整檔略過。
 */
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MemoryStore } from "./memory.js";
import { PostgresStore } from "./postgres.js";
import type { Store } from "./types.js";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("PostgresStore 與 MemoryStore 行為一致", () => {
  let pool: pg.Pool;
  let stores: { name: string; store: Store }[];

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    await pool.query("DELETE FROM gallery_prefs; DELETE FROM achievements; UPDATE pb_revisions SET previous_pb_id = NULL; DELETE FROM pb_revisions; UPDATE workout_sessions SET possible_duplicate_of = NULL; DELETE FROM workout_sessions; DELETE FROM event_badge_issues; DELETE FROM event_redemptions; DELETE FROM event_benefits; DELETE FROM result_revisions; DELETE FROM result_imports; DELETE FROM event_checkins; DELETE FROM checkin_challenges; DELETE FROM nfc_tags; DELETE FROM checkpoints; DELETE FROM campaign_aggregates; DELETE FROM event_audit_logs; DELETE FROM event_roles; DELETE FROM event_participants; UPDATE events SET current_rule_revision = NULL; DELETE FROM event_rule_revisions; DELETE FROM events; DELETE FROM partner_memberships; DELETE FROM partner_organizations; DELETE FROM gallery_collectibles; DELETE FROM gallery_players; DELETE FROM chain_cursor; DELETE FROM chain_events; DELETE FROM tournament_steps; DELETE FROM claim_results; DELETE FROM attestations; DELETE FROM health_snapshots; DELETE FROM auth_sessions; DELETE FROM auth_challenges; DELETE FROM players;");
    stores = [
      { name: "postgres", store: new PostgresStore(pool) },
      { name: "memory", store: new MemoryStore() },
    ];
  });
  afterAll(async () => {
    await pool?.end();
  });

  it("challenge 只能消耗一次，過期不可消耗", async () => {
    for (const { name, store } of stores) {
      const now = new Date();
      const hash = randomBytes(32);
      await store.insertChallenge({ nonceHash: hash, wallet: "w" + randomUUID().slice(0, 8), purpose: "login", requestHash: null, taskDate: null, taskType: null, expiresAt: new Date(now.getTime() + 60_000), usedAt: null });
      expect(await store.consumeChallenge(hash, now), name).not.toBeNull();
      expect(await store.consumeChallenge(hash, now), name).toBeNull();

      const expired = randomBytes(32);
      await store.insertChallenge({ nonceHash: expired, wallet: "w", purpose: "login", requestHash: null, taskDate: null, taskType: null, expiresAt: new Date(now.getTime() - 1), usedAt: null });
      expect(await store.consumeChallenge(expired, now), name).toBeNull();
    }
  });

  it("並發消耗同一 challenge 只有一個成功（原子 UPDATE）", async () => {
    const store = stores[0]!.store;
    const now = new Date();
    const hash = randomBytes(32);
    await store.insertChallenge({ nonceHash: hash, wallet: "w", purpose: "login", requestHash: null, taskDate: null, taskType: null, expiresAt: new Date(now.getTime() + 60_000), usedAt: null });
    const results = await Promise.all(Array.from({ length: 8 }, () => store.consumeChallenge(hash, now)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("session 輪替與 family 撤銷", async () => {
    for (const { name, store } of stores) {
      const now = new Date();
      const wallet = "w" + randomUUID().slice(0, 8);
      await store.upsertPlayer(wallet, now);
      const family = randomUUID();
      const a = { jti: randomUUID(), familyId: family, wallet, refreshHash: randomBytes(32), expiresAt: new Date(now.getTime() + 60_000), usedAt: null, rotatedTo: null, revokedAt: null };
      const b = { ...a, jti: randomUUID(), refreshHash: randomBytes(32) };
      await store.insertSession(a);
      await store.insertSession(b);
      await store.rotateSession(a.jti, b.jti, now);
      expect((await store.getSession(a.jti))?.rotatedTo, name).toBe(b.jti);
      expect((await store.getSessionByRefreshHash(b.refreshHash))?.jti, name).toBe(b.jti);
      expect(await store.revokeFamily(family, now), name).toBe(2);
      expect((await store.getSession(b.jti))?.revokedAt, name).not.toBeNull();
      expect(await store.revokeFamily(family, now), name).toBe(0);
    }
  });

  it("upsertPlayer 更新 last_seen 且保留 first_seen", async () => {
    for (const { name, store } of stores) {
      const wallet = "w" + randomUUID().slice(0, 8);
      const t1 = new Date("2026-09-14T00:00:00Z");
      const t2 = new Date("2026-09-14T01:00:00Z");
      const p1 = await store.upsertPlayer(wallet, t1);
      const p2 = await store.upsertPlayer(wallet, t2);
      expect(p1.firstSeenAt.getTime(), name).toBe(t1.getTime());
      expect(p2.firstSeenAt.getTime(), name).toBe(t1.getTime());
      expect(p2.lastSeenAt.getTime(), name).toBe(t2.getTime());
    }
  });

  it("claim idempotency：beginClaim 只有一個取得處理權；complete 後回既有；release 只刪 processing", async () => {
    for (const { name, store } of stores) {
      const now = new Date();
      const wallet = "w" + randomUUID().slice(0, 8);
      await store.upsertPlayer(wallet, now);
      const key = randomUUID();
      const rh = randomBytes(32);
      const results = await Promise.all(Array.from({ length: 6 }, () => store.beginClaim(wallet, key, rh, now)));
      expect(results.filter((r) => r.acquired), name).toHaveLength(1);
      expect(results.filter((r) => !r.acquired && r.existing?.status === "processing"), name).toHaveLength(5);
      await store.completeClaim(wallet, key, "succeeded", 200, { ok: true }, now);
      const again = await store.beginClaim(wallet, key, rh, now);
      expect(again.existing?.status, name).toBe("succeeded");
      expect(again.existing?.response, name).toEqual({ ok: true });
      await store.releaseClaim(wallet, key);
      expect((await store.beginClaim(wallet, key, rh, now)).acquired, name).toBe(false);
    }
  });

  it("deletePlayerData：撤銷 session、刪 snapshot（CASCADE decision）／attestation／claim_results，並標記 deleted_at；歷史只回本人", async () => {
    for (const { name, store } of stores) {
      const now = new Date();
      const wallet = "w" + randomUUID().slice(0, 8);
      await store.upsertPlayer(wallet, now);
      await store.insertSession({ jti: randomUUID(), familyId: randomUUID(), wallet, refreshHash: randomBytes(32), expiresAt: new Date(now.getTime() + 1000), usedAt: null, rotatedTo: null, revokedAt: null });
      const sid = await store.insertHealthSnapshot({ wallet, taskDate: 20_710, taskType: 1, attributedSteps: 1, sleepMinutes: null, sourceSummary: [], stepRateSummary: null, sleepOverlapMinutes: null, sensorSummary: null, motionSummary: null, clientInfo: {}, inputHash: randomBytes(32) });
      await store.insertRiskDecision({ snapshotId: sid, rulesVersion: 3, riskScore: 0, matchedRules: [], decision: "pass", rejectCode: null });
      await store.ensureRuleSet({ rulesVersion: 3, rulesHash: randomBytes(32), config: {} }).catch(() => {});
      await store.insertAttestation({ nonce: randomBytes(16), idempotencyKey: randomUUID(), requestHash: randomBytes(32), wallet, taskDate: 20_710, taskType: 1, rulesVersion: 3, evidenceHash: randomBytes(32), issuedAt: now, expiresAt: new Date(now.getTime() + 600_000) });
      await store.beginClaim(wallet, randomUUID(), randomBytes(32), now);
      expect(await store.listHistory(wallet, 20_700), name).toHaveLength(1);
      const r = await store.deletePlayerData(wallet, now, null);
      expect(r, name).toMatchObject({ deferred: false, deleted: { snapshots: 1, attestations: 1, claimResults: 1, sessions: 1 } });
      expect(await store.listHistory(wallet, 20_700), name).toHaveLength(0);
      expect((await store.getPlayer(wallet))?.deletedAt, name).not.toBeNull();
      // 重新登入（upsert）視為新同意
      expect((await store.upsertPlayer(wallet, now)).deletedAt, name).toBeNull();
    }
  });

  it("tournament_steps：單調不減 upsert、BR-20 排序（步數 DESC → 先達成 ASC → 錢包 C 序）、名次", async () => {
    for (const { name, store } of stores) {
      const week = 2026_38;
      const t0 = new Date("2026-09-12T00:00:00Z");
      const [a, b, c] = ["9zzz", "7aaa", "7abb"]; // C collation：7aaa < 7abb < 9zzz
      expect((await store.upsertTournamentSteps(week, a, 10_000, new Date(t0.getTime() + 500_000), t0)).changed).toBe(true);
      const lower = await store.upsertTournamentSteps(week, a, 9_000, new Date(t0.getTime() + 900_000), t0);
      expect(lower.changed).toBe(false);
      expect(lower.row.verifiedSteps).toBe(10_000);
      expect(lower.row.firstReachedAt?.getTime()).toBe(t0.getTime() + 500_000);
      await store.upsertTournamentSteps(week, b, 10_000, new Date(t0.getTime() + 400_000), t0);
      await store.upsertTournamentSteps(week, c, 10_000, new Date(t0.getTime() + 500_000), t0);
      const rows = await store.listTournamentSteps(week, 10);
      expect(rows.map((r) => r.wallet), name).toEqual([b, c, a]);
      expect(await store.rankOf(week, a), name).toBe(3);
      expect(await store.rankOf(week, "none"), name).toBeNull();
      expect(await store.countTournamentSteps(week), name).toBe(3);
      await store.upsertTournamentSteps(week, a, 12_000, new Date(t0.getTime() + 600_000), t0);
      expect(await store.rankOf(week, a), name).toBe(1);
      expect((await store.getTournamentSteps(week, a))?.verifiedSteps).toBe(12_000);
    }
  });

  it("chain_events：冪等寫入、pending 依 slot、finalize／orphan、游標 upsert、redeemed_sig 回填一次", async () => {
    for (const { name, store } of stores) {
      const now = new Date("2026-09-14T00:00:00Z");
      const wallet = "W" + name;
      const nonce = Buffer.from(("ab".repeat(16)).slice(0, 32), "hex");
      await store.upsertPlayer(wallet, now);
      await store.insertAttestation({ nonce, idempotencyKey: "11111111-1111-4111-8111-11111111111" + (name === "postgres" ? "1" : "2"), requestHash: Buffer.alloc(32), wallet, taskDate: 20_710, taskType: 1, rulesVersion: 3, evidenceHash: Buffer.alloc(32), issuedAt: now, expiresAt: new Date(now.getTime() + 600_000) }); // attestations_window_ck：expires_at > issued_at
      await store.insertChainEvent({ signature: "s1", eventIndex: 0, slot: 20, blockhash: "b", commitment: "confirmed", eventName: "ClockedIn", payload: { wallet, nonce: nonce.toString("hex") } }, now);
      await store.insertChainEvent({ signature: "s1", eventIndex: 0, slot: 999, blockhash: "x", commitment: "confirmed", eventName: "Other", payload: {} }, now); // 冪等
      await store.insertChainEvent({ signature: "s0", eventIndex: 0, slot: 10, blockhash: "b", commitment: "confirmed", eventName: "PlayerInitialized", payload: { wallet } }, now);
      const pending = await store.listPendingChainEvents(10);
      expect(pending.map((p) => p.signature), name).toEqual(["s0", "s1"]);
      expect(pending[1]!.eventName).toBe("ClockedIn");
      await store.finalizeChainEvent("s1", 0);
      await store.markChainEventOrphaned("s0", 0, now);
      expect(await store.listPendingChainEvents(10), name).toHaveLength(0);
      expect((await store.listChainEvents({ finalizedOnly: true }, 10)).map((e) => e.signature), name).toEqual(["s1"]);
      expect((await store.listChainEvents({ eventName: "ClockedIn", wallet }, 10)), name).toHaveLength(1);
      expect(await store.backfillRedeemedSig(nonce, "s1"), name).toBe(true);
      expect(await store.backfillRedeemedSig(nonce, "s9"), name).toBe(false); // 已回填不覆寫
      expect(await store.backfillRedeemedSig(Buffer.alloc(16, 7), "s1"), name).toBe(false);
      expect((await store.listHistory(wallet, 0))[0]!.redeemedSig, name).toBe("s1");
      await store.setCursor("c", "s1", 20);
      await store.setCursor("c", "s2", 30);
      expect(await store.getCursor("c"), name).toEqual({ signature: "s2", slot: 30 });
    }
  });

  it("purgeExpired：只刪 cutoff 前資料（CASCADE 判定）；listDueDeletions／markDeletionDone", async () => {
    for (const { name, store } of stores) {
      const now = new Date("2026-10-15T00:00:00Z");
      const old = new Date("2026-09-10T00:00:00Z");
      const wallet = "R" + name;
      await store.purgeExpired(new Date("2026-09-15T00:00:00Z"), now); // 先清掉前面測試留下的舊資料，讓計數只反映本測試
      await store.upsertPlayer(wallet, old);
      const sid = await store.insertHealthSnapshot({ wallet, taskDate: 1, taskType: 1, attributedSteps: 1, sleepMinutes: null, sourceSummary: [], stepRateSummary: null, sleepOverlapMinutes: null, sensorSummary: null, motionSummary: null, clientInfo: {}, inputHash: Buffer.alloc(32), createdAt: old });
      await store.insertRiskDecision({ snapshotId: sid, rulesVersion: 3, riskScore: 0, matchedRules: [], decision: "pass", rejectCode: null });
      await store.insertHealthSnapshot({ wallet, taskDate: 2, taskType: 1, attributedSteps: 1, sleepMinutes: null, sourceSummary: [], stepRateSummary: null, sleepOverlapMinutes: null, sensorSummary: null, motionSummary: null, clientInfo: {}, inputHash: Buffer.alloc(32), createdAt: now });
      await store.upsertTournamentSteps(2026_36, wallet, 1, old, old);
      const r = await store.purgeExpired(new Date("2026-09-15T00:00:00Z"), now);
      expect(r.snapshots, name).toBe(1);
      expect(r.tournamentSteps, name).toBe(1);
      await store.deletePlayerData(wallet, now, new Date("2026-10-16T00:00:00Z"));
      expect(await store.listDueDeletions(now), name).toEqual([]);
      expect(await store.listDueDeletions(new Date("2026-10-17T00:00:00Z")), name).toEqual([wallet]);
      await store.markDeletionDone(wallet);
      expect(await store.listDueDeletions(new Date("2026-10-17T00:00:00Z")), name).toEqual([]);
    }
  });

  it("gallery：slot 單調 upsert、收藏冪等計數、排行（等級 → XP → 錢包 C 序）、搜尋", async () => {
    for (const { name, store } of stores) {
      const now = new Date("2026-09-14T00:00:00Z");
      const [a, b, c] = [`G${name}aaa`, `G${name}bbb`, `G${name}ccc`];
      await store.upsertGalleryPlayer({ wallet: a, shoeLevel: 2, coreLevel: 2, xp: 500n, streakDays: 1, maxStreakDays: 1, lastTaskDate: 1, slot: 10 }, now);
      await store.upsertGalleryPlayer({ wallet: a, shoeLevel: 1, coreLevel: 1, xp: 100n, streakDays: 1, maxStreakDays: 1, lastTaskDate: 1, slot: 5 }, now); // 舊 slot 忽略
      await store.upsertGalleryPlayer({ wallet: b, shoeLevel: 3, coreLevel: 3, xp: 1600n, streakDays: 2, maxStreakDays: 7, lastTaskDate: 2, slot: 11 }, now);
      await store.upsertGalleryPlayer({ wallet: c, shoeLevel: 2, coreLevel: 2, xp: 500n, streakDays: 1, maxStreakDays: 1, lastTaskDate: 1, slot: 12 }, now);
      expect((await store.getGalleryPlayer(a))?.xp, name).toBe(500n);
      expect(await store.insertGalleryCollectible({ wallet: b, kind: 1, asset: "A", signature: "s", slot: 1, claimedAt: now }), name).toBe(true);
      expect(await store.insertGalleryCollectible({ wallet: b, kind: 1, asset: "A", signature: "s", slot: 1, claimedAt: now }), name).toBe(false);
      expect((await store.getGalleryPlayer(b))?.collectibleCount, name).toBe(1);
      expect((await store.listGalleryPlayers(10, 0)).map((p) => p.wallet), name).toEqual([b, a, c]);
      expect(await store.galleryRankOf(c), name).toBe(3);
      expect(await store.countGalleryPlayers(), name).toBe(3);
      expect((await store.searchGalleryPlayers(`G${name}b`, 10)).map((p) => p.wallet), name).toEqual([b]);
      expect((await store.listGalleryCollectibles(b)).map((x) => x.kind), name).toEqual([1]);
    }
  });

  it("partner：組織／成員 upsert 與撤銷、活動樂觀鎖與狀態轉移、規則版本、活動角色、稽核", async () => {
    for (const { name, store } of stores) {
      const now = new Date("2026-09-14T00:00:00Z");
      const orgId = randomUUID();
      const owner = "P" + name;
      await store.createOrganization({ orgId, name: "Org " + name, slug: "org-" + name, createdBy: owner }, now);
      await store.upsertMembership({ orgId, wallet: owner, role: "owner", grantedBy: owner }, now);
      expect((await store.listMemberships(owner)).map((m) => m.role), name).toEqual(["owner"]);
      expect(await store.revokeMembership(orgId, owner, now), name).toBe(true);
      expect(await store.listMemberships(owner), name).toEqual([]);
      await store.upsertMembership({ orgId, wallet: owner, role: "owner", grantedBy: owner }, now); // 復原
      expect((await store.getMembership(orgId, owner))?.revokedAt, name).toBeNull();

      const eventId = randomUUID();
      const e = await store.createEvent({ eventId, orgId, slug: "ev-" + name, title: "T", description: "", timezone: "UTC", registrationOpensAt: null, registrationClosesAt: null, startsAt: null, endsAt: null, capacity: 10, tournamentAddress: null, badges: { checkIn: true, finish: true }, createdBy: owner }, now);
      expect([e.state, e.revision], name).toEqual(["draft", 1]);
      expect(await store.updateEvent(eventId, 99, { title: "X" }, now), name).toBeNull(); // 版本不符
      expect(e.badges, name).toEqual({ checkIn: true, finish: true }); // PG-M-04
      const u = await store.updateEvent(eventId, 1, { title: "River 5K", capacity: 50, badges: { checkIn: false, finish: true } }, now);
      expect([u?.title, u?.capacity, u?.revision, u?.badges], name).toEqual(["River 5K", 50, 2, { checkIn: false, finish: true }]);
      const rev = await store.addRuleRevision({ revisionId: randomUUID(), eventId, version: 1, rules: { distance_m: 5000 }, rulesHash: Buffer.alloc(32, 1), createdBy: owner }, now);
      expect(await store.transitionEvent(eventId, ["published"], "cancelled", {}, now), name).toBeNull(); // from 不符
      const pub = await store.transitionEvent(eventId, ["draft"], "published", { currentRuleRevision: rev.revisionId }, now);
      expect([pub?.state, pub?.currentRuleRevision, pub?.publishedAt !== null], name).toEqual(["published", rev.revisionId, true]);
      await store.markRuleRevisionPublished(rev.revisionId, now);
      expect((await store.listRuleRevisions(eventId))[0]?.publishedAt, name).not.toBeNull();
      expect((await store.listPublishedEvents(10, 0)).map((x) => x.eventId), name).toContain(eventId);
      const can = await store.transitionEvent(eventId, ["published"], "cancelled", { cancelReason: "weather" }, now);
      expect([can?.state, can?.cancelReason], name).toEqual(["cancelled", "weather"]);

      await store.upsertEventRole({ eventId, wallet: "S" + name, role: "staff", checkpointId: null, grantedBy: owner }, now);
      expect((await store.listEventRoles(eventId, "S" + name)).map((g) => g.role), name).toEqual(["staff"]);
      expect(await store.revokeEventRole(eventId, "S" + name, "staff", now), name).toBe(true);
      expect(await store.listEventRolesForWallet("S" + name), name).toEqual([]);
      await store.appendAudit({ eventId, orgId, actorWallet: owner, action: "event.cancel", target: null, revisionId: null, requestId: "r", details: { reason: "weather" } }, now);
      expect((await store.listAudit(eventId, 5))[0]?.action, name).toBe("event.cancel");
    }
  });
  it("events E-03～E-09：報名容量、報到 challenge／冪等、預留／交付／逾期／取消釋放、成績版本鏈與公開投影、錢包刪除與活動保留清理", async () => {
    for (const { name, store } of stores) {
      const now = new Date("2026-10-03T00:00:00Z");
      const orgId = randomUUID();
      const owner = "O" + name;
      await store.createOrganization({ orgId, name: "Org2 " + name, slug: "org2-" + name, createdBy: owner }, now);
      const eventId = randomUUID();
      await store.createEvent({ eventId, orgId, slug: "ev2-" + name, title: "T", description: "", timezone: "UTC", registrationOpensAt: null, registrationClosesAt: null, startsAt: now, endsAt: new Date("2026-10-03T04:00:00Z"), capacity: 2, tournamentAddress: null, badges: { checkIn: false, finish: false }, createdBy: owner }, now);
      const rev = await store.addRuleRevision({ revisionId: randomUUID(), eventId, version: 1, rules: {}, rulesHash: Buffer.alloc(32, 2), createdBy: owner }, now);
      await store.transitionEvent(eventId, ["draft"], "published", { currentRuleRevision: rev.revisionId }, now);
      const [a, b, c] = ["A" + name, "B" + name, "C" + name];
      // 報名：容量 2、重複 exists、第三人 full；取消釋放
      const reg = await store.registerParticipant({ eventId, wallet: a, acceptedRuleRevision: rev.revisionId, displayName: "Alice", publicConsent: true, levelAtRegistration: 2 }, now);
      expect(typeof reg, name).toBe("object");
      expect((reg as { levelAtRegistration: number | null }).levelAtRegistration, name).toBe(2); // PG-M-04 報名時鞋階快照
      expect((await store.getParticipant(eventId, a))?.levelAtRegistration, name).toBe(2);
      expect(await store.registerParticipant({ eventId, wallet: a, acceptedRuleRevision: rev.revisionId, displayName: null, publicConsent: false }, now), name).toBe("exists");
      await store.registerParticipant({ eventId, wallet: b, acceptedRuleRevision: rev.revisionId, displayName: null, publicConsent: false }, now);
      expect(await store.registerParticipant({ eventId, wallet: c, acceptedRuleRevision: rev.revisionId, displayName: null, publicConsent: false }, now), name).toBe("full");
      await store.cancelRegistration(eventId, b, now);
      expect(typeof (await store.registerParticipant({ eventId, wallet: c, acceptedRuleRevision: rev.revisionId, displayName: null, publicConsent: false }, now)), name).toBe("object");
      expect((await store.listEventParticipants(eventId)).length, name).toBe(3);
      // 站點、challenge 單次消耗、報到冪等 → checked_in
      const cp = randomUUID();
      await store.createCheckpoint({ checkpointId: cp, eventId, name: "Gate", purpose: "check_in" });
      const h = Buffer.alloc(32, 7 + (name === "postgres" ? 1 : 0));
      await store.insertCheckinChallenge({ challengeHash: h, eventId, wallet: a, checkpointId: cp, expiresAt: new Date(now.getTime() + 120_000) });
      expect((await store.consumeCheckinChallenge(h, now))?.wallet, name).toBe(a);
      expect(await store.consumeCheckinChallenge(h, now), name).toBeNull();
      expect(await store.insertCheckin({ eventId, wallet: a, checkpointId: cp, confirmedBy: owner, method: "qr" }, now), name).toBe(true);
      expect(await store.insertCheckin({ eventId, wallet: a, checkpointId: cp, confirmedBy: owner, method: "qr" }, now), name).toBe(false);
      expect((await store.getParticipant(eventId, a))?.status, name).toBe("checked_in");
      // 品項：庫存 1、a 預留（冪等）、c 售罄；交付一次；逾期釋放
      const bid = randomUUID();
      await store.createBenefit({ benefitId: bid, eventId, kind: "physical", name: "Towel", stockTotal: 1, reservedCount: 0, fulfilledCount: 0, perPersonLimit: 1, eligibilityRuleRevision: rev.revisionId, requiresCheckin: true, claimDeadline: null });
      const key = randomUUID();
      const r1 = await store.reserveRedemption({ redemptionId: randomUUID(), eventId, wallet: a, benefitId: bid, quantity: 1, idempotencyKey: key, claimCode: "AAAA2222", reservedUntil: new Date(now.getTime() + 900_000), credentialId: null }, now);
      expect(r1.kind === "ok" && r1.created, name).toBe(true);
      const r2 = await store.reserveRedemption({ redemptionId: randomUUID(), eventId, wallet: a, benefitId: bid, quantity: 1, idempotencyKey: key, claimCode: "BBBB2222", reservedUntil: new Date(now.getTime() + 900_000), credentialId: null }, now);
      expect(r2.kind === "ok" && !r2.created && r2.redemption.claimCode === "AAAA2222", name).toBe(true);
      expect((await store.reserveRedemption({ redemptionId: randomUUID(), eventId, wallet: c, benefitId: bid, quantity: 1, idempotencyKey: randomUUID(), claimCode: "CCCC2222", reservedUntil: new Date(now.getTime() + 900_000), credentialId: null }, now)).kind, name).toBe("checkin_required");
      await store.insertCheckin({ eventId, wallet: c, checkpointId: cp, confirmedBy: owner, method: "manual" }, now);
      expect((await store.reserveRedemption({ redemptionId: randomUUID(), eventId, wallet: c, benefitId: bid, quantity: 1, idempotencyKey: randomUUID(), claimCode: "CCCC2222", reservedUntil: new Date(now.getTime() + 900_000), credentialId: null }, now)).kind, name).toBe("out_of_stock");
      const f1 = await store.fulfillRedemption(eventId, { claimCode: "AAAA2222" }, owner, now);
      expect(f1.kind === "ok" && !f1.already, name).toBe(true);
      const f2 = await store.fulfillRedemption(eventId, { claimCode: "AAAA2222" }, owner, now);
      expect(f2.kind === "ok" && f2.already, name).toBe(true);
      expect(await store.getBenefit(eventId, bid), name).toMatchObject({ reservedCount: 0, fulfilledCount: 1 });
      const bid2 = randomUUID();
      await store.createBenefit({ benefitId: bid2, eventId, kind: "physical", name: "Cap", stockTotal: 1, reservedCount: 0, fulfilledCount: 0, perPersonLimit: 1, eligibilityRuleRevision: null, requiresCheckin: false, claimDeadline: null });
      await store.reserveRedemption({ redemptionId: randomUUID(), eventId, wallet: c, benefitId: bid2, quantity: 1, idempotencyKey: randomUUID(), claimCode: "DDDD2222", reservedUntil: new Date(now.getTime() + 60_000), credentialId: null }, now);
      const later = new Date(now.getTime() + 61_000);
      expect((await store.fulfillRedemption(eventId, { claimCode: "DDDD2222" }, owner, later)).kind, name).toBe("expired");
      expect((await store.getBenefit(eventId, bid2))?.reservedCount, name).toBe(0);
      // 成績：兩版，第二版串前版；公開投影只帶同意
      const imp1 = await store.createResultImport({ importId: randomUUID(), eventId, sourceKind: "csv", fileHash: Buffer.alloc(32, 3), rowCount: 1, errorCount: 0, stagedRows: [{ line: 2, wallet: a, discipline: "run", division: null, finishStatus: "finished", distanceM: 5000, elapsedMs: 1500000, rank: 1 }], errors: [], createdBy: owner }, now);
      expect(imp1.importVersion, name).toBe(1);
      expect(await store.publishResultImport(eventId, imp1.importId, owner, null, now), name).toEqual({ revisions: 1, corrections: 0 });
      expect(await store.publishResultImport(eventId, imp1.importId, owner, null, now), name).toBe("already");
      const imp2 = await store.createResultImport({ importId: randomUUID(), eventId, sourceKind: "csv", fileHash: Buffer.alloc(32, 4), rowCount: 1, errorCount: 0, stagedRows: [{ line: 2, wallet: a, discipline: "run", division: null, finishStatus: "dnf", distanceM: 3000, elapsedMs: 0, rank: null }], errors: [], createdBy: owner }, now);
      expect(await store.publishResultImport(eventId, imp2.importId, owner, "chip", later), name).toEqual({ revisions: 1, corrections: 1 });
      const cur = await store.listCurrentResults(eventId);
      expect(cur.map((x) => [x.finishStatus, x.publicConsent, x.displayName]), name).toEqual([["dnf", true, "Alice"]]);
      const hist = await store.listResultHistory(eventId, a);
      expect([hist.length, hist[0]?.previousRevisionId === hist[1]?.revisionId, hist[0]?.reason], name).toEqual([2, true, "chip"]);
      // 錢包刪除：c 的資料消失，a 不受影響
      const dw = await store.deleteWalletEventData(c, later);
      expect(dw.participants, name).toBe(1);
      expect(await store.getParticipant(eventId, c), name).toBeNull();
      expect((await store.listCheckins(eventId)).map((x) => x.wallet), name).toEqual([a]);
      // 活動保留清理：cutoff 早於 ends_at 不清；之後清並標記；二次不重複
      expect((await store.purgeEventData(new Date("2026-10-01T00:00:00Z"), later)).events, name).not.toContain(eventId);
      const purged = await store.purgeEventData(new Date("2027-04-05T00:00:00Z"), later);
      expect(purged.events, name).toContain(eventId);
      expect(await store.getParticipant(eventId, a), name).toBeNull();
      expect(await store.listCurrentResults(eventId), name).toEqual([]);
      expect((await store.getResultImport(eventId, imp1.importId))?.stagedRows, name).toEqual([]);
      expect((await store.getEvent(eventId))?.purgedAt, name).not.toBeNull();
      expect((await store.purgeEventData(new Date("2027-04-05T00:00:00Z"), later)).events, name).not.toContain(eventId);
    }
  }, 60_000); // 多筆交易；遠端 DB（SSH tunnel）每次往返較慢
  it("workouts（R-01）：來源 revision 去重（same／stale／superseded）、跨來源可能重複、tombstone、刪除錢包", async () => {
    for (const { name, store } of stores) {
      const wallet = "W" + name;
      const t0 = new Date("2026-09-14T00:00:00Z");
      const mk = (over: Partial<Parameters<Store["upsertWorkout"]>[0]>) => ({ sessionId: randomUUID(), wallet, sport: "run" as const, environment: "outdoor" as const, origin: "health_connect" as const, sourceId: "watch", externalRecordId: "r1", sourceRevision: 1, startedAt: t0, endedAt: new Date(t0.getTime() + 1_500_000), elapsedMs: 1_500_000n, pausedMs: 0n, status: "saved" as const, quality: "complete" as const, rulesVersion: 1, distanceMm: 5_000_000n, distanceMethod: "device" as const, steps: 6000, activeEnergyMkcal: null, energyMethod: null, totalEnergyMkcal: null, stepLengthMm: null, pbEligible: true, reviewReasons: [], extras: {}, requestHash: Buffer.alloc(32, 9), ...over });
      const a = await store.upsertWorkout(mk({}), t0);
      expect(a.outcome, name).toBe("created");
      expect((await store.upsertWorkout(mk({}), t0)).outcome, name).toBe("same");
      const b = await store.upsertWorkout(mk({ sourceRevision: 2, distanceMm: 5_100_000n }), t0);
      expect([b.outcome, b.session.sessionId === a.session.sessionId, b.session.revision, b.session.distanceMm], name).toEqual(["superseded", true, 2, 5_100_000n]);
      expect((await store.upsertWorkout(mk({ sourceRevision: 1 }), t0)).outcome, name).toBe("stale");
      const g = await store.upsertWorkout(mk({ origin: "gps", externalRecordId: "local", startedAt: new Date(t0.getTime() + 60_000), endedAt: new Date(t0.getTime() + 1_440_000), elapsedMs: 1_380_000n }), t0);
      expect(g.session.possibleDuplicateOf, name).toBe(a.session.sessionId);
      expect((await store.listWorkouts(wallet, 10, 0)).length, name).toBe(2);
      expect(await store.deleteWorkout(wallet, a.session.sessionId, t0), name).toBe(true);
      expect(await store.deleteWorkout(wallet, a.session.sessionId, t0), name).toBe(false);
      expect((await store.getWorkout(wallet, g.session.sessionId))?.possibleDuplicateOf, name).toBeNull();
      expect((await store.upsertWorkout(mk({ sourceRevision: 2 }), t0)).outcome, name).toBe("deleted");
      expect((await store.upsertWorkout(mk({ sourceRevision: 3 }), t0)).outcome, name).toBe("superseded");
      await store.upsertPlayer(wallet, t0);
      await store.deletePlayerData(wallet, t0, null);
      expect(await store.listWorkouts(wallet, 10, 0), name).toEqual([]);
    }
  });
  it("pb_revisions（R-07）：sync 保留 pb_id、previous 鏈、invalidated 與恢復；listCurrentResultsForWallet", async () => {
    for (const { name, store } of stores) {
      const wallet = "PB" + name;
      const t0 = new Date("2026-09-14T00:00:00Z");
      const key = "run|fastest_5k|outdoor|device|elapsed|1";
      const d = (sourceId: string, value: bigint, status: "current" | "historical", isBaseline: boolean, previousSourceId: string | null) => ({ key, discipline: "run" as const, category: "fastest_5k", environment: "outdoor", verificationClass: "device", timingBasis: "elapsed", rulesMajor: 1, value, sourceKind: "workout" as const, sourceId, sourceRevision: 1, achievedAt: t0, status, isBaseline, previousSourceId });
      let rows = await store.syncPbRevisions(wallet, [d("a", 1_600_000n, "historical", true, null), d("b", 1_500_000n, "current", false, "a")], t0);
      const a = rows.find((r) => r.sourceId === "a")!;
      const b = rows.find((r) => r.sourceId === "b")!;
      expect([a.status, a.isBaseline, b.status, b.previousPbId === a.pbId], name).toEqual(["historical", true, "current", true]);
      // b 來源刪除 → invalidated；a 回 current；pb_id 不變
      rows = await store.syncPbRevisions(wallet, [d("a", 1_600_000n, "current", true, null)], t0);
      expect(rows.find((r) => r.sourceId === "b"), name).toMatchObject({ pbId: b.pbId, status: "invalidated", reason: "source_removed_or_corrected" });
      expect(rows.find((r) => r.sourceId === "a"), name).toMatchObject({ pbId: a.pbId, status: "current" });
      // b 重新出現 → 恢復
      rows = await store.syncPbRevisions(wallet, [d("a", 1_600_000n, "historical", true, null), d("b", 1_500_000n, "current", false, "a")], t0);
      expect(rows.find((r) => r.sourceId === "b"), name).toMatchObject({ pbId: b.pbId, status: "current", invalidatedAt: null });
      await store.upsertPlayer(wallet, t0);
      await store.deletePlayerData(wallet, t0, null);
      expect(await store.listPbRevisions(wallet), name).toEqual([]);
    }
  });
  it("achievements（R-08）：upsert 冪等、metadata 變更回 pending（minted 不動）、狀態轉移、依狀態列出、錢包刪除保留已鑄造", async () => {
    for (const { name, store } of stores) {
      const wallet = "AC" + name;
      const t0 = new Date("2026-09-14T00:00:00Z");
      const rows = await store.syncPbRevisions(wallet, [{ key: "run|longest_run|outdoor|device|elapsed|1", discipline: "run", category: "longest_run", environment: "outdoor", verificationClass: "device", timingBasis: "elapsed", rulesMajor: 1, value: 5_000_000n, sourceKind: "workout", sourceId: "s", sourceRevision: 1, achievedAt: t0, status: "current", isBaseline: true, previousSourceId: null }], t0);
      const pb = rows[0]!;
      const id = "a".repeat(64);
      const base = { achievementId: id, wallet, kind: "pb" as const, pbId: pb.pbId, milestoneKey: null, sourceKind: "workout" as const, sourceId: pb.sourceId, category: "longest_run", verificationClass: "device" as const, sourceRevision: 1, rulesMajor: 1, publicConsent: false, metadata: { name: "x" }, metadataHash: Buffer.alloc(32, 1), status: "pending_registry" as const, registrySignature: null, registryUpdatedAt: null, asset: null, mintedSignature: null, mintedAt: null };
      const a1 = await store.upsertAchievement(base, t0);
      expect(a1.status, name).toBe("pending_registry");
      await store.setAchievementStatus(id, "approved", { registrySignature: "sig1" }, t0);
      expect((await store.upsertAchievement(base, t0)).status, name).toBe("approved"); // 同 metadata → 不動
      expect((await store.upsertAchievement({ ...base, metadataHash: Buffer.alloc(32, 2), publicConsent: true }, t0)).status, name).toBe("pending_registry"); // metadata 變 → 回 pending
      await store.setAchievementStatus(id, "minted", { asset: "A", mintedSignature: "m" }, t0);
      expect((await store.upsertAchievement({ ...base, metadataHash: Buffer.alloc(32, 3) }, t0)), name).toMatchObject({ status: "minted", asset: "A" }); // minted 不改
      expect((await store.listAchievementsByStatus(["minted"], 10)).some((a) => a.achievementId === id), name).toBe(true);
      expect((await store.getAchievementByPb(pb.pbId))?.achievementId, name).toBe(id);
      await store.upsertPlayer(wallet, t0);
      await store.deletePlayerData(wallet, t0, null);
      expect((await store.listAchievements(wallet)).length, name).toBe(1); // 已鑄造保留
      expect((await store.listPbRevisions(wallet)).length, name).toBe(1); // 其 PB 列保留
      // PG-M-02：里程碑成就（pb_id 空、milestone_key 唯一）；setAchievementSource 只動來源；錢包刪除未鑄造者刪除、PB 刪除不受 NULL pb_id 影響
      const mid = "b".repeat(64);
      const ms = { ...base, achievementId: mid, kind: "milestone" as const, pbId: null, milestoneKey: "first_5k|outdoor|device", sourceKind: "workout" as const, sourceId: "w1", category: "first_5k", metadataHash: Buffer.alloc(32, 9) };
      const m1 = await store.upsertAchievement(ms, t0);
      expect([m1.kind, m1.pbId, m1.milestoneKey, m1.sourceId], name).toEqual(["milestone", null, "first_5k|outdoor|device", "w1"]);
      const m2 = await store.setAchievementSource(mid, { sourceKind: "workout", sourceId: "w0", sourceRevision: 2 }, t0);
      expect([m2?.sourceId, m2?.sourceRevision, m2?.status, m2?.metadataHash.equals(Buffer.alloc(32, 9))], name).toEqual(["w0", 2, "pending_registry", true]);
      await store.deletePlayerData(wallet, t0, null);
      expect((await store.listAchievements(wallet)).map((x) => x.achievementId), name).toEqual([id]); // 未鑄造里程碑刪除、已鑄造 PB 成就保留
      expect((await store.listPbRevisions(wallet)).length, name).toBe(1);
    }
  });
  it("gallery_prefs（R-09）：hidden 排除排行／計數／搜尋／名次，本人仍可 get；再顯示恢復；getAchievementByAsset", async () => {
    for (const { name, store } of stores) {
      const t0 = new Date("2026-09-14T00:00:00Z");
      const a = "GH" + name + "A";
      const b = "GH" + name + "B";
      await store.upsertGalleryPlayer({ wallet: a, shoeLevel: 3, coreLevel: 1, xp: 100n, streakDays: 0, maxStreakDays: 0, lastTaskDate: null, slot: 1 }, t0);
      await store.upsertGalleryPlayer({ wallet: b, shoeLevel: 2, coreLevel: 1, xp: 50n, streakDays: 0, maxStreakDays: 0, lastTaskDate: null, slot: 1 }, t0);
      const before = await store.countGalleryPlayers();
      await store.setGalleryHidden(a, true, t0);
      expect(await store.isGalleryHidden(a), name).toBe(true);
      expect(await store.countGalleryPlayers(), name).toBe(before - 1);
      expect((await store.listGalleryPlayers(100, 0)).some((p) => p.wallet === a), name).toBe(false);
      expect(await store.galleryRankOf(a), name).toBeNull();
      expect((await store.searchGalleryPlayers("GH" + name, 10)).map((p) => p.wallet), name).toEqual([b]);
      expect((await store.getGalleryPlayer(a))?.wallet, name).toBe(a);
      await store.setGalleryHidden(a, false, t0);
      expect(await store.galleryRankOf(a), name).not.toBeNull();
      expect(await store.getAchievementByAsset("NoSuchAsset"), name).toBeNull();
    }
  });
});
