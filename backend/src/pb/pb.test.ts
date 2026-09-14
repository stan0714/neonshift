/** PG-R-07：PB 純計算（固定距離只用完整分段、嚴格改善、Baseline、官方／裝置分組）與端到端（匯入→PB、刪除→invalidated、成績發布／更正→重算）。 */
import bs58 from "bs58";
import nacl from "tweetnacl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildChains, candidatesFromResult, candidatesFromWorkout, fastestWindowMs } from "./compute.js";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import type { Db } from "../db.js";
import { LocalKeypairSigner } from "../signer/index.js";
import { MemoryStore } from "../store/memory.js";

const split = (durationMs: number, over: Partial<{ isPartial: boolean; uncertain: boolean; distanceMm: number }> = {}) => ({ distanceMm: 1_000_000, durationMs, isPartial: false, uncertain: false, ...over });

describe("compute", () => {
  it("fastestWindowMs：連續完整分段覆蓋 D 的最短區間；partial／uncertain 中斷；不足回 null", () => {
    const s = [split(300_000), split(290_000), split(310_000), split(280_000), split(300_000), split(400_000, { isPartial: true })];
    expect(fastestWindowMs(s, 1_000_000)).toBe(280_000);
    expect(fastestWindowMs(s, 5_000_000)).toBe(300_000 + 290_000 + 310_000 + 280_000 + 300_000);
    expect(fastestWindowMs(s, 10_000_000)).toBeNull();
    expect(fastestWindowMs([split(300_000), split(290_000, { uncertain: true }), split(280_000)], 2_000_000)).toBeNull();
  });
  it("workout 候選：只有總距離 → 只有 longest；有分段 → 1K／5K；半馬／全馬不從裝置簽發；非 pb_eligible 無候選", () => {
    const base = { sessionId: "s1", sourceRevision: 1, startedAt: new Date("2026-09-01T00:00:00Z"), endedAt: new Date("2026-09-01T00:30:00Z"), environment: "outdoor" as const, distanceMm: 6_000_000n, pbEligible: true };
    expect(candidatesFromWorkout({ ...base, splits: null }).map((c) => c.category)).toEqual(["longest_run"]);
    const withSplits = candidatesFromWorkout({ ...base, splits: [split(300_000), split(300_000), split(300_000), split(300_000), split(300_000), split(300_000)] });
    expect(withSplits.map((c) => [c.category, c.value])).toEqual([["longest_run", 6_000_000n], ["fastest_1k", 300_000n], ["fastest_5k", 1_500_000n]]);
    expect(withSplits.every((c) => c.verificationClass === "device" && c.timingBasis === "elapsed")).toBe(true);
    expect(candidatesFromWorkout({ ...base, pbEligible: false, splits: [split(300_000)] })).toEqual([]);
    expect(candidatesFromWorkout({ ...base, distanceMm: 900_000n, splits: null })).toEqual([]); // < 1 km 不建最遠
  });
  it("result 候選：距離誤差 ≤ 1% 歸固定距離（含半馬）；非 finished 無候選；organizer 分組", () => {
    const r = candidatesFromResult({ revisionId: "r1", publishedAt: new Date("2026-10-03T05:00:00Z"), distanceM: 21100, elapsedMs: 6_000_000, finishStatus: "finished" });
    expect(r.map((c) => c.category)).toEqual(["fastest_half", "longest_run"]);
    expect(r[0]).toMatchObject({ verificationClass: "organizer", value: 6_000_000n });
    expect(candidatesFromResult({ revisionId: "r2", publishedAt: new Date(), distanceM: 5000, elapsedMs: 0, finishStatus: "dnf" })).toEqual([]);
    expect(candidatesFromResult({ revisionId: "r3", publishedAt: new Date(), distanceM: 7000, elapsedMs: 100, finishStatus: "finished" }).map((c) => c.category)).toEqual(["longest_run"]);
  });
  it("buildChains：Baseline → 嚴格改善才新增，相同不算；官方與裝置、戶外與室內各自成鏈；最後一筆 current", () => {
    type C = ReturnType<typeof candidatesFromResult>[number];
    const c = (o: Partial<Omit<C, "achievedAt">> & { value: bigint; sourceId: string; achievedAt: string }): C => ({ discipline: "run", category: "fastest_5k", environment: "outdoor", verificationClass: "device", timingBasis: "elapsed", rulesMajor: 1, sourceKind: "workout", sourceRevision: 1, ...o, achievedAt: new Date(o.achievedAt) });
    const chains = buildChains([
      c({ value: 1_500_000n, sourceId: "a", achievedAt: "2026-09-01T00:00:00Z" }),
      c({ value: 1_600_000n, sourceId: "b", achievedAt: "2026-09-02T00:00:00Z" }), // 更慢
      c({ value: 1_500_000n, sourceId: "c", achievedAt: "2026-09-03T00:00:00Z" }), // 相同
      c({ value: 1_450_000n, sourceId: "d", achievedAt: "2026-09-04T00:00:00Z" }), // 改善
      c({ value: 1_300_000n, sourceId: "o", achievedAt: "2026-09-05T00:00:00Z", verificationClass: "organizer", sourceKind: "result" }),
      c({ value: 1_200_000n, sourceId: "i", achievedAt: "2026-09-06T00:00:00Z", environment: "indoor" }),
    ]);
    expect(chains.size).toBe(3);
    const dev = chains.get("run|fastest_5k|outdoor|device|elapsed|1")!;
    expect(dev.map((x) => [x.sourceId, x.isBaseline, x.status])).toEqual([["a", true, "historical"], ["d", false, "current"]]);
    expect(chains.get("run|fastest_5k|outdoor|organizer|elapsed|1")![0]).toMatchObject({ sourceId: "o", status: "current", isBaseline: true });
  });
});

