/** PG-R-08 後端：mint-intent（穩定 ID、metadata／hash、公開同意差異、registry 狀態、證明簽章與向量格式）、ops registry、更正撤銷、indexer minted、metadata 端點。 */
import bs58 from "bs58";
import nacl from "tweetnacl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import type { Db } from "../db.js";
import { galleryProjection } from "../gallery/projection.js";
import { decodeAchievement } from "../lib/achievement.js";
import { LocalKeypairSigner } from "../signer/index.js";
import { MemoryStore } from "../store/memory.js";
import { achievementIdOf } from "./achievements.js";

const db: Db = { pool: null, ping: async () => false, close: async () => {} };
let app: ReturnType<typeof buildApp>;
let store: MemoryStore;
let signer: LocalKeypairSigner;
const clock = new Date("2026-09-14T06:00:00Z");
const PROGRAM = "6MhVoQHdEpY2hqkaNJMkT2vHWakfnGfEYDgCtJzh6ENA";
const OPS = { authorization: "Bearer ops-token-for-tests-0001" };

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
const gps = (id: string, day: string, km: number, splitMs: number) => ({ sport: "run", origin: "gps", source_id: "cc.neonshift.app/gps", external_record_id: id, started_at: `${day}T00:00:00Z`, ended_at: new Date(Date.parse(`${day}T00:00:00Z`) + splitMs * km).toISOString(), distance_mm: String(km * 1_000_000), distance_method: "gps", extras: { splits: Array.from({ length: km }, (_, i) => ({ kind: "split", index: i + 1, distanceMm: 1_000_000, durationMs: splitMs, isPartial: false, uncertain: false })) } });

