import { randomBytes } from "node:crypto";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { beforeEach, describe, expect, it } from "vitest";

import { ApiError } from "../errors.js";
import { MemoryStore } from "../store/memory.js";
import { CHALLENGE_TTL_SECONDS, challengeMessage, ChallengeService, type ChallengeRequest } from "./challenge.js";

let store: MemoryStore;
let clock: Date;
let svc: ChallengeService;
const kp = nacl.sign.keyPair();
const wallet = bs58.encode(kp.publicKey);
const req: ChallengeRequest = { purpose: "claim", requestHash: randomBytes(32), taskDate: 20_710, taskType: 1 };

beforeEach(() => {
  store = new MemoryStore();
  clock = new Date("2026-09-14T06:00:00Z");
  svc = new ChallengeService(store, () => clock);
});

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof ApiError ? e.code : String(e);
  }
};

function authorize(res: { challenge_b64: string; expires_at: number }, r: ChallengeRequest = req, signer = kp, expiresAt = res.expires_at) {
  const nonce = Buffer.from(res.challenge_b64, "base64");
  const msg = challengeMessage(r.purpose, nonce, r.requestHash, expiresAt);
  return { challengeB64: res.challenge_b64, expiresAt, signatureB64: Buffer.from(nacl.sign.detached(msg, signer.secretKey)).toString("base64") };
}

describe("PG-B-05 /auth/challenge", () => {
  it("簽章 bytes 佈局：domain || nonce(32) || request_hash(32) || expiry_le(8)", () => {
    const nonce = Buffer.alloc(32, 1);
    const rh = Buffer.alloc(32, 2);
    const m = challengeMessage("claim", nonce, rh, 1_789_000_300);
    expect(m.subarray(0, 18).toString("ascii")).toBe("NEONSHIFT_CLAIM_V1");
    expect(m.subarray(18, 50)).toEqual(nonce);
    expect(m.subarray(50, 82)).toEqual(rh);
    expect(m.subarray(82).readBigInt64LE()).toBe(1_789_000_300n);
    expect(challengeMessage("tournament_steps", nonce, rh, 1).subarray(0, 29).toString("ascii")).toBe("NEONSHIFT_TOURNAMENT_STEPS_V1");
  });

  it("issue：32-byte nonce、5 分鐘整秒到期、綁定 wallet／purpose／task／request_hash；驗證後消耗", async () => {
    const res = await svc.issue(wallet, req);
    expect(Buffer.from(res.challenge_b64, "base64")).toHaveLength(32);
    expect(res.expires_at).toBe(Math.floor(clock.getTime() / 1000) + CHALLENGE_TTL_SECONDS);
    await svc.verifyAndConsume(wallet, req, authorize(res));
    expect(await code(svc.verifyAndConsume(wallet, req, authorize(res)))).toBe("CHALLENGE_INVALID");
  });

  it("壞簽章不消耗 challenge；他人簽章拒絕", async () => {
    const res = await svc.issue(wallet, req);
    expect(await code(svc.verifyAndConsume(wallet, req, authorize(res, req, nacl.sign.keyPair())))).toBe("CHALLENGE_BAD_SIGNATURE");
    await svc.verifyAndConsume(wallet, req, authorize(res));
  });

  it("綁定不符（request_hash／task／purpose／wallet）→ CHALLENGE_MISMATCH 且 challenge 已消耗", async () => {
    const res = await svc.issue(wallet, req);
    const other = { ...req, requestHash: randomBytes(32) };
    expect(await code(svc.verifyAndConsume(wallet, other, authorize(res, other)))).toBe("CHALLENGE_MISMATCH");
    expect(await code(svc.verifyAndConsume(wallet, req, authorize(res)))).toBe("CHALLENGE_INVALID");

    const res2 = await svc.issue(wallet, req);
    const wrongTask = { ...req, taskType: 2 };
    expect(await code(svc.verifyAndConsume(wallet, wrongTask, authorize(res2, wrongTask)))).toBe("CHALLENGE_MISMATCH");

    const res3 = await svc.issue(wallet, req);
    const kp2 = nacl.sign.keyPair();
    expect(await code(svc.verifyAndConsume(bs58.encode(kp2.publicKey), req, authorize(res3, req, kp2)))).toBe("CHALLENGE_MISMATCH");
  });

  it("expiry 竄改（簽章仍由本人）→ 綁定不符；過期 → CHALLENGE_EXPIRED", async () => {
    const res = await svc.issue(wallet, req);
    expect(await code(svc.verifyAndConsume(wallet, req, authorize(res, req, kp, res.expires_at + 3600)))).toBe("CHALLENGE_MISMATCH");
    const res2 = await svc.issue(wallet, req);
    clock = new Date((res2.expires_at + 1) * 1000);
    expect(await code(svc.verifyAndConsume(wallet, req, authorize(res2)))).toBe("CHALLENGE_EXPIRED");
  });

  it("參數檢查", async () => {
    expect(await code(svc.issue(wallet, { ...req, requestHash: randomBytes(31) }))).toBe("VALIDATION");
    expect(await code(svc.issue(wallet, { ...req, taskType: 3 }))).toBe("VALIDATION");
    expect(await code(svc.issue(wallet, { ...req, taskDate: -1 }))).toBe("VALIDATION");
  });
});
