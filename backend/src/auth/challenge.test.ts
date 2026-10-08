import { randomBytes } from "node:crypto";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { beforeEach, describe, expect, it } from "vitest";

import { ApiError } from "../errors.js";
import { MemoryStore } from "../store/memory.js";
import { CHALLENGE_TTL_SECONDS, challengeMessage, challengeText, ChallengeService, type ChallengeRequest } from "./challenge.js";

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
  /**
   * 2026-10-06 實機：V1 是二進位 bytes，Seed Vault 顯示「This message contains characters that can't be
   * safely displayed. It may hide a transaction」。V2 改為可讀 ASCII 文字；App 端測試用同一組向量。
   */
  it("V2 簽署文字：固定向量逐字相同、純可列印 ASCII", () => {
    const text = challengeText("claim", "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", 20_732, 1, Buffer.alloc(32, 1), Buffer.alloc(32, 2), 1_791_296_177).toString("ascii");
    expect(text).toBe(
      [
        "NeonShift daily claim",
        "Approve in your wallet to claim today's mission reward.",
        "",
        "Wallet: 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
        "Mission: Steps",
        "Day (UTC): 2026-10-06",
        `Request: ${"02".repeat(32)}`,
        `Nonce: ${"01".repeat(32)}`,
        "Expires (UTC): 2026-10-06T14:16:17Z",
        "Domain: neonshift.cc",
        "Version: NEONSHIFT_CLAIM_V2",
      ].join("\n"),
    );
    expect(text).toMatch(/^[\x20-\x7e\n]+$/);
    const t = challengeText("tournament_steps", "W", 2_960, 1, Buffer.alloc(32, 1), Buffer.alloc(32, 2), 1).toString("ascii");
    expect(t.split("\n").slice(0, 5)).toEqual(["NeonShift tournament steps", "Approve in your wallet to submit your tournament steps.", "", "Wallet: W", "Week: 2960"]);
    expect(t.endsWith("Version: NEONSHIFT_TOURNAMENT_STEPS_V2")).toBe(true);
  });

  it("V2 簽章通過並消耗；V1 簽章（舊版 App）仍通過；V2 內容與請求不符則拒絕", async () => {
    const signV2 = (res: { challenge_b64: string; expires_at: number }, r: ChallengeRequest) => {
      const msg = challengeText(r.purpose, wallet, r.taskDate, r.taskType, Buffer.from(res.challenge_b64, "base64"), r.requestHash, res.expires_at);
      return { challengeB64: res.challenge_b64, expiresAt: res.expires_at, signatureB64: Buffer.from(nacl.sign.detached(msg, kp.secretKey)).toString("base64") };
    };
    const a = await svc.issue(wallet, req);
    await svc.verifyAndConsume(wallet, req, signV2(a, req));
    expect(await code(svc.verifyAndConsume(wallet, req, signV2(a, req)))).toBe("CHALLENGE_INVALID");
    const b = await svc.issue(wallet, req);
    await svc.verifyAndConsume(wallet, req, authorize(b)); // V1
    const c = await svc.issue(wallet, req);
    // 簽的是另一個任務類型的文字 → 與請求重建的文字不符
    expect(await code(svc.verifyAndConsume(wallet, req, signV2(c, { ...req, taskType: 3 })))).toBe("CHALLENGE_BAD_SIGNATURE");
  });

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
    expect(await code(svc.issue(wallet, { ...req, taskType: 4 }))).toBe("VALIDATION"); // 3＝運動任務（維持規則 v2）為合法
    expect(await code(svc.issue(wallet, { ...req, taskDate: -1 }))).toBe("VALIDATION");
  });
});