describe("mint-intent → registry → proof → minted → 撤銷", () => {
  it("完整流程", async () => {
    const u = await login();
    await app.inject({ method: "POST", url: "/v1/workouts/import", headers: u.h, payload: { sessions: [gps("w1", "2026-09-01", 5, 320_000)] } });
    let group = j(await app.inject({ method: "GET", url: "/v1/me/personal-bests", headers: u.h })).groups.find((g: { category: string }) => g.category === "fastest_5k");
    const pb = group.current;
    // PG-V-03：無等級歷史 → history_unknown、只保留私人 PB；Lv2 → level_required；Lv3（達成日前生效）→ eligible
    expect(group.nft_eligibility).toEqual({ status: "history_unknown", level: null, required: 3, effective_from: null });
    expect(j(await app.inject({ method: "POST", url: "/v1/me/achievements/" + pb.pb_id + "/mint-intent", headers: u.h, payload: { public_consent: false } })).error.code).toBe("LEVEL_HISTORY_UNKNOWN");
    const day = Math.floor(Date.parse("2026-09-01T00:00:00Z") / 86_400_000);
    await store.insertLevelHistory({ wallet: u.wallet, effectiveFromDate: day - 30, activeLevel: 2, highestLevel: 2, epoch: 1, source: "epoch", signature: "s1", slot: 1 });
    group = j(await app.inject({ method: "GET", url: "/v1/me/personal-bests", headers: u.h })).groups.find((g: { category: string }) => g.category === "fastest_5k");
    expect(group.nft_eligibility).toMatchObject({ status: "level_required", level: 2, required: 3 });
    expect(j(await app.inject({ method: "POST", url: "/v1/me/achievements/" + pb.pb_id + "/mint-intent", headers: u.h, payload: { public_consent: false } })).error.code).toBe("LEVEL_REQUIRED");
    await store.insertLevelHistory({ wallet: u.wallet, effectiveFromDate: day + 5, activeLevel: 3, highestLevel: 3, epoch: 3, source: "epoch", signature: "s3", slot: 3 }); // 達成日之後才升 → 不算
    expect(j(await app.inject({ method: "POST", url: "/v1/me/achievements/" + pb.pb_id + "/mint-intent", headers: u.h, payload: { public_consent: false } })).error.code).toBe("LEVEL_REQUIRED");
    await store.insertLevelHistory({ wallet: u.wallet, effectiveFromDate: day - 7, activeLevel: 3, highestLevel: 3, epoch: 2, source: "epoch", signature: "s2", slot: 2 });
    group = j(await app.inject({ method: "GET", url: "/v1/me/personal-bests", headers: u.h })).groups.find((g: { category: string }) => g.category === "fastest_5k");
    expect(group.nft_eligibility).toEqual({ status: "eligible", level: 3, required: 3, effective_from: day - 7 });
    // 未同意公開：metadata 無精確值；pending_registry、無證明；費用揭露；能力快照綁進 metadata
    let r = await app.inject({ method: "POST", url: "/v1/me/achievements/" + pb.pb_id + "/mint-intent", headers: u.h, payload: { public_consent: false } });
    expect(r.statusCode).toBe(200);
    let it = j(r);
    expect(it.metadata_preview.properties.capability).toEqual({ active_level: 3, effective_from: day - 7 });
    expect(it.status).toBe("pending_registry");
    expect(it.proof).toBeNull();
    expect(it.fee_estimate_lamports).toBeGreaterThan(0);
    expect(it.achievement.achievement_id).toBe(achievementIdOf(u.wallet, pb.pb_id));
    expect(JSON.stringify(it.metadata_preview)).not.toContain("26:40");
    const id = it.achievement.achievement_id as string;
    // 缺 public_consent → 422；重試同 ID
    expect((await app.inject({ method: "POST", url: `/v1/me/achievements/${pb.pb_id}/mint-intent`, headers: u.h, payload: {} })).statusCode).toBe(422);
    // 改為同意公開 → metadata 含時間與日期、hash 變、仍 pending
    it = j(await app.inject({ method: "POST", url: `/v1/me/achievements/${pb.pb_id}/mint-intent`, headers: u.h, payload: { public_consent: true } }));
    expect(JSON.stringify(it.metadata_preview)).toContain("26:40");
    expect(it.achievement.public_consent).toBe(true);
    const hash1 = it.achievement.metadata_hash as string;
    // 公開 metadata 端點
    const meta = await app.inject({ method: "GET", url: `/v1/nft/achievements/${id}.json` });
    expect(meta.statusCode).toBe(200);
    expect(j(meta).name).toBe("NeonShift PB · Fastest 5K (Device)");
    expect((await app.inject({ method: "GET", url: `/v1/nft/achievements/${"0".repeat(64)}.json` })).statusCode).toBe(404);
    // ops：pending 清單 → 上鏈後回報 approved
    const pending = j(await app.inject({ method: "GET", url: "/v1/ops/achievements/pending", headers: OPS })).items;
    expect(pending.map((x: { achievement_id: string; desired_status: string; category_code: number; class_code: number }) => [x.achievement_id, x.desired_status, x.category_code, x.class_code])).toEqual([[id, "approved", 2, 2]]);
    expect((await app.inject({ method: "GET", url: "/v1/ops/achievements/pending" })).statusCode).toBe(401);
    await app.inject({ method: "POST", url: `/v1/ops/achievements/${id}/registry`, headers: OPS, payload: { status: "approved", signature: "5".repeat(64) } });
    // 已核准 → 簽發 194-byte 證明；驗簽、欄位與 metadata_hash 綁定
    it = j(await app.inject({ method: "POST", url: `/v1/me/achievements/${pb.pb_id}/mint-intent`, headers: u.h, payload: { public_consent: true } }));
    expect(it.status).toBe("approved");
    const msg = Buffer.from(it.proof.message_b64, "base64");
    expect(msg.length).toBe(194);
    expect(nacl.sign.detached.verify(new Uint8Array(msg), new Uint8Array(Buffer.from(it.proof.signature_b64, "base64")), await signer.publicKey())).toBe(true);
    const p = decodeAchievement(msg);
    expect([bs58.encode(p.wallet), bs58.encode(p.programId), p.category, p.verificationClass, p.sourceRevision, p.metadataHash.toString("hex"), Number(p.expiry - p.issuedAt)]).toEqual([u.wallet, PROGRAM, 2, 2, 1, hash1, 900]);
    expect(it.proof.args).toMatchObject({ achievement_id: id, category: 2, verification_class: 2, metadata_hash: hash1 });
    // indexer：AchievementClaimed finalized → minted
    await galleryProjection({ signature: "sigMint", slot: 100, eventIndex: 0, name: "AchievementClaimed", payload: { wallet: u.wallet, achievement_id: id, category: 2, verification_class: 2, source_revision: 1, asset: "AssetPk" }, status: "finalized", observedAt: clock, finalizedAt: clock } as never, store as never, clock);
    it = j(await app.inject({ method: "POST", url: `/v1/me/achievements/${pb.pb_id}/mint-intent`, headers: u.h, payload: { public_consent: true } }));
    expect([it.status, it.achievement.asset, it.achievement.minted]).toEqual(["minted", "AssetPk", true]);
    expect(j(await app.inject({ method: "GET", url: "/v1/me/achievements", headers: u.h })).items).toHaveLength(1);
    // 來源刪除 → PB invalidated → 成就 revoke_pending（已鑄造仍保留 minted 事實）→ ops 撤銷 → revoked
    const w1 = j(await app.inject({ method: "GET", url: "/v1/me/workouts", headers: u.h })).items[0];
    await app.inject({ method: "DELETE", url: `/v1/me/workouts/${w1.session_id}`, headers: u.h });
    let a = j(await app.inject({ method: "GET", url: "/v1/me/achievements", headers: u.h })).items[0];
    expect([a.status, a.minted]).toEqual(["revoke_pending", true]);
    expect(j(await app.inject({ method: "GET", url: "/v1/ops/achievements/pending", headers: OPS })).items[0].desired_status).toBe("revoked");
    await app.inject({ method: "POST", url: `/v1/ops/achievements/${id}/registry`, headers: OPS, payload: { status: "revoked", signature: "6".repeat(64) } });
    a = j(await app.inject({ method: "GET", url: "/v1/me/achievements", headers: u.h })).items[0];
    expect([a.status, a.minted, a.asset]).toEqual(["revoked", true, "AssetPk"]);
    // 撤銷後不再簽發
    expect(j(await app.inject({ method: "POST", url: `/v1/me/achievements/${pb.pb_id}/mint-intent`, headers: u.h, payload: { public_consent: true } })).error.code).toBe("ACHIEVEMENT_INVALIDATED");
  });

  it("signer service 接受 194-byte 證明、拒絕其他長度", async () => {
    const { buildSignerService } = await import("../signer/service.js");
    const svc = buildSignerService({ signer: LocalKeypairSigner.random(), token: "t".repeat(40) });
    await svc.ready();
    const u = await login();
    await store.insertLevelHistory({ wallet: u.wallet, effectiveFromDate: 0, activeLevel: 3, highestLevel: 3, epoch: null, source: "migrate", signature: "m", slot: 1 });
    await app.inject({ method: "POST", url: "/v1/workouts/import", headers: u.h, payload: { sessions: [gps("w1", "2026-09-01", 5, 320_000)] } });
    const pb = j(await app.inject({ method: "GET", url: "/v1/me/personal-bests", headers: u.h })).groups[0].current;
    const id = achievementIdOf(u.wallet, pb.pb_id);
    await app.inject({ method: "POST", url: `/v1/me/achievements/${pb.pb_id}/mint-intent`, headers: u.h, payload: { public_consent: false } });
    await app.inject({ method: "POST", url: `/v1/ops/achievements/${id}/registry`, headers: OPS, payload: { status: "approved", signature: "5".repeat(64) } });
    const it = j(await app.inject({ method: "POST", url: `/v1/me/achievements/${pb.pb_id}/mint-intent`, headers: u.h, payload: { public_consent: false } }));
    const ok = await svc.inject({ method: "POST", url: "/sign", headers: { authorization: `Bearer ${"t".repeat(40)}` }, payload: { message_b64: it.proof.message_b64 } });
    expect(ok.statusCode).toBe(200);
    const bad = await svc.inject({ method: "POST", url: "/sign", headers: { authorization: `Bearer ${"t".repeat(40)}` }, payload: { message_b64: Buffer.alloc(190).toString("base64") } });
    expect(bad.statusCode).toBe(400);
    await svc.close();
  });
});
