/** PG-E-02 端到端：ops 建組織 → owner 建活動／編輯（樂觀鎖）→ 規則版本 → 發布／取消 → 角色 → 公開讀取不含內部資料；越權 403／404；近期登入。 */
import bs58 from "bs58";
import nacl from "tweetnacl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import type { Db } from "../db.js";
import { LocalKeypairSigner } from "../signer/index.js";
import { MemoryStore } from "../store/memory.js";

const db: Db = { pool: null, ping: async () => false, close: async () => {} };
let app: ReturnType<typeof buildApp>;
let store: MemoryStore;
let clock: Date;
const OPS = { authorization: "Bearer ops-token-for-tests-0001" };

beforeEach(async () => {
  store = new MemoryStore();
  clock = new Date("2026-09-14T06:00:00Z");
  app = buildApp({ config: loadConfig({ NODE_ENV: "test", OPS_TOKEN: "ops-token-for-tests-0001" }), db, store, now: () => clock, signer: LocalKeypairSigner.random() });
  await app.ready();
});
afterEach(async () => app.close());

async function login() {
  const kp = nacl.sign.keyPair();
  const wallet = bs58.encode(kp.publicKey);
  const n = (await app.inject({ method: "POST", url: "/v1/auth/nonce", payload: { wallet } })).json();
  const sig = Buffer.from(nacl.sign.detached(new TextEncoder().encode(n.message), kp.secretKey)).toString("base64");
  const v = (await app.inject({ method: "POST", url: "/v1/auth/verify", payload: { message: n.message, signature_b64: sig } })).json();
  return { wallet, h: { authorization: `Bearer ${v.access_token as string}` } };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const j = (r: { json: () => unknown }) => r.json() as Record<string, any>;

async function orgWithOwner() {
  const owner = await login();
  const org = j(await app.inject({ method: "POST", url: "/v1/partner/orgs", headers: OPS, payload: { name: "Taipei Run Club", slug: "taipei-run", owner_wallet: owner.wallet } }));
  return { owner, orgId: org.org_id as string };
}
const draft = (orgId: string, over: Record<string, unknown> = {}) => ({ org_id: orgId, slug: "river-5k", title: "River 5K", timezone: "Asia/Taipei", starts_at: "2026-10-03T00:00:00Z", ends_at: "2026-10-03T04:00:00Z", capacity: 100, ...over });

describe("PG-E-02 partner API", () => {
  it("組織建立需 OPS_TOKEN；owner 建活動、樂觀鎖編輯、規則版本、發布（需 revision_id 與時間）、公開讀取不含內部欄位", async () => {
    expect((await app.inject({ method: "POST", url: "/v1/partner/orgs", payload: {} })).statusCode).toBe(401);
    const { owner, orgId } = await orgWithOwner();
    expect(j(await app.inject({ method: "GET", url: "/v1/partner/me", headers: owner.h })).organizations).toEqual([{ org_id: orgId, role: "owner", name: "Taipei Run Club" }]);

    let res = await app.inject({ method: "POST", url: "/v1/partner/events", headers: owner.h, payload: draft(orgId) });
    expect(res.statusCode).toBe(201);
    const ev = j(res);
    expect(ev.state).toBe("draft");
    expect((await app.inject({ method: "POST", url: "/v1/partner/events", headers: owner.h, payload: draft(orgId) })).json().error.code).toBe("SLUG_TAKEN");
    // 草稿不公開
    expect((await app.inject({ method: "GET", url: `/v1/events/${ev.event_id}` })).statusCode).toBe(404);

    // 樂觀鎖
    res = await app.inject({ method: "PATCH", url: `/v1/partner/events/${ev.event_id}`, headers: owner.h, payload: { revision: 1, title: "River 5K · Autumn", capacity: 150 } });
    expect(res.statusCode).toBe(200);
    expect([j(res).title, j(res).revision]).toEqual(["River 5K · Autumn", 2]);
    expect((await app.inject({ method: "PATCH", url: `/v1/partner/events/${ev.event_id}`, headers: owner.h, payload: { revision: 1, title: "stale" } })).json().error.code).toBe("REVISION_CONFLICT");

    // 發布前需規則版本
    res = await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/rule-revisions`, headers: owner.h, payload: { rules: { distance_m: 5000, cutoff_minutes: 60 } } });
    expect(res.statusCode).toBe(201);
    const rev = j(res);
    expect(rev.version).toBe(1);
    expect(rev.rules_hash).toHaveLength(64);
    res = await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/publish`, headers: owner.h, payload: { revision_id: rev.revision_id } });
    expect(res.statusCode).toBe(200);
    expect(j(res).state).toBe("published");

    // 公開讀取：含規則、不含 org_id／created_by／revision
    res = await app.inject({ method: "GET", url: `/v1/events/river-5k` });
    expect(res.statusCode).toBe(200);
    const pub = j(res);
    expect(pub.rules).toMatchObject({ version: 1, rules: { distance_m: 5000 } });
    expect(pub.spots_left).toBe(150);
    expect(pub).not.toHaveProperty("org_id");
    expect(pub).not.toHaveProperty("created_by");
    expect(j(await app.inject({ method: "GET", url: `/v1/events` })).events).toHaveLength(1);

    // 稽核
    const audit = j(await app.inject({ method: "GET", url: `/v1/partner/events/${ev.event_id}/audit`, headers: owner.h })).entries as { action: string }[];
    expect(audit.map((a) => a.action)).toEqual(["event.publish", "rules.create", "event.update", "event.create"]);

    // 取消需原因；取消後不可編輯
    expect((await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/cancel`, headers: owner.h, payload: { reason: "x" } })).statusCode).toBe(422);
    res = await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/cancel`, headers: owner.h, payload: { reason: "Typhoon warning" } });
    expect(j(res).state).toBe("cancelled");
    expect(j(await app.inject({ method: "GET", url: `/v1/events/river-5k` })).cancel_reason).toBe("Typhoon warning");
    expect((await app.inject({ method: "PATCH", url: `/v1/partner/events/${ev.event_id}`, headers: owner.h, payload: { revision: 4, title: "x" } })).json().error.code).toBe("EVENT_CANCELLED");
  });

  it("角色：非成員 404、publisher 可發布但不能編輯、staff 不能發布；成員撤銷；不可撤銷自己", async () => {
    const { owner, orgId } = await orgWithOwner();
    const ev = j(await app.inject({ method: "POST", url: "/v1/partner/events", headers: owner.h, payload: draft(orgId) }));
    const rev = j(await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/rule-revisions`, headers: owner.h, payload: { rules: {} } }));
    const stranger = await login();
    expect((await app.inject({ method: "GET", url: `/v1/partner/events/${ev.event_id}`, headers: stranger.h })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/publish`, headers: stranger.h, payload: { revision_id: rev.revision_id } })).statusCode).toBe(404);

    const pub = await login();
    const staff = await login();
    expect((await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/roles`, headers: owner.h, payload: { wallet: pub.wallet, role: "publisher" } })).statusCode).toBe(204);
    expect((await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/roles`, headers: owner.h, payload: { wallet: staff.wallet, role: "staff" } })).statusCode).toBe(204);
    expect(j(await app.inject({ method: "GET", url: `/v1/partner/events/${ev.event_id}`, headers: pub.h })).your_roles).toEqual(["publisher"]);
    expect((await app.inject({ method: "PATCH", url: `/v1/partner/events/${ev.event_id}`, headers: pub.h, payload: { revision: 1, title: "x" } })).json().error.code).toBe("ROLE_FORBIDDEN");
    expect((await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/publish`, headers: staff.h, payload: { revision_id: rev.revision_id } })).json().error.code).toBe("ROLE_FORBIDDEN");
    expect((await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/publish`, headers: pub.h, payload: { revision_id: rev.revision_id } })).statusCode).toBe(200);
    // 撤銷 publisher → 404
    expect((await app.inject({ method: "DELETE", url: `/v1/partner/events/${ev.event_id}/roles/${pub.wallet}/publisher`, headers: owner.h })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: `/v1/partner/events/${ev.event_id}`, headers: pub.h })).statusCode).toBe(404);
    // 成員
    const other = await login();
    expect((await app.inject({ method: "POST", url: `/v1/partner/orgs/${orgId}/members`, headers: owner.h, payload: { wallet: other.wallet, role: "owner" } })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: `/v1/partner/orgs/${orgId}/events`, headers: other.h })).statusCode).toBe(200);
    expect((await app.inject({ method: "DELETE", url: `/v1/partner/orgs/${orgId}/members/${owner.wallet}`, headers: owner.h })).json().error.code).toBe("LAST_OWNER");
    expect((await app.inject({ method: "DELETE", url: `/v1/partner/orgs/${orgId}/members/${other.wallet}`, headers: owner.h })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: `/v1/partner/orgs/${orgId}/events`, headers: other.h })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/v1/partner/orgs/${orgId}/members`, headers: stranger.h, payload: { wallet: other.wallet, role: "member" } })).statusCode).toBe(403);
  });

  it("近期登入：登入超過 30 分鐘後發布／權限變更被拒（RECENT_LOGIN_REQUIRED），讀取不受影響", async () => {
    const { owner, orgId } = await orgWithOwner();
    const ev = j(await app.inject({ method: "POST", url: "/v1/partner/events", headers: owner.h, payload: draft(orgId) }));
    const rev = j(await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/rule-revisions`, headers: owner.h, payload: { rules: {} } }));
    clock = new Date(clock.getTime() + 10 * 60_000); // access 仍有效（15 分鐘）
    expect((await app.inject({ method: "GET", url: `/v1/partner/events/${ev.event_id}`, headers: owner.h })).statusCode).toBe(200);
    // 模擬 family 起點在 40 分鐘前：把所有 session 到期時間往前調
    for (const s of store.sessions.values()) s.expiresAt = new Date(s.expiresAt.getTime() - 40 * 60_000);
    const r = await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/publish`, headers: owner.h, payload: { revision_id: rev.revision_id } });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe("RECENT_LOGIN_REQUIRED");
  });

  it("報名：需接受目前規則版本、容量原子、重複回 already、取消釋放名額、窗口與宣傳來源統計", async () => {
    const { owner, orgId } = await orgWithOwner();
    const ev = j(await app.inject({ method: "POST", url: "/v1/partner/events", headers: owner.h, payload: draft(orgId, { capacity: 2, registration_closes_at: "2026-10-02T00:00:00Z" }) }));
    const rev = j(await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/rule-revisions`, headers: owner.h, payload: { rules: { distance_m: 5000 } } }));
    const a = await login();
    // 未發布 → 404
    expect((await app.inject({ method: "POST", url: `/v1/events/${ev.event_id}/registrations`, headers: a.h, payload: { accepted_rule_revision: rev.revision_id } })).statusCode).toBe(404);
    await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/publish`, headers: owner.h, payload: { revision_id: rev.revision_id } });
    // 舊規則版本 → 409
    const rev2 = j(await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/rule-revisions`, headers: owner.h, payload: { rules: { distance_m: 5100 } } }));
    await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/publish`, headers: owner.h, payload: { revision_id: rev2.revision_id } });
    expect((await app.inject({ method: "POST", url: `/v1/events/${ev.event_id}/registrations`, headers: a.h, payload: { accepted_rule_revision: rev.revision_id } })).json().error.code).toBe("REVISION_CONFLICT");
    // 報名（含宣傳來源）
    let r = await app.inject({ method: "POST", url: `/v1/events/river-5k/registrations?source=ig_story`, headers: a.h, payload: { accepted_rule_revision: rev2.revision_id, display_name: "Alice", public_consent: true } });
    expect(r.statusCode).toBe(201);
    expect(j(r).registration).toMatchObject({ status: "registered", display_name: "Alice", public_consent: true });
    r = await app.inject({ method: "POST", url: `/v1/events/${ev.event_id}/registrations`, headers: a.h, payload: { accepted_rule_revision: rev2.revision_id } });
    expect([r.statusCode, j(r).already]).toEqual([200, true]);
    const b = await login();
    const c = await login();
    expect((await app.inject({ method: "POST", url: `/v1/events/${ev.event_id}/registrations`, headers: b.h, payload: { accepted_rule_revision: rev2.revision_id } })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: `/v1/events/${ev.event_id}/registrations`, headers: c.h, payload: { accepted_rule_revision: rev2.revision_id } })).json().error.code).toBe("EVENT_FULL");
    expect(j(await app.inject({ method: "GET", url: `/v1/events/river-5k?source=ig_story` })).spots_left).toBe(0);
    // 取消釋放名額；再報名復用
    expect((await app.inject({ method: "DELETE", url: `/v1/events/${ev.event_id}/registration`, headers: b.h })).statusCode).toBe(204);
    expect((await app.inject({ method: "DELETE", url: `/v1/events/${ev.event_id}/registration`, headers: b.h })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/v1/events/${ev.event_id}/registrations`, headers: c.h, payload: { accepted_rule_revision: rev2.revision_id } })).statusCode).toBe(201);
    // 隱私更新與歷史
    expect(j(await app.inject({ method: "PATCH", url: `/v1/events/${ev.event_id}/registration/privacy`, headers: a.h, payload: { public_consent: false } })).registration.public_consent).toBe(false);
    const hist = j(await app.inject({ method: "GET", url: `/v1/me/event-history`, headers: b.h })).items;
    expect(hist).toHaveLength(1);
    expect(hist[0].registration.status).toBe("cancelled");
    // 宣傳彙總（owner）
    const sum = j(await app.inject({ method: "GET", url: `/v1/partner/events/${ev.event_id}/campaign-summary`, headers: owner.h }));
    expect(sum.by_source.ig_story).toMatchObject({ views: 1, registrations: 1 });
    expect(sum.by_source.direct.registrations).toBe(2);
    expect((await app.inject({ method: "GET", url: `/v1/partner/events/${ev.event_id}/campaign-summary`, headers: a.h })).statusCode).toBe(404);
    // 報名截止後 409
    clock = new Date("2026-10-02T00:00:01Z");
    const d = await login();
    expect((await app.inject({ method: "POST", url: `/v1/events/${ev.event_id}/registrations`, headers: d.h, payload: { accepted_rule_revision: rev2.revision_id } })).json().error.code).toBe("EVENT_NOT_OPEN");
  });
});
