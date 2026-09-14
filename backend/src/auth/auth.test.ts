import { randomUUID } from "node:crypto";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { beforeEach, describe, expect, it } from "vitest";

import { ApiError } from "../errors.js";
import { MemoryStore } from "../store/memory.js";
import { AuthService, NONCE_TTL_SECONDS, SIWS_STATEMENT } from "./service.js";
import { buildSiwsMessage, parseSiwsMessage } from "./siws.js";
import { ACCESS_TTL_SECONDS, REFRESH_TTL_SECONDS } from "./tokens.js";

const cfg = {
  domain: "neonshift.cc",
  uri: "https://neonshift.cc",
  chainId: "solana:devnet",
  tokens: { secret: new TextEncoder().encode("x".repeat(32)), issuer: "neonshift.cc", audience: "neonshift.cc/api" },
};

function keypair() {
  const kp = nacl.sign.keyPair();
  return { kp, address: bs58.encode(kp.publicKey) };
}
function sign(kp: nacl.SignKeyPair, message: string): string {
  return Buffer.from(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey)).toString("base64");
}

let store: MemoryStore;
let clock: Date;
let auth: AuthService;
beforeEach(() => {
  store = new MemoryStore();
  clock = new Date("2026-09-14T06:00:00Z");
  auth = new AuthService(store, cfg, () => clock);
});

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof ApiError ? e.code : String(e);
  }
};

describe("SIWS 訊息", () => {
  it("build／parse 往返一致；格式不對回 null", () => {
    const f = { domain: "neonshift.cc", address: keypair().address, statement: "s", uri: "https://neonshift.cc", version: "1" as const, chainId: "solana:devnet", nonce: "n", issuedAt: "2026-09-14T00:00:00.000Z", expirationTime: "2026-09-14T00:05:00.000Z", requestId: "r" };
    const msg = buildSiwsMessage(f);
    expect(parseSiwsMessage(msg)).toEqual(f);
    expect(parseSiwsMessage(msg + "\nextra")).toBeNull();
    expect(parseSiwsMessage(msg.replace("Version: 1", "Version: 2"))).toBeNull();
    expect(parseSiwsMessage("hello")).toBeNull();
  });
});

describe("PG-B-03 /auth/nonce + /auth/verify", () => {
  it("nonce 只存雜湊、5 分鐘到期；verify 成功簽發 15 分鐘 access 與 24 小時 refresh", async () => {
    const { kp, address } = keypair();
    const n = await auth.issueNonce(address);
    expect(n.message).toContain(`neonshift.cc wants you to sign in with your Solana account:\n${address}`);
    expect(n.message).toContain(SIWS_STATEMENT);
    expect(Date.parse(n.expires_at) - clock.getTime()).toBe(NONCE_TTL_SECONDS * 1000);
    expect([...store.challenges.values()][0]!.nonceHash.toString("hex")).not.toContain(n.nonce);

    const pair = await auth.verify(n.message, sign(kp, n.message));
    expect(pair.wallet).toBe(address);
    expect(pair.expires_in).toBe(ACCESS_TTL_SECONDS);
    expect(pair.refresh_expires_in).toBe(REFRESH_TTL_SECONDS);
    const who = await auth.authenticate(pair.access_token);
    expect(who.wallet).toBe(address);
  });

  it("nonce 只能用一次；壞簽章不會燒掉 nonce", async () => {
    const { kp, address } = keypair();
    const n = await auth.issueNonce(address);
    expect(await code(auth.verify(n.message, sign(keypair().kp, n.message)))).toBe("SIWS_BAD_SIGNATURE");
    await auth.verify(n.message, sign(kp, n.message));
    expect(await code(auth.verify(n.message, sign(kp, n.message)))).toBe("SIWS_NONCE_INVALID");
  });

  it("domain／URI／chain／statement 任一不符即拒絕；訊息內 address 與 nonce 發給的錢包不同也拒絕", async () => {
    const { kp, address } = keypair();
    const n = await auth.issueNonce(address);
    const tamper = async (from: string, to: string, expected: string) => {
      const m = n.message.replace(from, to);
      expect(await code(auth.verify(m, sign(kp, m)))).toBe(expected);
    };
    await tamper("neonshift.cc wants", "evil.example wants", "SIWS_DOMAIN_MISMATCH");
    await tamper("URI: https://neonshift.cc", "URI: https://evil.example", "SIWS_URI_MISMATCH");
    await tamper("Chain ID: solana:devnet", "Chain ID: solana:mainnet", "SIWS_CHAIN_MISMATCH");
    await tamper(SIWS_STATEMENT, "Send me your SOL", "SIWS_STATEMENT_MISMATCH");
    // 他人的 nonce：訊息 address 換成自己並用自己的鑰簽 → 錢包不符
    const other = keypair();
    const m = n.message.replace(address, other.address);
    expect(await code(auth.verify(m, sign(other.kp, m)))).toBe("SIWS_WALLET_MISMATCH");
  });

  it("nonce 過期拒絕（5 分鐘）", async () => {
    const { kp, address } = keypair();
    const n = await auth.issueNonce(address);
    clock = new Date(clock.getTime() + NONCE_TTL_SECONDS * 1000 + 1);
    expect(await code(auth.verify(n.message, sign(kp, n.message)))).toBe("SIWS_EXPIRED");
  });

  it("wallet 格式檢查", async () => {
    expect(await code(auth.issueNonce("not-base58!"))).toBe("VALIDATION");
  });
});

