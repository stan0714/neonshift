#!/usr/bin/env node
/**
 * 測試活動的小工具（fixture 由 scripts/demo-event.mjs 建立）：以 demo owner 金鑰 SIWS 後執行。
 *   node scripts/demo-event-admin.mjs <base> show
 *   node scripts/demo-event-admin.mjs <base> add-staff <wallet> [check_in|redemption|all]  # 指派 staff（真機雙角色驗收用；一個錢包同時只有一個 staff 站點）
 *   node scripts/demo-event-admin.mjs <base> revoke-tag <tag_id>                        # 停用一枚 NFC 標籤
 *   node scripts/demo-event-admin.mjs <base> set-stock <benefit_name> <n>               # 調整庫存（最後一件競態測試）
 * 金鑰在 $KEY_DIR（預設 ~/.config/neonshift/dev/demo），不進 repo；不動使用者錢包。
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import nacl from "tweetnacl";
import bs58 from "bs58";

const base = (process.argv[2] ?? "http://127.0.0.1:6080").replace(/\/$/, "");
const cmd = process.argv[3] ?? "show";
const KEY_DIR = process.env.KEY_DIR ?? join(homedir(), ".config", "neonshift", "dev", "demo");
const fixtureFile = join(KEY_DIR, "fixture.json");
if (!existsSync(fixtureFile)) throw new Error(`找不到 ${fixtureFile}；先跑 scripts/demo-event.mjs`);
const fixture = JSON.parse(readFileSync(fixtureFile, "utf8"));
const evId = fixture.event.event_id;

const req = async (method, p, body, token) => {
  const r = await fetch(base + p, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const json = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${method} ${p} → ${r.status} ${JSON.stringify(json)}`);
  return json;
};
const owner = await (async () => {
  const kp = nacl.sign.keyPair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(join(KEY_DIR, "demo-owner.json"), "utf8"))));
  const wallet = bs58.encode(kp.publicKey);
  const n = await req("POST", "/v1/auth/nonce", { wallet });
  const sig = Buffer.from(nacl.sign.detached(new TextEncoder().encode(n.message), kp.secretKey)).toString("base64");
  const v = await req("POST", "/v1/auth/verify", { message: n.message, signature_b64: sig });
  return { wallet, token: v.access_token };
})();

if (cmd === "show") {
  const [ev, benefits, checkIns, redemptions] = await Promise.all([
    req("GET", `/v1/events/${evId}`),
    req("GET", `/v1/events/${evId}/benefits`),
    req("GET", `/v1/partner/events/${evId}/check-ins`, undefined, owner.token),
    req("GET", `/v1/partner/events/${evId}/redemptions`, undefined, owner.token),
  ]);
  console.log(`活動 ${ev.title}\n  ${ev.state} · 報名 ${ev.registration_count}/${ev.capacity}（剩 ${ev.spots_left}）· 規則 v${ev.rules.version}`);
  console.log(`  時窗 ${ev.starts_at} → ${ev.ends_at}（${ev.timezone}）· 章 報到=${ev.badges.check_in} 完賽=${ev.badges.finish}`);
  for (const b of benefits.benefits) console.log(`  品項 ${b.name}：剩 ${b.remaining}、每人 ${b.per_person_limit}、需報到 ${b.requires_checkin}`);
  console.log(`  報到 ${(checkIns.items ?? checkIns.check_ins ?? []).length} 筆 · 預留／交付 ${(redemptions.items ?? redemptions.redemptions ?? []).length} 筆`);
  console.log(`  NFC ${fixture.nfc_tag?.tags?.map((t) => t.uri).join(", ") ?? "（無）"}`);
  console.log(`  staff 位址（fixture）${fixture.wallets.staff}`);
  // 沒有「列出全部角色」的端點；由稽核記錄推現行授權（grant 後未被 revoke）
  const audit = await req("GET", `/v1/partner/events/${evId}/audit`, undefined, owner.token);
  const grants = new Map();
  for (const e of [...(audit.entries ?? [])].reverse()) {
    if (e.action === "role.grant") grants.set(`${e.target}|${e.details?.role}`, e.details);
    else if (e.action === "role.revoke") grants.delete(`${e.target}|${e.details?.role}`);
  }
  const cpName = Object.fromEntries(Object.entries(fixture.checkpoints).map(([k, v]) => [v, k]));
  if (grants.size === 0) console.log("  角色 （尚未指派）");
  for (const [k, d] of grants) {
    const [wallet] = k.split("|");
    console.log(`  角色 ${d.role} ${wallet} @ ${d.checkpoint_id ? `${cpName[d.checkpoint_id] ?? d.checkpoint_id}` : "全站點"}`);
  }
} else if (cmd === "add-staff") {
  const wallet = process.argv[4];
  const purpose = process.argv[5] ?? "check_in";
  if (!wallet) throw new Error("用法：add-staff <wallet> [check_in|redemption]");
  const checkpointId = purpose === "all" ? null : fixture.checkpoints[purpose];
  if (purpose !== "all" && !checkpointId) throw new Error(`未知站點 ${purpose}（可用：check_in｜redemption｜all）`);
  const r = await req("POST", `/v1/partner/events/${evId}/roles`, { wallet, role: "staff", checkpoint_id: checkpointId }, owner.token);
  console.log(`已指派 staff：${wallet} @ ${purpose}（${checkpointId ?? "全站點"}）`, JSON.stringify(r));
} else if (cmd === "revoke-tag") {
  const tagId = process.argv[4];
  if (!tagId) throw new Error("用法：revoke-tag <tag_id>");
  await req("POST", `/v1/partner/events/${evId}/tags/${tagId}/revoke`, {}, owner.token);
  console.log(`已停用標籤 ${tagId}`);
} else if (cmd === "set-stock") {
  const [name, n] = [process.argv[4], Number(process.argv[5])];
  const benefits = await req("GET", `/v1/partner/events/${evId}/benefits`, undefined, owner.token);
  const b = (benefits.items ?? benefits.benefits ?? []).find((x) => x.name === name || x.benefit_id === name);
  if (!b) throw new Error(`找不到品項 ${name}`);
  const r = await req("PATCH", `/v1/partner/events/${evId}/benefits/${b.benefit_id}`, { stock_total: n }, owner.token);
  console.log(`庫存改為 ${n}`, JSON.stringify(r));
} else {
  throw new Error(`未知指令 ${cmd}`);
}
