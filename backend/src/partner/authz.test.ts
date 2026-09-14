/** PG-E-01：角色由 DB 推導；owner／staff（含 checkpoint 限定）／result_editor／publisher；撤銷與停權立即生效；近期登入；404 防枚舉。 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { ApiError } from "../errors.js";
import { MemoryStore } from "../store/memory.js";
import { PartnerAuthz } from "./authz.js";

const now = new Date("2026-09-14T06:00:00Z");
const code = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e instanceof ApiError ? `${e.statusCode}:${e.code}` : String(e); } };

async function world() {
  const store = new MemoryStore();
  const authz = new PartnerAuthz(store, () => now);
  const orgId = randomUUID();
  await store.createOrganization({ orgId, name: "Taipei Run Club", slug: "taipei-run", createdBy: "OWNER" }, now);
  await store.upsertMembership({ orgId, wallet: "OWNER", role: "owner", grantedBy: "OWNER" }, now);
  await store.upsertMembership({ orgId, wallet: "MEMBER", role: "member", grantedBy: "OWNER" }, now);
  const eventId = randomUUID();
  await store.createEvent({ eventId, orgId, slug: "river-5k", title: "River 5K", description: "", timezone: "Asia/Taipei", registrationOpensAt: null, registrationClosesAt: null, startsAt: null, endsAt: null, capacity: 100, tournamentAddress: null, createdBy: "OWNER" }, now);
  const cp1 = randomUUID(), cp2 = randomUUID();
  await store.upsertEventRole({ eventId, wallet: "STAFF1", role: "staff", checkpointId: cp1, grantedBy: "OWNER" }, now);
  await store.upsertEventRole({ eventId, wallet: "STAFFALL", role: "staff", checkpointId: null, grantedBy: "OWNER" }, now);
  await store.upsertEventRole({ eventId, wallet: "EDITOR", role: "result_editor", checkpointId: null, grantedBy: "OWNER" }, now);
  await store.upsertEventRole({ eventId, wallet: "PUB", role: "publisher", checkpointId: null, grantedBy: "OWNER" }, now);
  return { store, authz, orgId, eventId, cp1, cp2 };
}

describe("PartnerAuthz", () => {
  it("owner 全權；member 無權（404 防枚舉）；活動角色各司其職；staff 受 checkpoint 限定", async () => {
    const { authz, eventId, cp1, cp2 } = await world();
    expect((await authz.requireEventRole(eventId, "OWNER", ["publisher"])).isOwner).toBe(true);
    expect(await code(authz.requireEventRole(eventId, "MEMBER", ["staff"]))).toBe("404:NOT_FOUND");
    expect(await code(authz.requireEventRole(eventId, "NOBODY", ["staff"]))).toBe("404:NOT_FOUND");
    expect(await code(authz.requireEventRole(randomUUID(), "OWNER", ["staff"]))).toBe("404:NOT_FOUND");
    expect(await code(authz.requireEventRole(eventId, "EDITOR", ["result_editor"]))).toBeNull();
    expect(await code(authz.requireEventRole(eventId, "EDITOR", ["publisher"]))).toBe("403:ROLE_FORBIDDEN");
    expect(await code(authz.requireEventRole(eventId, "PUB", ["publisher"]))).toBeNull();
    expect(await code(authz.requireEventRole(eventId, "STAFF1", ["staff"], { checkpointId: cp1 }))).toBeNull();
    expect(await code(authz.requireEventRole(eventId, "STAFF1", ["staff"], { checkpointId: cp2 }))).toBe("403:ROLE_FORBIDDEN");
    expect(await code(authz.requireEventRole(eventId, "STAFFALL", ["staff"], { checkpointId: cp2 }))).toBeNull();
    const a = await authz.accessFor(eventId, "STAFF1");
    expect(a?.staffCheckpoints?.has(cp1)).toBe(true);
  });

  it("撤銷角色／成員與組織停權立即生效", async () => {
    const { store, authz, orgId, eventId } = await world();
    await store.revokeEventRole(eventId, "PUB", "publisher", now);
    expect(await code(authz.requireEventRole(eventId, "PUB", ["publisher"]))).toBe("404:NOT_FOUND");
    await store.revokeMembership(orgId, "OWNER", now);
    expect(await code(authz.requireEventRole(eventId, "OWNER", ["publisher"]))).toBe("404:NOT_FOUND");
    await store.upsertMembership({ orgId, wallet: "OWNER", role: "owner", grantedBy: "OWNER" }, now);
    expect(await code(authz.requireOrgOwner(orgId, "OWNER"))).toBeNull();
    store.orgs.get(orgId)!.suspendedAt = now;
    expect(await code(authz.requireOrgOwner(orgId, "OWNER"))).toBe("403:ROLE_FORBIDDEN");
    expect(await store.listMemberships("OWNER")).toEqual([]);
  });

  it("近期登入：30 分鐘內通過，超過 403", async () => {
    const { authz } = await world();
    const req = (loginAt: Date) => ({ auth: { wallet: "W", sessionJti: "j", loginAt }, id: "r1" }) as never;
    expect(() => authz.requireRecentLogin(req(new Date(now.getTime() - 10 * 60_000)))).not.toThrow();
    expect(() => authz.requireRecentLogin(req(new Date(now.getTime() - 31 * 60_000)))).toThrow(ApiError);
  });

  it("audit 記錄操作人、動作、目標與 request id", async () => {
    const { store, authz, eventId, orgId } = await world();
    await authz.audit({ auth: { wallet: "OWNER" }, id: "req-1" } as never, { eventId, orgId, action: "event.publish", revisionId: "rev-1", details: { version: 1 } });
    const logs = await store.listAudit(eventId, 10);
    expect(logs[0]).toMatchObject({ actorWallet: "OWNER", action: "event.publish", requestId: "req-1", revisionId: "rev-1" });
  });
});
