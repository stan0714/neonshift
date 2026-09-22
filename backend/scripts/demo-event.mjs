#!/usr/bin/env node
/**
 * Demo 情境 fixture（docs/store/event-demo-playbook.md）：建立／核對「荒野守護體驗日」測試活動。
 *   cd backend && OPS_TOKEN=... node scripts/demo-event.mjs http://l1.neonshift.cc:6080
 * - 幂等：以 org slug／event slug 查找，存在就重用；只補缺的站點、角色、品項、NFC 標籤。
 * - 主辦方 owner 與 staff 用專屬 demo 金鑰（$KEY_DIR，預設 ~/.config/neonshift/dev/demo；不進 repo）；不動使用者錢包。
 * - 產出寫到 $KEY_DIR/fixture.json（活動 id、站點、標籤 URL、staff 位址），供錄影與評審指南登錄。
 * - 活動時窗：報名即刻開放、活動進行中至 +30 天，讓任何一天都能彩排報到；正式版再改實際日期。
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import nacl from "tweetnacl";
import bs58 from "bs58";

const base = (process.argv[2] ?? "http://127.0.0.1:6080").replace(/\/$/, "");
const OPS = process.env.OPS_TOKEN ?? "";
const KEY_DIR = process.env.KEY_DIR ?? join(homedir(), ".config", "neonshift", "dev", "demo");
const ORG = { slug: "wild-guardians", name: "荒野守護 Wild Guardians（測試主辦方）" };
const EVENT = {
  slug: "wild-guardian-day",
  title: "荒野守護體驗日 · Wild Guardian Day（測試活動）",
  description: "NeonShift 評審／錄影用測試活動，非真實合作活動、無捐款。流程：App 報名 → 現場向 staff 出示 120 秒報到碼 → 報到後可預留紀念毛巾 → 主辦方發布成績 → 符合資格者領活動留念章。",
  timezone: "Asia/Taipei",
  capacity: 200,
  badges: { check_in: true, finish: true },
};
const RULES = { distance_m: 3000, course: "河濱 3 km 體驗走／跑", check_in_window: "活動日 08:00–11:00（測試環境全天開放）", results: "主辦方 CSV 匯入後發布；App 只顯示發布版本", conservation_note: "教育示範；不宣稱 WWF 合作或捐款" };
const CHECKPOINTS = [
  { name: "Gate 報到站", purpose: "check_in" },
  { name: "Booth 權益攤位", purpose: "redemption" },
];
const BENEFITS = [
  { kind: "physical", name: "荒野守護紀念毛巾", stock_total: 100, per_person_limit: 1, requires_checkin: true, claim_deadline: null },
  { kind: "digital_badge", name: "體驗日數位守護章", stock_total: 100_000, per_person_limit: 1, requires_checkin: true, claim_deadline: null },
];

const req = async (method, p, body, token) => {
  const r = await fetch(base + p, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${method} ${p} → ${r.status} ${JSON.stringify(json)}`);
  return json;
};
const get = (p, token) => req("GET", p, undefined, token);
const post = (p, body, token) => req("POST", p, body, token);

const loadOrCreateKey = (name) => {
  mkdirSync(KEY_DIR, { recursive: true });
  const file = join(KEY_DIR, `${name}.json`);
  if (existsSync(file)) {
    const secret = Uint8Array.from(JSON.parse(readFileSync(file, "utf8")));
    return nacl.sign.keyPair.fromSecretKey(secret);
  }
  const kp = nacl.sign.keyPair();
  writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)));
  chmodSync(file, 0o600);
  console.log(`建立金鑰 ${file}`);
  return kp;
};
const siws = async (kp) => {
  const wallet = bs58.encode(kp.publicKey);
  const n = await post("/v1/auth/nonce", { wallet });
  const sig = Buffer.from(nacl.sign.detached(new TextEncoder().encode(n.message), kp.secretKey)).toString("base64");
  const v = await post("/v1/auth/verify", { message: n.message, signature_b64: sig });
  return { wallet, token: v.access_token };
};

const owner = await siws(loadOrCreateKey("demo-owner"));
const staff = await siws(loadOrCreateKey("demo-staff"));
console.log(`owner ${owner.wallet}\nstaff ${staff.wallet}`);

// 組織
let me = await get("/v1/partner/me", owner.token);
// /partner/me 早期版本不回 slug：以 slug 或名稱比對，避免重跑時 409 SLUG_TAKEN
let org = (me.organizations ?? []).find((o) => o.slug === ORG.slug || o.name === ORG.name);
if (!org) {
  if (!OPS) throw new Error("組織不存在且未提供 OPS_TOKEN（l1 /etc/neonshift/api.env）");
  org = await post("/v1/partner/orgs", { ...ORG, owner_wallet: owner.wallet }, OPS);
  console.log(`建立組織 ${org.org_id}`);
}
const orgId = org.org_id;

// 活動
const list = await get(`/v1/partner/orgs/${orgId}/events`, owner.token);
let ev = (list.items ?? list.events ?? []).find((e) => e.slug === EVENT.slug);
const now = Date.now();
if (!ev) {
  ev = await post("/v1/partner/events", {
    org_id: orgId,
    ...EVENT,
    registration_opens_at: new Date(now - 3_600_000).toISOString(),
    registration_closes_at: new Date(now + 30 * 86_400_000).toISOString(),
    starts_at: new Date(now - 3_600_000).toISOString(),
    ends_at: new Date(now + 30 * 86_400_000).toISOString(),
    tournament_address: null,
  }, owner.token);
  console.log(`建立活動 ${ev.event_id}`);
}
const evId = ev.event_id;
ev = await get(`/v1/partner/events/${evId}`, owner.token);
if (!ev.current_rule_revision) {
  const rev = await post(`/v1/partner/events/${evId}/rule-revisions`, { rules: RULES }, owner.token);
  await post(`/v1/partner/events/${evId}/publish`, { revision_id: rev.revision_id }, owner.token);
  console.log(`規則 v${rev.version ?? 1} 已發布`);
  ev = await get(`/v1/partner/events/${evId}`, owner.token);
}

// 站點
const cps = await get(`/v1/partner/events/${evId}/checkpoints`, owner.token);
const have = cps.items ?? cps.checkpoints ?? [];
const checkpoints = {};
for (const c of CHECKPOINTS) {
  let found = have.find((x) => x.name === c.name);
  if (!found) { found = await post(`/v1/partner/events/${evId}/checkpoints`, c, owner.token); console.log(`建立站點 ${c.name}`); }
  checkpoints[c.purpose] = found.checkpoint_id;
}

// staff 角色（綁報到站）
await post(`/v1/partner/events/${evId}/roles`, { wallet: staff.wallet, role: "staff", checkpoint_id: checkpoints.check_in }, owner.token);
// 成績編輯／發布：由 owner 自己擔任（demo 團隊）
await post(`/v1/partner/events/${evId}/roles`, { wallet: owner.wallet, role: "result_editor", checkpoint_id: null }, owner.token);
await post(`/v1/partner/events/${evId}/roles`, { wallet: owner.wallet, role: "publisher", checkpoint_id: null }, owner.token);

// 品項
const bs = await get(`/v1/partner/events/${evId}/benefits`, owner.token);
const haveB = bs.items ?? bs.benefits ?? [];
for (const b of BENEFITS) {
  if (!haveB.find((x) => x.name === b.name)) { await post(`/v1/partner/events/${evId}/benefits`, b, owner.token); console.log(`建立品項 ${b.name}`); }
}

// NFC 標籤（報到站一枚）。沒有「列出標籤」端點，改以上次 fixture 的 opaque_ref 驗證；有效就重用，
// 否則才新建（2026-09-22：先前每跑一次就多一枚標籤，實體卡片會對不上）。
const fixtureFile = join(KEY_DIR, "fixture.json");
const previous = existsSync(fixtureFile) ? JSON.parse(readFileSync(fixtureFile, "utf8")) : null;
let tag = null;
const prevTag = previous?.nfc_tag?.tags?.[0] ?? null;
if (prevTag?.opaque_ref) {
  try {
    await get(`/v1/events/${evId}/tags/${prevTag.opaque_ref}`, owner.token);
    tag = { tags: [prevTag] };
    console.log(`重用既有標籤 ${prevTag.opaque_ref}`);
  } catch {
    console.log("既有標籤已失效，改建新的");
  }
}
if (!tag) {
  try {
    tag = await post(`/v1/partner/events/${evId}/tags`, { purpose: "checkpoint", checkpoint_id: checkpoints.check_in }, owner.token);
  } catch (e) {
    console.warn(`標籤未建立（可略過）：${e.message}`);
  }
}

const fixture = {
  api: base,
  created_at: new Date().toISOString(),
  org: { org_id: orgId, slug: ORG.slug },
  event: { event_id: evId, slug: EVENT.slug, state: ev.state, rule_revision: ev.current_rule_revision, starts_at: ev.starts_at, ends_at: ev.ends_at },
  checkpoints,
  wallets: { owner: owner.wallet, staff: staff.wallet, key_dir: KEY_DIR },
  nfc_tag: tag,
};
writeFileSync(join(KEY_DIR, "fixture.json"), JSON.stringify(fixture, null, 2));
console.log(JSON.stringify(fixture, null, 2));
console.log(`\n公開頁：GET ${base}/v1/events/${evId}；App：Arena → 合作活動 → ${EVENT.title}`);