describe("PB 端到端", () => {
  const db: Db = { pool: null, ping: async () => false, close: async () => {} };
  let app: ReturnType<typeof buildApp>;
  let store: MemoryStore;
  const clock = new Date("2026-09-14T06:00:00Z");
  beforeEach(async () => {
    store = new MemoryStore();
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
  const gps = (id: string, day: string, km: number, splitMs: number) => ({ sport: "run", origin: "gps", source_id: "cc.neonshift.app/gps", external_record_id: id, started_at: `${day}T00:00:00Z`, ended_at: new Date(Date.parse(`${day}T00:00:00Z`) + splitMs * km).toISOString(), distance_mm: String(km * 1_000_000), distance_method: "gps", extras: { splits: Array.from({ length: km }, (_, i) => ({ kind: "split", index: i + 1, distanceMm: 1_000_000, durationMs: splitMs, isPartial: false, uncertain: false })) } });

  it("匯入兩次跑步：Baseline → 改善；刪除較快的一次 → 該 PB invalidated、舊 Baseline 回 current；主辦方成績另成一組；更正成 DNF 後撤銷", async () => {
    const u = await login();
    await app.inject({ method: "POST", url: "/v1/workouts/import", headers: u.h, payload: { sessions: [gps("w1", "2026-09-01", 5, 320_000)] } });
    let pb = j(await app.inject({ method: "GET", url: "/v1/me/personal-bests", headers: u.h }));
    expect(pb.imported_since).toBe("2026-09-01T00:00:00.000Z");
    const g5 = () => pb.groups.find((g: { category: string; verification_class: string }) => g.category === "fastest_5k" && g.verification_class === "device");
    expect(g5().current).toMatchObject({ value: String(320_000 * 5), unit: "ms", is_baseline: true, status: "current" });
    expect(pb.groups.find((g: { category: string }) => g.category === "longest_run").current.value).toBe("5000000");
    await app.inject({ method: "POST", url: "/v1/workouts/import", headers: u.h, payload: { sessions: [gps("w2", "2026-09-05", 6, 300_000)] } });
    pb = j(await app.inject({ method: "GET", url: "/v1/me/personal-bests", headers: u.h }));
    expect(g5().current).toMatchObject({ value: String(300_000 * 5), is_baseline: false });
    expect(g5().history).toHaveLength(1);
    expect(g5().current.previous_pb_id).toBe(g5().history[0].pb_id);
    // 刪除 w2 → 撤銷、w1 回 current；pb_id 穩定
    const w1PbId = g5().history[0].pb_id;
    const w2 = j(await app.inject({ method: "GET", url: "/v1/me/workouts", headers: u.h })).items.find((x: { source: { external_record_id: string } }) => x.source.external_record_id === "w2");
    await app.inject({ method: "DELETE", url: `/v1/me/workouts/${w2.session_id}`, headers: u.h });
    pb = j(await app.inject({ method: "GET", url: "/v1/me/personal-bests", headers: u.h }));
    expect(g5().current.pb_id).toBe(w1PbId);
    expect(g5().history.map((h: { status: string }) => h.status)).toEqual(["invalidated"]);
    // 主辦方成績：建活動、報名、發布 5K 成績 → organizer 組
    const owner = await login();
    const org = j(await app.inject({ method: "POST", url: "/v1/partner/orgs", headers: { authorization: "Bearer ops-token-for-tests-0001" }, payload: { name: "Club", slug: "club", owner_wallet: owner.wallet } }));
    const ev = j(await app.inject({ method: "POST", url: "/v1/partner/events", headers: owner.h, payload: { org_id: org.org_id, slug: "river-5k", title: "River 5K", timezone: "UTC", starts_at: "2026-10-03T00:00:00Z", ends_at: "2026-10-03T04:00:00Z", capacity: 10 } }));
    const rev = j(await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/rule-revisions`, headers: owner.h, payload: { rules: {} } }));
    await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/publish`, headers: owner.h, payload: { revision_id: rev.revision_id } });
    await app.inject({ method: "POST", url: `/v1/events/${ev.event_id}/registrations`, headers: u.h, payload: { accepted_rule_revision: rev.revision_id } });
    const HEAD = "participant_ref,discipline,division,finish_status,distance_m,elapsed_ms,rank";
    const imp = j(await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/result-imports`, headers: owner.h, payload: { csv: `${HEAD}\n${u.wallet},run,,finished,5000,1400000,1` } }));
    await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/result-imports/${imp.import_id}/publish`, headers: owner.h, payload: {} });
    pb = j(await app.inject({ method: "GET", url: "/v1/me/personal-bests", headers: u.h }));
    const org5 = pb.groups.find((g: { category: string; verification_class: string }) => g.category === "fastest_5k" && g.verification_class === "organizer");
    expect(org5.current).toMatchObject({ value: "1400000", is_baseline: true });
    expect(g5().current.pb_id).toBe(w1PbId); // 裝置組不受影響（不混榜）
    // 更正為 DNF → organizer PB 撤銷
    const fix = j(await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/result-imports`, headers: owner.h, payload: { csv: `${HEAD}\n${u.wallet},run,,dnf,3000,0,` } }));
    await app.inject({ method: "POST", url: `/v1/partner/events/${ev.event_id}/result-imports/${fix.import_id}/publish`, headers: owner.h, payload: { reason: "chip error" } });
    pb = j(await app.inject({ method: "GET", url: "/v1/me/personal-bests", headers: u.h }));
    const org5b = pb.groups.find((g: { category: string; verification_class: string }) => g.category === "fastest_5k" && g.verification_class === "organizer");
    expect(org5b.current).toBeNull();
    expect(org5b.history[0].status).toBe("invalidated");
    // 刪除帳號 → PB 消失
    await app.inject({ method: "DELETE", url: "/v1/player/data", headers: u.h });
    expect(await store.listPbRevisions(u.wallet)).toEqual([]);
  });
});
