import type { AttestorSigner } from "./types.js";

/**
 * 隔離 signer service 的 client（SD 4.6：供應商不支援 Solana ed25519 KMS 時的替代）。
 * 協定：POST {url}/sign {message_b64} → {signature_b64}；GET {url}/pubkey → {pubkey_b64}；
 * 以 `Authorization: Bearer <SIGNER_TOKEN>` 保護，且 service 只接受 164-byte 訊息。
 */
export class HttpSignerClient implements AttestorSigner {
  readonly kind = "http" as const;
  private cachedPubkey: Uint8Array | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async publicKey() {
    if (this.cachedPubkey) return this.cachedPubkey;
    const r = await this.fetchImpl(`${this.baseUrl}/pubkey`, { headers: { authorization: `Bearer ${this.token}` } });
    if (!r.ok) throw new Error(`signer pubkey failed: ${r.status}`);
    const body = (await r.json()) as { pubkey_b64: string };
    this.cachedPubkey = new Uint8Array(Buffer.from(body.pubkey_b64, "base64"));
    return this.cachedPubkey;
  }

  async sign(message: Uint8Array) {
    const r = await this.fetchImpl(`${this.baseUrl}/sign`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.token}` },
      body: JSON.stringify({ message_b64: Buffer.from(message).toString("base64") }),
    });
    if (!r.ok) throw new Error(`signer sign failed: ${r.status}`);
    const body = (await r.json()) as { signature_b64: string };
    const sig = new Uint8Array(Buffer.from(body.signature_b64, "base64"));
    if (sig.length !== 64) throw new Error("signer returned malformed signature");
    return sig;
  }
}
