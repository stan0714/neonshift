import nacl from "tweetnacl";
import { describe, expect, it } from "vitest";

import { AttestationSigner } from "./attestation-signer.js";
import { HttpSignerClient } from "./http.js";
import { LocalKeypairSigner } from "./local.js";
import { buildSignerService } from "./service.js";

const TOKEN = "t".repeat(40);
const programId = new Uint8Array(32).fill(0x11);

describe("signer service（隔離 process）", () => {
  it("Bearer 保護；/pubkey；/sign 只接受 164-byte 且時間自洽的 attestation；與 HttpSignerClient 相容", async () => {
    const local = LocalKeypairSigner.random();
    const svc = buildSignerService({ signer: local, token: TOKEN });
    await svc.ready();

    expect((await svc.inject({ method: "GET", url: "/healthz" })).statusCode).toBe(200);
    expect((await svc.inject({ method: "GET", url: "/pubkey" })).statusCode).toBe(401);
    expect((await svc.inject({ method: "GET", url: "/pubkey", headers: { authorization: `Bearer ${"x".repeat(40)}` } })).statusCode).toBe(401);
    const pk = await svc.inject({ method: "GET", url: "/pubkey", headers: { authorization: `Bearer ${TOKEN}` } });
    expect(Buffer.from(pk.json<{ pubkey_b64: string }>().pubkey_b64, "base64")).toEqual(Buffer.from(await local.publicKey()));

    const bad = await svc.inject({ method: "POST", url: "/sign", headers: { authorization: `Bearer ${TOKEN}` }, payload: { message_b64: Buffer.alloc(10).toString("base64") } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ error: "BAD_LENGTH" });

    // 透過 fastify inject 當作 fetch，讓 HttpSignerClient 端到端走一遍
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      const u = new URL(String(url));
      const r = await svc.inject({ method: (init?.method ?? "GET") as "GET" | "POST", url: u.pathname, headers: init?.headers as Record<string, string>, ...(init?.body ? { payload: String(init.body) } : {}) });
      return new Response(r.body, { status: r.statusCode, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const client = new HttpSignerClient("http://127.0.0.1:6081", TOKEN, fetchImpl);
    const issued = await new AttestationSigner(client).issue({ programId, clusterId: 1, wallet: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", taskDate: 20_710, taskType: "steps", rulesVersion: 3, evidenceHash: new Uint8Array(32).fill(7), issuedAt: new Date() });
    expect(nacl.sign.detached.verify(issued.message, issued.signature, await local.publicKey())).toBe(true);

    // 164 bytes 但時間不自洽（expiry < issuedAt）→ 拒簽
    const { decode, encode } = await import("../lib/attestation.js");
    const a = decode(Buffer.from(issued.message));
    const invalid = encode({ ...a, expiry: a.issuedAt - 1n });
    const rej = await svc.inject({ method: "POST", url: "/sign", headers: { authorization: `Bearer ${TOKEN}` }, payload: { message_b64: invalid.toString("base64") } });
    expect(rej.statusCode).toBe(400);
    expect(rej.json()).toEqual({ error: "INVALID_ATTESTATION" });
    await svc.close();
  });

  it("token 太短拒絕啟動", () => {
    expect(() => buildSignerService({ signer: LocalKeypairSigner.random(), token: "short" })).toThrow(/SIGNER_TOKEN/);
  });
});
