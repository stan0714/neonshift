import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { MemoryStore } from "../store/memory.js";
import { RetentionService } from "./service.js";

const uuid = () => randomUUID();

describe("PG-B-17 30 天保留清理（BR-25）", () => {
  it("刪除 30 天前的摘要（含判定）、attestation、idempotency、賽事步數；保留 30 天內；清過期 challenge／session", async () => {
    const store = new MemoryStore();
    const now = new Date("2026-10-15T00:00:00Z");
    const old = new Date("2026-09-10T00:00:00Z"); // 35 天前
    const recent = new Date("2026-10-01T00:00:00Z");
    const snap = (wallet: string, createdAt: Date) => store.insertHealthSnapshot({ wallet, taskDate: 1, taskType: 1, attributedSteps: 1, sleepMinutes: null, sourceSummary: [], stepRateSummary: null, sleepOverlapMinutes: null, sensorSummary: null, motionSummary: null, clientInfo: {}, inputHash: Buffer.alloc(32), createdAt });
    const s1 = await snap("A", old);
    const s2 = await snap("A", recent);
    await store.insertRiskDecision({ snapshotId: s1, rulesVersion: 3, riskScore: 0, matchedRules: [], decision: "pass", rejectCode: null });
    await store.insertRiskDecision({ snapshotId: s2, rulesVersion: 3, riskScore: 0, matchedRules: [], decision: "pass", rejectCode: null });
    await store.insertAttestation({ nonce: Buffer.alloc(16, 1), idempotencyKey: uuid(), requestHash: Buffer.alloc(32), wallet: "A", taskDate: 1, taskType: 1, rulesVersion: 3, evidenceHash: Buffer.alloc(32), issuedAt: old, expiresAt: old });
    await store.insertAttestation({ nonce: Buffer.alloc(16, 2), idempotencyKey: uuid(), requestHash: Buffer.alloc(32), wallet: "A", taskDate: 2, taskType: 1, rulesVersion: 3, evidenceHash: Buffer.alloc(32), issuedAt: recent, expiresAt: recent });
    await store.beginClaim("A", uuid(), Buffer.alloc(32), old);
    await store.beginClaim("A", uuid(), Buffer.alloc(32), recent);
    await store.upsertTournamentSteps(2026_36, "A", 100, old, old);
    await store.upsertTournamentSteps(2026_40, "A", 100, recent, recent);
    await store.insertChallenge({ nonceHash: Buffer.alloc(32, 3), wallet: "A", purpose: "login", requestHash: null, taskDate: null, taskType: null, expiresAt: new Date(now.getTime() - 1000), usedAt: null });
    await store.insertSession({ jti: "j1", familyId: "f", wallet: "A", refreshHash: Buffer.alloc(32, 4), expiresAt: new Date(now.getTime() - 1), usedAt: null, rotatedTo: null, revokedAt: null });
    await store.insertSession({ jti: "j2", familyId: "f", wallet: "A", refreshHash: Buffer.alloc(32, 5), expiresAt: new Date(now.getTime() + 86_400_000), usedAt: null, rotatedTo: null, revokedAt: null });

    const r = await new RetentionService(store, () => now).runOnce();
    expect(r.purged).toEqual({ snapshots: 1, attestations: 1, claimResults: 1, tournamentSteps: 1, challenges: 1, sessions: 1 });
    expect(r.cutoff).toBe("2026-09-15T00:00:00.000Z");
    expect(store.snapshots.map((s) => s.id)).toEqual([s2]);
    expect(store.decisions.map((d) => d.snapshotId)).toEqual([s2]);
    expect((await store.listHistory("A", 0)).map((h) => h.taskDate)).toEqual([2]);
    expect(await store.getTournamentSteps(2026_40, "A")).not.toBeNull();
    expect(store.sessions.has("j2")).toBe(true);
    // 再跑一次：無事可做
    expect(Object.values((await new RetentionService(store, () => now).runOnce()).purged).every((n) => n === 0)).toBe(true);
  });

  it("延後刪除到期才執行：到期前保留資料，到期後刪除並清 deletion_due_at", async () => {
    const store = new MemoryStore();
    const t0 = new Date("2026-10-01T00:00:00Z");
    await store.upsertPlayer("B", t0);
    await store.insertHealthSnapshot({ wallet: "B", taskDate: 1, taskType: 1, attributedSteps: 1, sleepMinutes: null, sourceSummary: [], stepRateSummary: null, sleepOverlapMinutes: null, sensorSummary: null, motionSummary: null, clientInfo: {}, inputHash: Buffer.alloc(32), createdAt: t0 });
    const due = new Date("2026-10-03T00:00:00Z");
    await store.deletePlayerData("B", t0, due);
    expect(store.snapshots).toHaveLength(1);
    let r = await new RetentionService(store, () => new Date("2026-10-02T00:00:00Z")).runOnce();
    expect(r.deferredDeletions).toEqual([]);
    expect(store.snapshots).toHaveLength(1);
    r = await new RetentionService(store, () => due).runOnce();
    expect(r.deferredDeletions).toEqual(["B"]);
    expect(store.snapshots).toHaveLength(0);
    expect(await store.listDueDeletions(new Date("2026-12-01T00:00:00Z"))).toEqual([]);
    expect((await store.getPlayer("B"))?.deletedAt).toEqual(t0);
  });
});
