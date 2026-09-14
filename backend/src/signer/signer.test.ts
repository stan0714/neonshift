import bs58 from "bs58";
import nacl from "tweetnacl";
import { describe, expect, it } from "vitest";

import { decode } from "../lib/attestation.js";
import { AttestationSigner } from "./attestation-signer.js";
import { HttpSignerClient } from "./http.js";
import { LocalKeypairSigner } from "./local.js";

const programId = new Uint8Array(32).fill(0x11);
const wallet = bs58.encode(nacl.sign.keyPair().publicKey);

describe("PG-B-10 AttestationSigner", () => {
  it("164 bytes、無金額欄位、expiry = issued_at + ttl ≤ 600、簽章可被公鑰驗證", async () => {
    const local = LocalKeypairSigner.random();
    const signer = new AttestationSigner(local);
    const issued = await signer.issue({ programId, clusterId: 1, wallet, taskDate: 20_710, taskType: "steps", rulesVersion: 3, evidenceHash: new Uint8Array(32).fill(7), issuedAt: new Date("2026-09-14T06:00:00Z") });
    expect(issued.message).toHaveLength(164);
    expect(issued.signature).toHaveLength(64);
    expect(nacl.sign.detached.verify(issued.message, issued.signature, await local.publicKey())).toBe(true);
    const f = decode(issued.message);
    expect(f.expiry - f.issuedAt).toBe(600n);
    expect(f.notBefore).toBe(f.issuedAt);
    expect(f.taskType).toBe(1);
    expect(bs58.encode(f.wallet)).toBe(wallet);
    expect(Object.keys(f)).not.toContain("amount");
    await expect(signer.issue({ programId, clusterId: 1, wallet, taskDate: 1, taskType: "sleep", rulesVersion: 3, evidenceHash: new Uint8Array(32), issuedAt: new Date(), ttlSeconds: 601 })).rejects.toThrow(/ttl/);
  });

  it("LocalKeypairSigner 支援 32-byte seed、64-byte secret、JSON 陣列與 base58", async () => {
    const kp = nacl.sign.keyPair();
    const a = new LocalKeypairSigner(kp.secretKey);
    const b = new LocalKeypairSigner(kp.secretKey.slice(0, 32));
    const c = LocalKeypairSigner.fromEnv(JSON.stringify(Array.from(kp.secretKey)));
    const d = LocalKeypairSigner.fromEnv(bs58.encode(kp.secretKey));
    for (const s of [a, b, c, d]) expect(Buffer.from(await s.publicKey())).toEqual(Buffer.from(kp.publicKey));
    expect(() => new LocalKeypairSigner(new Uint8Array(10))).toThrow();
  });

  it("HttpSignerClient：帶 Bearer、只接受 64-byte 簽章、快取公鑰", async () => {
    const kp = nacl.sign.keyPair();
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      calls.push(String(url));
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer tok");
      if (String(url).endsWith("/pubkey")) return new Response(JSON.stringify({ pubkey_b64: Buffer.from(kp.publicKey).toString("base64") }));
      const { message_b64 } = JSON.parse(String(init?.body)) as { message_b64: string };
      const sig = nacl.sign.detached(Buffer.from(message_b64, "base64"), kp.secretKey);
      return new Response(JSON.stringify({ signature_b64: Buffer.from(sig).toString("base64") }));
    }) as typeof fetch;
    const client = new HttpSignerClient("https://signer.internal", "tok", fetchImpl);
    const signer = new AttestationSigner(client);
    const issued = await signer.issue({ programId, clusterId: 1, wallet, taskDate: 1, taskType: "steps", rulesVersion: 3, evidenceHash: new Uint8Array(32), issuedAt: new Date() });
    expect(nacl.sign.detached.verify(issued.message, issued.signature, kp.publicKey)).toBe(true);
    await client.publicKey();
    expect(calls.filter((c) => c.endsWith("/pubkey"))).toHaveLength(1);
  });
});
