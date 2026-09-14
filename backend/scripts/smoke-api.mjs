#!/usr/bin/env node
/**
 * 部署後煙霧測試（唯讀＋一次性 SIWS 登入）：
 *   cd backend && npm run smoke -- https://api.neonshift.cc
 * 檢查 /healthz、/readyz、/v1/events、SIWS nonce→verify→/v1/me/event-history、/v1/partner/me；不寫入任何活動資料。
 */
import nacl from "tweetnacl";
import bs58 from "bs58";

const base = (process.argv[2] ?? "http://127.0.0.1:6080").replace(/\/$/, "");
const get = async (p, headers = {}) => { const r = await fetch(base + p, { headers }); return { status: r.status, body: await r.json().catch(() => null) }; };
const post = async (p, body, headers = {}) => { const r = await fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; };
let fail = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) fail++; };

const h = await get("/healthz");
check("GET /healthz", h.status === 200 && h.body?.status === "ok", JSON.stringify(h.body));
const r = await get("/readyz");
check("GET /readyz (db)", r.status === 200 && r.body?.checks?.db === "ok", JSON.stringify(r.body));
const ev = await get("/v1/events");
check("GET /v1/events", ev.status === 200 && Array.isArray(ev.body?.items ?? ev.body?.events ?? []), `status ${ev.status}`);

const kp = nacl.sign.keyPair();
const wallet = bs58.encode(kp.publicKey);
const n = await post("/v1/auth/nonce", { wallet });
check("POST /v1/auth/nonce", n.status === 200 && typeof n.body?.message === "string", `status ${n.status}`);
if (n.body?.message) {
  const sig = Buffer.from(nacl.sign.detached(new TextEncoder().encode(n.body.message), kp.secretKey)).toString("base64");
  const v = await post("/v1/auth/verify", { message: n.body.message, signature_b64: sig });
  check("POST /v1/auth/verify (SIWS)", v.status === 200 && typeof v.body?.access_token === "string", `status ${v.status} ${v.body?.error?.code ?? ""}`);
  if (v.body?.access_token) {
    const auth = { authorization: `Bearer ${v.body.access_token}` };
    const me = await get("/v1/me/event-history", auth);
    check("GET /v1/me/event-history", me.status === 200 && Array.isArray(me.body?.items));
    const pm = await get("/v1/partner/me", auth);
    check("GET /v1/partner/me", pm.status === 200 && Array.isArray(pm.body?.organizations));
    const out = await post("/v1/auth/logout", {}, auth);
    check("POST /v1/auth/logout", out.status === 200 || out.status === 204, `status ${out.status}`);
  }
}
console.log(fail ? `\n${fail} 項失敗` : "\n全部通過");
process.exit(fail ? 1 : 0);
