/** PG-E-02 端到端：ops 建組織 → owner 建活動／編輯（樂觀鎖）→ 規則版本 → 發布／取消 → 角色 → 公開讀取不含內部資料；越權 403／404；近期登入。 */
import bs58 from "bs58";
import nacl from "tweetnacl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import type { Db } from "../db.js";
import { RetentionService } from "../retention/service.js";
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
  return loginAs(nacl.sign.keyPair());
}
async function loginAs(kp: nacl.SignKeyPair) {
  const wallet = bs58.encode(kp.publicKey);
  const n = (await app.inject({ method: "POST", url: "/v1/auth/nonce", payload: { wallet } })).json();
  const sig = Buffer.from(nacl.sign.detached(new TextEncoder().encode(n.message), kp.secretKey)).toString("base64");
  const v = (await app.inject({ method: "POST", url: "/v1/auth/verify", payload: { message: n.message, signature_b64: sig } })).json();
  const out = {
    wallet,
    h: { authorization: `Bearer ${v.access_token as string}` },
    refresh: v.refresh_token as string,
    /** access token 15 分鐘；測試推進時鐘後用 refresh 換新 token（session family 不變，登入時間也不變） */
    renew: async () => {
      const r = (await app.inject({ method: "POST", url: "/v1/auth/refresh", payload: { refresh_token: out.refresh } })).json();
      out.h = { authorization: `Bearer ${r.access_token as string}` };
      out.refresh = r.refresh_token as string;
    },
    kp,
  };
  return out;
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

  it("站點與 NFC 載具：owner 建站點；staff 登記／停用載具（含 checkpoint 限定）；參加者查 tag 狀態不含內部資料；補發停用舊載具", async () => {
    const { owner, orgId } = await orgWithOwner();
    const ev = j(await app.inject({ method: "POST", url: "/v1/partner/events", headers: owner.h, payload: draft(orgId) }));
    const rev = j(await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/rule-revisions`, headers: owner.h, payload: { rules: {} } }));
    await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/publish`, headers: owner.h, payload: { revision_id: rev.revision_id } });
    const cp = j(await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/checkpoints`, headers: owner.h, payload: { name: "Start gate", purpose: "check_in" } }));
    const cp2 = j(await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/checkpoints`, headers: owner.h, payload: { name: "Booth", purpose: "redemption" } }));
    const staff = await login();
    await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/roles`, headers: owner.h, payload: { wallet: staff.wallet, role: "staff", checkpoint_id: cp.checkpoint_id } });
    // staff 只能為授權站點登記
    expect((await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/tags`, headers: staff.h, payload: { purpose: "checkpoint", checkpoint_id: cp2.checkpoint_id } })).json().error.code).toBe("ROLE_FORBIDDEN");
    const issued = j(await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/tags`, headers: staff.h, payload: { purpose: "checkpoint", checkpoint_id: cp.checkpoint_id, quantity: 2 } }));
    expect(issued.tags).toHaveLength(2);
    expect(issued.tags[0].uri).toMatch(new RegExp(`^https://neonshift.cc/e/river-5k\\?tag=[A-Za-z0-9_-]{32}$`));
    // 參加者查 tag
    const p = await login();
    await app.inject({ method: "POST", url: `/v1/events/${ev.event_id}/registrations`, headers: p.h, payload: { accepted_rule_revision: rev.revision_id } });
    let st = j(await app.inject({ method: "GET", url: `/v1/events/river-5k/tags/${issued.tags[0].opaque_ref}`, headers: p.h }));
    expect(st).toEqual({ status: "active", purpose: "checkpoint", checkpoint: { checkpoint_id: cp.checkpoint_id, name: "Start gate", purpose: "check_in" }, registered: true, event_state: "published" });
    expect((await app.inject({ method: "GET", url: `/v1/events/river-5k/tags/nope`, headers: p.h })).statusCode).toBe(404);
    // 停用
    expect((await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/tags/${issued.tags[0].tag_id}/revoke`, headers: staff.h })).statusCode).toBe(204);
    expect(j(await app.inject({ method: "GET", url: `/v1/events/river-5k/tags/${issued.tags[0].opaque_ref}`, headers: p.h })).status).toBe("revoked");
    // 參加者載具：他人感應 → not_yours；補發停用舊的
    const t1 = j(await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/tags`, headers: owner.h, payload: { purpose: "participant", participant_wallet: p.wallet } })).tags[0];
    const other = await login();
    expect(j(await app.inject({ method: "GET", url: `/v1/events/river-5k/tags/${t1.opaque_ref}`, headers: other.h })).status).toBe("not_yours");
    const t2 = j(await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/tags`, headers: owner.h, payload: { purpose: "participant", participant_wallet: p.wallet } })).tags[0];
    expect(j(await app.inject({ method: "GET", url: `/v1/events/river-5k/tags/${t1.opaque_ref}`, headers: p.h })).status).toBe("revoked");
    expect(j(await app.inject({ method: "GET", url: `/v1/events/river-5k/tags/${t2.opaque_ref}`, headers: p.h })).status).toBe("active");
    // 未報名錢包不可登記參加者載具
    expect((await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/tags`, headers: owner.h, payload: { purpose: "participant", participant_wallet: other.wallet } })).json().error.code).toBe("NOT_ELIGIBLE");
  });

  it("報到：參加者取 120 秒代碼 → staff 於授權站點確認（原子消耗、冪等、名單）；過期／重用／錯站點拒絕；手動補登需理由與近期登入", async () => {
    const { owner, orgId } = await orgWithOwner();
    const ev = j(await app.inject({ method: "POST", url: "/v1/partner/events", headers: owner.h, payload: draft(orgId) }));
    const rev = j(await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/rule-revisions`, headers: owner.h, payload: { rules: {} } }));
    await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/publish`, headers: owner.h, payload: { revision_id: rev.revision_id } });
    const gate = j(await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/checkpoints`, headers: owner.h, payload: { name: "Gate", purpose: "check_in" } }));
    const booth = j(await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/checkpoints`, headers: owner.h, payload: { name: "Booth", purpose: "redemption" } }));
    const staff = await login();
    await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/roles`, headers: owner.h, payload: { wallet: staff.wallet, role: "staff", checkpoint_id: gate.checkpoint_id } });
    const p = await login();
    // 未報名不可取 challenge
    expect((await app.inject({ method: "POST", url: `/v1/events/${ev.event_id}/check-in-challenges`, headers: p.h, payload: { checkpoint_id: gate.checkpoint_id } })).statusCode).toBe(403);
    await app.inject({ method: "POST", url: `/v1/events/${ev.event_id}/registrations`, headers: p.h, payload: { accepted_rule_revision: rev.revision_id, display_name: "Alice" } });
    expect((await app.inject({ method: "POST", url: `/v1/events/${ev.event_id}/check-in-challenges`, headers: p.h, payload: { checkpoint_id: booth.checkpoint_id } })).statusCode).toBe(422);
    const ch = j(await app.inject({ method: "POST", url: `/v1/events/${ev.event_id}/check-in-challenges`, headers: p.h, payload: { checkpoint_id: gate.checkpoint_id } }));
    expect(ch.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(ch.qr_payload).toBe(`neonshift-checkin:river-5k:${ch.code}`);
    // 錯站點（staff 未授權 booth）→ 403；staff 用 gate 確認
    expect((await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/check-ins`, headers: staff.h, payload: { code: ch.code, checkpoint_id: booth.checkpoint_id } })).json().error.code).toBe("ROLE_FORBIDDEN");
    let r = await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/check-ins`, headers: staff.h, payload: { code: ch.qr_payload, checkpoint_id: gate.checkpoint_id, method: "qr" } });
    expect(r.statusCode).toBe(201);
    expect(j(r)).toMatchObject({ wallet: p.wallet, display_name: "Alice", already: false });
    // 代碼已消耗 → 410
    expect((await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/check-ins`, headers: staff.h, payload: { code: ch.code, checkpoint_id: gate.checkpoint_id } })).statusCode).toBe(410);
    // 參加者狀態與歷史
    expect(j(await app.inject({ method: "GET", url: `/v1/events/${ev.event_id}/registration`, headers: p.h })).registration.status).toBe("checked_in");
    expect(j(await app.inject({ method: "GET", url: `/v1/me/event-history`, headers: p.h })).items[0].check_ins).toHaveLength(1);
    // 再取一次代碼、再確認 → 冪等 200 already
    const ch2 = j(await app.inject({ method: "POST", url: `/v1/events/${ev.event_id}/check-in-challenges`, headers: p.h, payload: { checkpoint_id: gate.checkpoint_id } }));
    r = await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/check-ins`, headers: staff.h, payload: { code: ch2.code, checkpoint_id: gate.checkpoint_id } });
    expect([r.statusCode, j(r).already]).toEqual([200, true]);
    // 過期
    const ch3 = j(await app.inject({ method: "POST", url: `/v1/events/${ev.event_id}/check-in-challenges`, headers: p.h, payload: { checkpoint_id: gate.checkpoint_id } }));
    clock = new Date(clock.getTime() + 121_000);
    expect((await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/check-ins`, headers: staff.h, payload: { code: ch3.code, checkpoint_id: gate.checkpoint_id } })).statusCode).toBe(410);
    // 手動補登：需理由；非名單 403
    const q = await login();
    expect((await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/check-ins`, headers: staff.h, payload: { wallet: q.wallet, checkpoint_id: gate.checkpoint_id, method: "manual" } })).statusCode).toBe(422);
    expect((await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/check-ins`, headers: staff.h, payload: { wallet: q.wallet, checkpoint_id: gate.checkpoint_id, method: "manual", reason: "phone died" } })).statusCode).toBe(403);
    await app.inject({ method: "POST", url: `/v1/events/${ev.event_id}/registrations`, headers: q.h, payload: { accepted_rule_revision: rev.revision_id } });
    expect((await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/check-ins`, headers: staff.h, payload: { wallet: q.wallet, checkpoint_id: gate.checkpoint_id, method: "manual", reason: "phone died" } })).statusCode).toBe(201);
    const list = j(await app.inject({ method: "GET", url: `/v1/partner/events/${ev.event_id}/check-ins`, headers: staff.h })).check_ins;
    expect(list.map((c: { method: string }) => c.method).sort()).toEqual(["manual", "qr"]);
    const audit = j(await app.inject({ method: "GET", url: `/v1/partner/events/${ev.event_id}/audit`, headers: owner.h })).entries as { action: string; details: { reason?: string } }[];
    expect(audit.find((a) => a.action === "checkin.confirm" && a.details.reason === "phone died")).toBeTruthy();
  });
  it("核銷：owner 建品項；未報到不可預留；預留冪等、每人上限、庫存原子；staff 交付一次、重試回 already、逾期 410；數位徽章直接發放；取消活動釋放預留", async () => {
    const { owner, orgId } = await orgWithOwner();
    const ev = j(await app.inject({ method: "POST", url: "/v1/partner/events", headers: owner.h, payload: draft(orgId) }));
    const rev = j(await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/rule-revisions`, headers: owner.h, payload: { rules: {} } }));
    await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/publish`, headers: owner.h, payload: { revision_id: rev.revision_id } });
    const gate = j(await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/checkpoints`, headers: owner.h, payload: { name: "Gate", purpose: "check_in" } }));
    const staff = await login();
    await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/roles`, headers: owner.h, payload: { wallet: staff.wallet, role: "staff" } });
    // staff 不能建品項；owner 建兩種品項
    expect((await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/benefits`, headers: staff.h, payload: { kind: "physical", name: "Towel", stock_total: 2 } })).statusCode).toBe(403);
    const towel = j(await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/benefits`, headers: owner.h, payload: { kind: "physical", name: "Towel", stock_total: 2, per_person_limit: 1 } }));
    const badge = j(await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/benefits`, headers: owner.h, payload: { kind: "digital_badge", name: "Finisher badge", stock_total: 100, requires_checkin: false } }));
    const pub = j(await app.inject({ method: "GET", url: `/v1/events/river-5k/benefits` })).benefits as Record<string, unknown>[];
    expect(pub.map((b) => b.name).sort()).toEqual(["Finisher badge", "Towel"]);
    expect(Object.keys(pub[0]!)).not.toContain("reserved_count");

    const a = await login();
    const key = "11111111-1111-4111-8111-111111111111";
    // 未報名 403 → 報名後未報到（requires_checkin）403 CHECKIN_REQUIRED
    expect(j(await app.inject({ method: "POST", url: `/v1/events/${ev.event_id}/redemptions`, headers: a.h, payload: { benefit_id: towel.benefit_id, idempotency_key: key } })).error.code).toBe("NOT_ELIGIBLE");
    await app.inject({ method: "POST", url: `/v1/events/${ev.event_id}/registrations`, headers: a.h, payload: { accepted_rule_revision: rev.revision_id } });
    expect(j(await app.inject({ method: "POST", url: `/v1/events/${ev.event_id}/redemptions`, headers: a.h, payload: { benefit_id: towel.benefit_id, idempotency_key: key } })).error.code).toBe("CHECKIN_REQUIRED");
    // 數位徽章不需報到：直接 fulfilled 並附憑證
    const bd = await app.inject({ method: "POST", url: `/v1/events/${ev.event_id}/redemptions`, headers: a.h, payload: { benefit_id: badge.benefit_id, idempotency_key: "22222222-2222-4222-8222-222222222222" } });
    expect(bd.statusCode).toBe(201);
    expect(j(bd)).toMatchObject({ status: "fulfilled", claim_code: null });
    expect(j(bd).credential_id).toMatch(/^badge_/);
    // 報到後預留實體品項；同 key 冪等 200；每人上限 1 → 第二筆 409
    const ch = j(await app.inject({ method: "POST", url: `/v1/events/${ev.event_id}/check-in-challenges`, headers: a.h, payload: { checkpoint_id: gate.checkpoint_id } }));
    await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/check-ins`, headers: staff.h, payload: { code: ch.code, checkpoint_id: gate.checkpoint_id } });
    let r = await app.inject({ method: "POST", url: `/v1/events/${ev.event_id}/redemptions`, headers: a.h, payload: { benefit_id: towel.benefit_id, idempotency_key: key } });
    expect(r.statusCode).toBe(201);
    const res = j(r);
    expect(res.status).toBe("reserved");
    expect(res.claim_code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    r = await app.inject({ method: "POST", url: `/v1/events/${ev.event_id}/redemptions`, headers: a.h, payload: { benefit_id: towel.benefit_id, idempotency_key: key } });
    expect([r.statusCode, j(r).redemption_id]).toEqual([200, res.redemption_id]);
    expect(j(await app.inject({ method: "POST", url: `/v1/events/${ev.event_id}/redemptions`, headers: a.h, payload: { benefit_id: towel.benefit_id, idempotency_key: "33333333-3333-4333-8333-333333333333" } })).error.code).toBe("BENEFIT_LIMIT_REACHED");
    // 庫存 2：b 預留第 2 個；c 預留 → 售罄（預留量也算）
    const reg = async () => {
      const u = await login();
      await app.inject({ method: "POST", url: `/v1/events/${ev.event_id}/registrations`, headers: u.h, payload: { accepted_rule_revision: rev.revision_id } });
      const c = j(await app.inject({ method: "POST", url: `/v1/events/${ev.event_id}/check-in-challenges`, headers: u.h, payload: { checkpoint_id: gate.checkpoint_id } }));
      await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/check-ins`, headers: staff.h, payload: { code: c.code, checkpoint_id: gate.checkpoint_id } });
      return u;
    };
    const b = await reg();
    const c = await reg();
    const rb = j(await app.inject({ method: "POST", url: `/v1/events/${ev.event_id}/redemptions`, headers: b.h, payload: { benefit_id: towel.benefit_id, idempotency_key: key } }));
    expect(rb.status).toBe("reserved");
    expect(j(await app.inject({ method: "POST", url: `/v1/events/${ev.event_id}/redemptions`, headers: c.h, payload: { benefit_id: towel.benefit_id, idempotency_key: key } })).error.code).toBe("BENEFIT_OUT_OF_STOCK");
    // staff 交付 a（代碼、可帶 QR 前綴）→ 201；重試 200 already；對帳 fulfilled 1 reserved 1
    r = await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/redemptions/fulfill`, headers: staff.h, payload: { claim_code: `neonshift-redeem:river-5k:${res.claim_code.toLowerCase()}` } });
    expect([r.statusCode, j(r).already, j(r).status]).toEqual([201, false, "fulfilled"]);
    r = await app.inject({ method: "POST", url: `/v1/partner/redemptions/${res.redemption_id}/fulfill`, headers: staff.h, payload: {} });
    expect([r.statusCode, j(r).already]).toEqual([200, true]);
    let recon = j(await app.inject({ method: "GET", url: `/v1/partner/events/${ev.event_id}/redemptions`, headers: staff.h }));
    expect(recon.counts).toEqual({ reserved: 1, fulfilled: 2, expired: 0, cancelled: 0 }); // 含數位徽章
    expect(recon.redemptions.find((x: { redemption_id: string }) => x.redemption_id === res.redemption_id).fulfilled_by).toBe(staff.wallet);
    // b 的預留逾期（15 分鐘）→ 交付 410；庫存釋放後 c 可預留
    clock = new Date(clock.getTime() + 16 * 60_000);
    await Promise.all([staff.renew(), c.renew(), b.renew(), a.renew(), owner.renew()]);
    expect((await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/redemptions/fulfill`, headers: staff.h, payload: { claim_code: rb.claim_code } })).statusCode).toBe(410);
    const inv = j(await app.inject({ method: "GET", url: `/v1/partner/events/${ev.event_id}/benefits`, headers: staff.h })).benefits.find((x: { benefit_id: string }) => x.benefit_id === towel.benefit_id);
    expect(inv).toMatchObject({ reserved_count: 0, fulfilled_count: 1, remaining: 1 });
    const rc = j(await app.inject({ method: "POST", url: `/v1/events/${ev.event_id}/redemptions`, headers: c.h, payload: { benefit_id: towel.benefit_id, idempotency_key: key } }));
    expect(rc.status).toBe("reserved");
    // 不存在的代碼 404；未知 redemption 404
    expect((await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/redemptions/fulfill`, headers: staff.h, payload: { claim_code: "ZZZZZZZZ" } })).statusCode).toBe(404);
    // 參加者歷史含 redemptions；a 的 towel 已交付、badge 已發
    const hist = j(await app.inject({ method: "GET", url: `/v1/me/event-history`, headers: a.h })).items[0].redemptions as { status: string }[];
    expect(hist.map((x) => x.status).sort()).toEqual(["fulfilled", "fulfilled"]);
    // 取消活動：c 的預留 → cancelled（釋放）；已交付不動；取消後不可再預留
    await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/cancel`, headers: owner.h, payload: { reason: "Typhoon" } });
    recon = j(await app.inject({ method: "GET", url: `/v1/partner/events/${ev.event_id}/redemptions`, headers: staff.h }));
    expect(recon.counts).toEqual({ reserved: 0, fulfilled: 2, expired: 1, cancelled: 1 });
    expect(j(await app.inject({ method: "POST", url: `/v1/events/${ev.event_id}/redemptions`, headers: b.h, payload: { benefit_id: towel.benefit_id, idempotency_key: "44444444-4444-4444-8444-444444444444" } })).error.code).toBe("EVENT_CANCELLED");
    expect((await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/redemptions/fulfill`, headers: staff.h, payload: { claim_code: rc.claim_code } })).statusCode).toBe(409);
  });
  it("成績：result_editor 上傳 CSV staging（逐列錯誤、預覽、不發布）→ publisher 發布（需近期登入、無錯誤）→ 更正需原因並串前版 → 公開榜只回同意者且 DNF 另列 → 個人成績冊含歷史", async () => {
    const { owner, orgId } = await orgWithOwner();
    const ev = j(await app.inject({ method: "POST", url: "/v1/partner/events", headers: owner.h, payload: draft(orgId) }));
    const rev = j(await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/rule-revisions`, headers: owner.h, payload: { rules: {} } }));
    await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/publish`, headers: owner.h, payload: { revision_id: rev.revision_id } });
    const editor = await login();
    const publisher = await login();
    await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/roles`, headers: owner.h, payload: { wallet: editor.wallet, role: "result_editor" } });
    await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/roles`, headers: owner.h, payload: { wallet: publisher.wallet, role: "publisher" } });
    const a = await login(); // 同意公開，顯示名稱 Alice
    const b = await login(); // 未同意
    await app.inject({ method: "POST", url: `/v1/events/${ev.event_id}/registrations`, headers: a.h, payload: { accepted_rule_revision: rev.revision_id, display_name: "Alice", public_consent: true } });
    await app.inject({ method: "POST", url: `/v1/events/${ev.event_id}/registrations`, headers: b.h, payload: { accepted_rule_revision: rev.revision_id, display_name: "Bob" } });
    const HEAD = "participant_ref,discipline,division,finish_status,distance_m,elapsed_ms,rank";
    // 有錯誤列（未知選手）→ 201 staging 但 error_count 1；發布被拒
    let imp = j(await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/result-imports`, headers: editor.h, payload: { csv: [HEAD, `${a.wallet},run,,finished,5000,1500000,1`, `Cxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx,run,,finished,5000,1,2`].join("\n") } }));
    expect(imp).toMatchObject({ import_version: 1, row_count: 1, error_count: 1 });
    expect(imp.errors[0]).toMatchObject({ line: 3, field: "participant_ref" });
    expect((await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/result-imports/${imp.import_id}/publish`, headers: publisher.h, payload: {} })).json().error.code).toBe("RESULTS_HAVE_ERRORS");
    // editor 不能發布；乾淨的第 2 版由 publisher 發布
    imp = j(await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/result-imports`, headers: editor.h, payload: { csv: [HEAD, `${a.wallet},run,F30,finished,5000,1500000,2`, `${b.wallet},run,M30,finished,5000,1400000,1`].join("\n") } }));
    expect(imp.import_version).toBe(2);
    expect((await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/result-imports/${imp.import_id}/publish`, headers: editor.h, payload: {} })).statusCode).toBe(403);
    // 發布前公開榜為空
    expect(j(await app.inject({ method: "GET", url: `/v1/events/river-5k/results` })).results).toEqual([]);
    let pub = await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/result-imports/${imp.import_id}/publish`, headers: publisher.h, payload: {} });
    expect(j(pub)).toMatchObject({ revisions: 2, corrections: 0 });
    expect((await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/result-imports/${imp.import_id}/publish`, headers: publisher.h, payload: {} })).json().error.code).toBe("RESULTS_ALREADY_PUBLISHED");
    // 公開榜：只有 Alice（同意）；Bob 名次 1 但未同意不出現；不含 wallet
    let board = j(await app.inject({ method: "GET", url: `/v1/events/river-5k/results` }));
    expect(board.results).toHaveLength(1);
    expect(board.results[0]).toMatchObject({ display_name: "Alice", rank: 2, elapsed_ms: 1500000, rank_source: "organizer", division: "F30" });
    expect(JSON.stringify(board)).not.toContain(a.wallet);
    // 更正：Alice 改 DNF 需原因；無原因 422
    const fix = j(await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/result-imports`, headers: editor.h, payload: { csv: [HEAD, `${a.wallet},run,F30,dnf,3000,0,`].join("\n") } }));
    expect((await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/result-imports/${fix.import_id}/publish`, headers: publisher.h, payload: {} })).statusCode).toBe(422);
    pub = await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/result-imports/${fix.import_id}/publish`, headers: publisher.h, payload: { reason: "timing chip error" } });
    expect(j(pub)).toMatchObject({ revisions: 1, corrections: 1 });
    board = j(await app.inject({ method: "GET", url: `/v1/events/river-5k/results` }));
    expect(board.results).toEqual([]);
    expect(board.non_finishers[0]).toMatchObject({ display_name: "Alice", finish_status: "dnf", rank: null });
    // 個人成績冊：Alice 兩個版本，新版串前版與原因；Bob 看得到自己的成績
    const hist = j(await app.inject({ method: "GET", url: `/v1/me/event-history`, headers: a.h })).items[0].results as Record<string, unknown>[];
    expect(hist).toHaveLength(2);
    expect(hist[0]).toMatchObject({ finish_status: "dnf", reason: "timing chip error", previous_revision_id: hist[1]!.revision_id });
    expect(j(await app.inject({ method: "GET", url: `/v1/me/event-history`, headers: b.h })).items[0].results[0]).toMatchObject({ rank: 1 });
    // import 清單與稽核
    const imports = j(await app.inject({ method: "GET", url: `/v1/partner/events/${ev.event_id}/result-imports`, headers: publisher.h })).imports as { import_version: number; published_at: string | null }[];
    expect(imports.map((i) => [i.import_version, i.published_at !== null])).toEqual([[3, true], [2, true], [1, false]]);
    const audit = j(await app.inject({ method: "GET", url: `/v1/partner/events/${ev.event_id}/audit`, headers: owner.h })).entries as { action: string }[];
    expect(audit.map((x) => x.action)).toEqual(expect.arrayContaining(["results.stage", "results.publish", "results.correct"]));
    // 超過近期登入：發布被拒
    clock = new Date(clock.getTime() + 31 * 60_000);
    await Promise.all([publisher.renew(), editor.renew()]);
    const late = j(await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/result-imports`, headers: editor.h, payload: { csv: `${HEAD}\n${b.wallet},walk,,finished,5000,3000000,1` } }));
    expect((await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/result-imports/${late.import_id}/publish`, headers: publisher.h, payload: {} })).json().error.code).toBe("RECENT_LOGIN_REQUIRED");
  });
  it("保留與刪除（PG-E-09）：宣傳彙總含轉換率與 CSV；活動結束 180 天後清理個人層資料但保留活動／彙總；DELETE /player/data 同步移除該錢包活動資料並釋放預留", async () => {
    const { owner, orgId } = await orgWithOwner();
    const ev = j(await app.inject({ method: "POST", url: "/v1/partner/events", headers: owner.h, payload: draft(orgId) }));
    const rev = j(await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/rule-revisions`, headers: owner.h, payload: { rules: {} } }));
    await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/publish`, headers: owner.h, payload: { revision_id: rev.revision_id } });
    const gate = j(await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/checkpoints`, headers: owner.h, payload: { name: "Gate", purpose: "check_in" } }));
    const towel = j(await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/benefits`, headers: owner.h, payload: { kind: "physical", name: "Towel", stock_total: 5, requires_checkin: false } }));
    await app.inject({ method: "GET", url: `/v1/events/river-5k?source=ig` });
    const a = await login();
    const b = await login();
    await app.inject({ method: "POST", url: `/v1/events/${ev.event_id}/registrations?source=ig`, headers: a.h, payload: { accepted_rule_revision: rev.revision_id, display_name: "Alice", public_consent: true } });
    await app.inject({ method: "POST", url: `/v1/events/${ev.event_id}/registrations`, headers: b.h, payload: { accepted_rule_revision: rev.revision_id } });
    const ch = j(await app.inject({ method: "POST", url: `/v1/events/${ev.event_id}/check-in-challenges`, headers: a.h, payload: { checkpoint_id: gate.checkpoint_id } }));
    await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/check-ins`, headers: owner.h, payload: { code: ch.code, checkpoint_id: gate.checkpoint_id } });
    await app.inject({ method: "POST", url: `/v1/events/${ev.event_id}/redemptions`, headers: b.h, payload: { benefit_id: towel.benefit_id, idempotency_key: "11111111-1111-4111-8111-111111111111" } });
    // 彙總：ig 來源 1 view / 1 registration；轉換率；CSV
    const sum = j(await app.inject({ method: "GET", url: `/v1/partner/events/${ev.event_id}/campaign-summary`, headers: owner.h }));
    expect(sum.by_source.ig).toMatchObject({ views: 1, registrations: 1 });
    expect(sum.conversion.ig.registration_rate).toBe(1);
    expect(sum.retention.purged_at).toBeNull();
    const csv = await app.inject({ method: "GET", url: `/v1/partner/events/${ev.event_id}/campaign-summary?format=csv`, headers: owner.h });
    expect(csv.headers["content-type"]).toMatch(/text\/csv/);
    expect(csv.body.split("\n")[0]).toBe("source,day,views,registrations,checkins,redemptions");
    // DELETE /player/data（b）：報名、預留消失，庫存釋放；a 不受影響
    const del = await app.inject({ method: "DELETE", url: `/v1/player/data`, headers: b.h });
    expect(del.statusCode).toBe(204);
    expect(await store.getParticipant(ev.event_id, b.wallet)).toBeNull();
    expect((await store.getBenefit(ev.event_id, towel.benefit_id))?.reservedCount).toBe(0);
    expect((await store.getParticipant(ev.event_id, a.wallet))?.status).toBe("checked_in");
    // 保留：活動結束（2026-10-03T04:00Z）＋180 天前不清；到期後清理個人層資料，活動與彙總保留
    let r = await new RetentionService(store, () => new Date("2027-03-01T00:00:00Z")).runOnce();
    expect(r.events.events).toEqual([]);
    r = await new RetentionService(store, () => new Date("2027-04-05T00:00:00Z")).runOnce();
    expect(r.events).toMatchObject({ events: [ev.event_id], participants: 1, checkins: 1 });
    expect(await store.getParticipant(ev.event_id, a.wallet)).toBeNull();
    expect(await store.listCheckins(ev.event_id)).toEqual([]);
    expect((await store.getEvent(ev.event_id))?.purgedAt).toBeTruthy();
    expect(j(await app.inject({ method: "GET", url: `/v1/events/river-5k` })).title).toBe("River 5K");
    // 時間快轉後 owner 的 session 也被保留清理清掉（正常）；重新登入後彙總仍在
    const ownerAgain = await loginAs(owner.kp);
    expect(j(await app.inject({ method: "GET", url: `/v1/partner/events/${ev.event_id}/campaign-summary`, headers: ownerAgain.h })).by_source.ig.registrations).toBe(1);
    // 二次執行不重複
    r = await new RetentionService(store, () => new Date("2027-04-06T00:00:00Z")).runOnce();
    expect(r.events.events).toEqual([]);
  });
});
