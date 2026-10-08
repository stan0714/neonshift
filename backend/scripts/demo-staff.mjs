#!/usr/bin/env node
/**
 * Demo 情境：以 demo staff／owner 金鑰扮演現場與主辦方（docs/store/event-demo-playbook.md）。
 *   cd backend && node scripts/demo-staff.mjs <api> check-in <120秒報到碼>        # staff：報到（手動輸入）
 *   cd backend && node scripts/demo-staff.mjs <api> fulfill <領取碼>              # staff：交付權益
 *   cd backend && node scripts/demo-staff.mjs <api> results <participant wallet> [elapsed_ms] [rank]   # owner：匯入並發布成績
 *   cd backend && node scripts/demo-staff.mjs <api> status                        # owner：報到／預留對帳
 * 金鑰與活動 id 來自 $KEY_DIR/fixture.json（demo-event.mjs 產生）。不動使用者錢包、不公開 OPS token。
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import nacl from "tweetnacl";
import bs58 from "bs58";

const [base0, cmd, ...rest] = process.argv.slice(2);
const base = (base0 ?? "http://127.0.0.1:6080").replace(/\/$/, "");
const KEY_DIR = process.env.KEY_DIR ?? join(homedir(), ".config", "neonshift", "dev", "demo");
const fixture = JSON.parse(readFileSync(join(KEY_DIR, "fixture.json"), "utf8"));
const evId = fixture.event.event_id;

const req = async (method, p, body, token) => {
  const r = await fetch(base + p, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${method} ${p} → ${r.status} ${JSON.stringify(json)}`);
  return json;
};
const siws = async (name) => {
  const kp = nacl.sign.keyPair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(join(KEY_DIR, `${name}.json`), "utf8"))));
  const wallet = bs58.encode(kp.publicKey);
  const n = await req("POST", "/v1/auth/nonce", { wallet });
  const sig = Buffer.from(nacl.sign.detached(new TextEncoder().encode(n.message), kp.secretKey)).toString("base64");
  const v = await req("POST", "/v1/auth/verify", { message: n.message, signature_b64: sig });
  return { wallet, token: v.access_token };
};

switch (cmd) {
  case "check-in": {
    const code = rest[0];
    if (!code) throw new Error("需要報到碼");
    const staff = await siws("demo-staff");
    const r = await req("POST", `/v1/partner/events/${evId}/check-ins`, { code, checkpoint_id: fixture.checkpoints.check_in, method: "manual", reason: "demo: staff typed the participant code" }, staff.token);
    console.log(JSON.stringify(r, null, 2));
    break;
  }
  case "fulfill": {
    const claim = rest[0];
    if (!claim) throw new Error("需要領取碼");
    const staff = await siws("demo-staff");
    const r = await req("POST", `/v1/partner/events/${evId}/redemptions/fulfill`, { claim_code: claim, checkpoint_id: fixture.checkpoints.redemption }, staff.token);
    console.log(JSON.stringify(r, null, 2));
    break;
  }
  case "results": {
    const [wallet, elapsed = "1260000", rank = "1"] = rest;
    if (!wallet) throw new Error("需要參加者錢包");
    const owner = await siws("demo-owner");
    const csv = ["participant_ref,discipline,division,finish_status,distance_m,elapsed_ms,rank", `${wallet},run,open,finished,3000,${elapsed},${rank}`].join("\n");
    const imp = await req("POST", `/v1/partner/events/${evId}/result-imports`, { source_kind: "csv", csv }, owner.token);
    console.log(`匯入 ${imp.import_id}：rows ${imp.row_count} errors ${imp.error_count}`);
    if (imp.error_count) { console.log(JSON.stringify(imp.errors, null, 2)); process.exit(1); }
    const pub = await req("POST", `/v1/partner/events/${evId}/result-imports/${imp.import_id}/publish`, {}, owner.token);
    console.log(JSON.stringify(pub, null, 2));
    break;
  }
  case "status": {
    const owner = await siws("demo-owner");
    const [ci, rd, bf] = await Promise.all([
      req("GET", `/v1/partner/events/${evId}/check-ins`, undefined, owner.token),
      req("GET", `/v1/partner/events/${evId}/redemptions`, undefined, owner.token),
      req("GET", `/v1/partner/events/${evId}/benefits`, undefined, owner.token),
    ]);
    console.log(JSON.stringify({ check_ins: ci, redemptions: rd, benefits: bf }, null, 2));
    break;
  }
  default:
    console.error("用法：demo-staff.mjs <api> check-in <code> | fulfill <claim_code> | results <wallet> [elapsed_ms] [rank] | status");
    process.exit(2);
}
