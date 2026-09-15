/** PG-M-04：活動留念章——主辦方發行設定、報名時鞋階快照（Lv2 承諾權限）、報到章／完賽章分開、每玩家／活動／章別一次、取消報名／結果更正撤銷、重新符合同 id 恢復、藝廊投影。 */
import bs58 from "bs58";
import nacl from "tweetnacl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { eventBadgeKeyOf, parseEventBadgeKey } from "./eventBadges.js";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import type { Db } from "../db.js";
import { galleryProjection } from "../gallery/projection.js";
import { decodeAchievement } from "../lib/achievement.js";
import { eventBadgeAchievementIdOf } from "../pb/achievements.js";
import { LocalKeypairSigner } from "../signer/index.js";
import { MemoryStore } from "../store/memory.js";

const db: Db = { pool: null, ping: async () => false, close: async () => {} };
const PROGRAM = "6MhVoQHdEpY2hqkaNJMkT2vHWakfnGfEYDgCtJzh6ENA";
const OPS = { authorization: "Bearer ops-token-for-tests-0001" };
const HEAD = "participant_ref,discipline,division,finish_status,distance_m,elapsed_ms,rank";
let app: ReturnType<typeof buildApp>;
let store: MemoryStore;
let signer: LocalKeypairSigner;
const clock = new Date("2026-09-14T06:00:00Z");
beforeEach(async () => {
  store = new MemoryStore();
  signer = LocalKeypairSigner.random();
  app = buildApp({ config: loadConfig({ NODE_ENV: "test", OPS_TOKEN: "ops-token-for-tests-0001", PROGRAM_ID: PROGRAM }), db, store, now: () => clock, signer });
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

async function eventWithBadges(badges: { check_in: boolean; finish: boolean }) {
  const owner = await login();
  const org = j(await app.inject({ method: "POST", url: "/v1/partner/orgs", headers: OPS, payload: { name: "Club", slug: "club", owner_wallet: owner.wallet } }));
  const ev = j(await app.inject({ method: "POST", url: "/v1/partner/events", headers: owner.h, payload: { org_id: org.org_id, slug: "river-10k", title: "River 10K", timezone: "UTC", starts_at: "2026-10-03T00:00:00Z", ends_at: "2026-10-03T04:00:00Z", capacity: 10, badges } }));
  const rev = j(await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/rule-revisions`, headers: owner.h, payload: { rules: {} } }));
  await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/publish`, headers: owner.h, payload: { revision_id: rev.revision_id } });
  const gate = j(await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/checkpoints`, headers: owner.h, payload: { name: "Gate", purpose: "check_in" } }));
  return { owner, ev, rev, gate };
}

describe("key", () => {
  it("event|<uuid>|<kind> 往返；非法拒絕", () => {
    const id = "11111111-2222-4333-8444-555555555555";
    expect(parseEventBadgeKey(eventBadgeKeyOf(id, "finish"))).toEqual({ eventId: id, kind: "finish" });
    expect(parseEventBadgeKey("first_5k|outdoor|device")).toBeNull();
  });
});

describe("活動留念章", () => {
  it("未發行 → 不列；發行 → 報名 Lv1 → level_locked；Lv2 報名 → 報到章 locked→eligible（staff 報到）、完賽章 locked→eligible（結果發布）；鑄造 category 12／13 同活動兩章不同 id；取消報名 → revoke_pending", async () => {
    const { owner, ev, rev, gate } = await eventWithBadges({ check_in: false, finish: false });
    const u = await login();
    await app.inject({ method: "POST", url: `/v1/events/${ev.event_id}/registrations`, headers: u.h, payload: { accepted_rule_revision: rev.revision_id } });
    expect(j(await app.inject({ method: "GET", url: "/v1/me/event-badges", headers: u.h })).items).toEqual([]);
    // 主辦方開啟發行 → Lv1 報名者 level_locked（承諾權限 Lv2）
    const cur = j(await app.inject({ method: "GET", url: `/v1/partner/events/${ev.event_id}`, headers: owner.h }));
    await app.inject({ method: "PATCH", url: `/v1/partner/events/${ev.event_id}`, headers: owner.h, payload: { revision: cur.revision, badges: { check_in: true, finish: true } } });
    expect(j(await app.inject({ method: "GET", url: `/v1/events/river-10k` })).badges).toEqual({ check_in: true, finish: true });
    let items = j(await app.inject({ method: "GET", url: "/v1/me/event-badges", headers: u.h })).items;
    expect(items.map((x: { kind: string; status: string; level_at_registration: number }) => [x.kind, x.status, x.level_at_registration])).toEqual([["check_in", "level_locked", 1], ["finish", "level_locked", 1]]);
    expect(j(await app.inject({ method: "POST", url: "/v1/me/event-badges/mint-intent", headers: u.h, payload: { event_id: ev.event_id, kind: "finish", public_consent: false } })).error.code).toBe("EVENT_BADGE_NOT_ELIGIBLE");
    // Lv2 玩家報名 → 快照 2；未報到／無結果 → locked
    const v = await login();
    await store.upsertGalleryPlayer({ wallet: v.wallet, shoeLevel: 2, coreLevel: 1, xp: 500n, streakDays: 0, maxStreakDays: 0, lastTaskDate: null, slot: 1 }, clock);
    await app.inject({ method: "POST", url: `/v1/events/${ev.event_id}/registrations`, headers: v.h, payload: { accepted_rule_revision: rev.revision_id } });
    items = j(await app.inject({ method: "GET", url: "/v1/me/event-badges", headers: v.h })).items;
    expect(items.map((x: { kind: string; status: string; level_at_registration: number }) => [x.kind, x.status, x.level_at_registration])).toEqual([["check_in", "locked", 2], ["finish", "locked", 2]]);
    // 之後降級不影響（快照）
    await store.upsertGalleryPlayer({ wallet: v.wallet, shoeLevel: 1, coreLevel: 1, xp: 0n, streakDays: 0, maxStreakDays: 0, lastTaskDate: null, slot: 2 }, clock);
    // staff 報到 → 報到章 eligible
    const staff = await login();
    await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/roles`, headers: owner.h, payload: { wallet: staff.wallet, role: "staff", checkpoint_id: gate.checkpoint_id } });
    const ch = j(await app.inject({ method: "POST", url: `/v1/events/${ev.event_id}/check-in-challenges`, headers: v.h, payload: { checkpoint_id: gate.checkpoint_id } }));
    expect((await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/check-ins`, headers: staff.h, payload: { code: ch.code, checkpoint_id: gate.checkpoint_id, method: "qr" } })).statusCode).toBe(201);
    items = j(await app.inject({ method: "GET", url: "/v1/me/event-badges", headers: v.h })).items;
    expect(items.find((x: { kind: string }) => x.kind === "check_in")).toMatchObject({ status: "eligible", source: { kind: "participant", achieved_at: "2026-10-03T00:00:00.000Z" }, event: { title: "River 10K", slug: "river-10k" } });
    expect(items.find((x: { kind: string }) => x.kind === "finish").status).toBe("locked");
    // 鑄造報到章 → pending → ops 核准 → 證明 category 12
    let it = j(await app.inject({ method: "POST", url: "/v1/me/event-badges/mint-intent", headers: v.h, payload: { event_id: ev.event_id, kind: "check_in", public_consent: false } }));
    const idCheckIn = eventBadgeAchievementIdOf(v.wallet, eventBadgeKeyOf(ev.event_id, "check_in"));
    expect(it.achievement).toMatchObject({ achievement_id: idCheckIn, kind: "event", category: "event_check_in", verification_class: "organizer", status: "pending_registry", milestone_key: `event|${ev.event_id}|check_in` });
    expect(it.metadata_preview.name).toBe("NeonShift · River 10K · Check-in");
    expect(it.metadata_preview.image).toBe("https://neonshift.cc/nft/achievements/milestones/event-check_in.svg");
    expect(j(await app.inject({ method: "GET", url: "/v1/ops/achievements/pending", headers: OPS })).items[0]).toMatchObject({ achievement_id: idCheckIn, category_code: 12, class_code: 1 });
    await app.inject({ method: "POST", url: `/v1/ops/achievements/${idCheckIn}/registry`, headers: OPS, payload: { status: "approved", signature: "5".repeat(64) } });
    it = j(await app.inject({ method: "POST", url: "/v1/me/event-badges/mint-intent", headers: v.h, payload: { event_id: ev.event_id, kind: "check_in", public_consent: false } }));
    expect(it.status).toBe("approved");
    expect(decodeAchievement(Buffer.from(it.proof.message_b64, "base64")).category).toBe(12);
    // 結果發布 → 完賽章 eligible；公開同意 → Time／Rank；id 與報到章不同
    const imp = j(await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/result-imports`, headers: owner.h, payload: { csv: `${HEAD}\n${v.wallet},run,,finished,10000,3000000,2` } }));
    await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/result-imports/${imp.import_id}/publish`, headers: owner.h, payload: {} });
    items = j(await app.inject({ method: "GET", url: "/v1/me/event-badges", headers: v.h })).items;
    expect(items.find((x: { kind: string }) => x.kind === "finish")).toMatchObject({ status: "eligible", source: { kind: "result" } });
    it = j(await app.inject({ method: "POST", url: "/v1/me/event-badges/mint-intent", headers: v.h, payload: { event_id: ev.event_id, kind: "finish", public_consent: true } }));
    const idFinish = eventBadgeAchievementIdOf(v.wallet, eventBadgeKeyOf(ev.event_id, "finish"));
    expect(idFinish).not.toBe(idCheckIn);
    expect(it.achievement).toMatchObject({ achievement_id: idFinish, category: "event_finish", status: "pending_registry" });
    const attrs = it.metadata_preview.attributes as { trait_type: string; value: string }[];
    expect(attrs.map((a) => a.trait_type)).toEqual(["Series", "Badge", "Event", "Verification", "Rules", "Event date", "Time", "Rank"]);
    expect(attrs.find((a) => a.trait_type === "Rank")?.value).toBe("2");
    // 未公開 → 無 Time／Rank
    it = j(await app.inject({ method: "POST", url: "/v1/me/event-badges/mint-intent", headers: v.h, payload: { event_id: ev.event_id, kind: "finish", public_consent: false } }));
    expect((it.metadata_preview.attributes as { trait_type: string }[]).map((a) => a.trait_type)).not.toContain("Time");
    // 結果更正為 DNF → 完賽章 revoke_pending、報到章不受影響
    const fix = j(await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/result-imports`, headers: owner.h, payload: { csv: `${HEAD}\n${v.wallet},run,,dnf,5000,0,` } }));
    await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/result-imports/${fix.import_id}/publish`, headers: owner.h, payload: { reason: "timing error" } });
    let mine = j(await app.inject({ method: "GET", url: "/v1/me/achievements", headers: v.h })).items;
    expect(mine.find((a: { achievement_id: string }) => a.achievement_id === idFinish).status).toBe("revoke_pending");
    expect(mine.find((a: { achievement_id: string }) => a.achievement_id === idCheckIn).status).toBe("approved");
    // 再次更正為 finished → 同 id 恢復 pending_registry（不重發）
    const fix2 = j(await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/result-imports`, headers: owner.h, payload: { csv: `${HEAD}\n${v.wallet},run,,finished,10000,3100000,3` } }));
    await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/result-imports/${fix2.import_id}/publish`, headers: owner.h, payload: { reason: "restored" } });
    mine = j(await app.inject({ method: "GET", url: "/v1/me/achievements", headers: v.h })).items;
    expect(mine.filter((a: { kind: string }) => a.kind === "event")).toHaveLength(2);
    expect(mine.find((a: { achievement_id: string }) => a.achievement_id === idFinish).status).toBe("pending_registry");
    // 已鑄造報到章（indexer）→ 藝廊投影 kind=event、series event_check_in、event 標題
    const asset = bs58.encode(Buffer.alloc(32, 5));
    await galleryProjection({ signature: "sigMint", slot: 100, eventIndex: 0, name: "AchievementClaimed", payload: { wallet: v.wallet, achievement_id: idCheckIn, category: 12, verification_class: 1, source_revision: 1, asset }, status: "finalized", observedAt: clock, finalizedAt: clock } as never, store as never, clock);
    expect(j(await app.inject({ method: "GET", url: `/v1/gallery/achievements/${asset}`, headers: v.h }))).toMatchObject({ kind: "event", series: "event_check_in", record: "current", achieved_on: "2026-10-03", event: { title: "River 10K", event_id: ev.event_id }, name: "NeonShift · River 10K · Check-in" });
    // 取消報名 → 兩章 revoke_pending（已鑄造保留 minted 事實）
    clock.setTime(Date.parse("2026-09-14T06:00:00Z"));
    expect((await app.inject({ method: "DELETE", url: `/v1/events/${ev.event_id}/registration`, headers: v.h })).statusCode).toBe(204);
    mine = j(await app.inject({ method: "GET", url: "/v1/me/achievements", headers: v.h })).items;
    expect(mine.filter((a: { kind: string }) => a.kind === "event").map((a: { status: string; minted: boolean }) => [a.status, a.minted]).sort()).toEqual([["revoke_pending", false], ["revoke_pending", true]]);
    expect(j(await app.inject({ method: "GET", url: "/v1/me/event-badges", headers: v.h })).items.every((x: { status: string }) => x.status === "cancelled")).toBe(true);
  });
});
