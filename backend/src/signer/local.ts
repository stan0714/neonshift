import { readFileSync } from "node:fs";
import bs58 from "bs58";
import nacl from "tweetnacl";

import type { AttestorSigner } from "./types.js";

/** 本機 dev／測試用：從 64-byte secret key（base58、JSON 陣列檔或 Uint8Array）建立。正式環境禁止。 */
export class LocalKeypairSigner implements AttestorSigner {
  readonly kind = "local" as const;
  private readonly kp: nacl.SignKeyPair;

  constructor(secretKey: Uint8Array) {
    if (secretKey.length === 32) this.kp = nacl.sign.keyPair.fromSeed(secretKey);
    else if (secretKey.length === 64) this.kp = nacl.sign.keyPair.fromSecretKey(secretKey);
    else throw new Error("secret key must be 32 or 64 bytes");
  }

  static fromEnv(value: string): LocalKeypairSigner {
    // 支援：Solana CLI keypair 檔路徑、JSON 陣列字串、base58
    if (value.startsWith("/") || value.startsWith("~") || value.endsWith(".json")) {
      const path = value.replace(/^~/, process.env.HOME ?? "");
      return new LocalKeypairSigner(Uint8Array.from(JSON.parse(readFileSync(path, "utf8")) as number[]));
    }
    if (value.trim().startsWith("[")) return new LocalKeypairSigner(Uint8Array.from(JSON.parse(value) as number[]));
    return new LocalKeypairSigner(bs58.decode(value));
  }

  static random(): LocalKeypairSigner {
    return new LocalKeypairSigner(nacl.sign.keyPair().secretKey);
  }

  async publicKey() {
    return this.kp.publicKey;
  }
  async sign(message: Uint8Array) {
    return nacl.sign.detached(message, this.kp.secretKey);
  }
}