describe("PG-B-04 refresh 輪替、重用偵測、logout、撤銷", () => {
  async function login() {
    const { kp, address } = keypair();
    const n = await auth.issueNonce(address);
    return { address, pair: await auth.verify(n.message, sign(kp, n.message)) };
  }

  it("refresh 輪替：舊 refresh 再用 → 整個 family 撤銷，含新發的 access", async () => {
    const { pair } = await login();
    const second = await auth.refresh(pair.refresh_token);
    expect(second.refresh_token).not.toBe(pair.refresh_token);
    expect(await auth.authenticate(second.access_token)).toBeTruthy();

    expect(await code(auth.refresh(pair.refresh_token))).toBe("REFRESH_REUSED");
    expect(await code(auth.authenticate(second.access_token))).toBe("SESSION_REVOKED");
    expect(await code(auth.refresh(second.refresh_token))).toBe("REFRESH_REVOKED");
  });

  it("refresh 不要求尚未過期的 access JWT；refresh 過期拒絕", async () => {
    const { pair } = await login();
    clock = new Date(clock.getTime() + (ACCESS_TTL_SECONDS + 60) * 1000);
    expect(await code(auth.authenticate(pair.access_token))).toBe("UNAUTHORIZED");
    const next = await auth.refresh(pair.refresh_token);
    expect(await auth.authenticate(next.access_token)).toBeTruthy();
    clock = new Date(clock.getTime() + REFRESH_TTL_SECONDS * 1000 + 1);
    expect(await code(auth.refresh(next.refresh_token))).toBe("REFRESH_EXPIRED");
  });

  it("logout 撤銷 family；重複登出仍成功；之後 access 與 refresh 皆無效", async () => {
    const { pair } = await login();
    const who = await auth.authenticate(pair.access_token);
    await auth.logout(who.sessionJti);
    await auth.logout(who.sessionJti);
    await auth.logout(randomUUID());
    expect(await code(auth.authenticate(pair.access_token))).toBe("SESSION_REVOKED");
    expect(await code(auth.refresh(pair.refresh_token))).toBe("REFRESH_REVOKED");
  });

  it("access JWT：演算法／iss／aud 固定，竄改即無效", async () => {
    const { pair } = await login();
    const [h, p, s] = pair.access_token.split(".");
    expect(await code(auth.authenticate(`${h}.${p}.${s}x`))).toBe("UNAUTHORIZED");
    const none = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    expect(await code(auth.authenticate(`${none}.${p}.`))).toBe("UNAUTHORIZED");
  });

  it("玩家刪除後 authenticate／refresh 皆拒絕（BR-25）", async () => {
    const { address, pair } = await login();
    store.players.get(address)!.deletedAt = clock;
    expect(await code(auth.authenticate(pair.access_token))).toBe("PLAYER_DELETED");
    expect(await code(auth.refresh(pair.refresh_token))).toBe("PLAYER_DELETED");
  });
});
