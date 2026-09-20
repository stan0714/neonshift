/**
 * 敏感操作 challenge（PG-B-05，SD 4.2）。
 * claim／tournament_steps 各自綁定 JWT wallet、purpose、task_date、task_type、request_hash；
 * 32-byte 隨機 nonce、5 分鐘、只能消耗一次。App 以 MWA 簽署
 *   `<DOMAIN> || nonce(32) || request_hash(32) || expiry_le(i64)`
 * 後端重建同一串 bytes 驗簽，再原子消耗 challenge；JWT 只負責 session，不可取代此授權。
 */
import { randomBytes } from "node:crypto";
import bs58 from "bs58";
import nacl from "tweetnacl";

import { ApiError } from "../errors.js";
import type { Purpose, Store } from "../store/types.js";
import { sha256 } from "./tokens.js";

export const CHALLENGE_TTL_SECONDS = 5 * 60;

export const CHALLENGE_DOMAIN: Record<Exclude<Purpose, "login">, string> = {
  claim: "NEONSHIFT_CLAIM_V1",
  tournament_steps: "NEONSHIFT_TOURNAMENT_STEPS_V1",
};

export type ChallengeRequest = {
  purpose: Exclude<Purpose, "login">;
  /** 32-byte SHA-256（base64）：claim body 去掉 claim_authorization 後的 canonical bytes */
  requestHash: Buffer;
  taskDate: number;
  taskType: number;
};

export type ChallengeResponse = { challenge_b64: string; expires_at: number; purpose: string };

/** 簽署的 bytes：domain ASCII || nonce || request_hash || expiry (i64 LE，unix 秒) */
export function challengeMessage(purpose: Exclude<Purpose, "login">, nonce: Buffer, requestHash: Buffer, expiresAtUnix: number): Buffer {
  const expiry = Buffer.alloc(8);
  expiry.writeBigInt64LE(BigInt(expiresAtUnix));
  return Buffer.concat([Buffer.from(CHALLENGE_DOMAIN[purpose], "ascii"), nonce, requestHash, expiry]);
}

export class ChallengeService {
  constructor(
    private readonly store: Store,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async issue(wallet: string, req: ChallengeRequest): Promise<ChallengeResponse> {
    if (req.requestHash.length !== 32) throw new ApiError(400, "VALIDATION", "request_hash must be 32 bytes");
    if (!Number.isInteger(req.taskDate) || req.taskDate < 0 || req.taskDate > 0xffff_ffff) throw new ApiError(400, "VALIDATION", "task_date out of range");
    if (req.taskType !== 1 && req.taskType !== 2 && req.taskType !== 3) throw new ApiError(400, "VALIDATION", "task_type must be 1, 2 or 3");
    const now = this.now();
    const nonce = randomBytes(32);
    // 到期以整秒保存，與簽章 bytes 的 expiry_le 一致
    const expiresAtUnix = Math.floor(now.getTime() / 1000) + CHALLENGE_TTL_SECONDS;
    await this.store.insertChallenge({
      nonceHash: sha256(nonce),
      wallet,
      purpose: req.purpose,
      requestHash: req.requestHash,
      taskDate: req.taskDate,
      taskType: req.taskType,
      expiresAt: new Date(expiresAtUnix * 1000),
      usedAt: null,
    });
    return { challenge_b64: nonce.toString("base64"), expires_at: expiresAtUnix, purpose: req.purpose };
  }

  /**
   * 驗證並消耗。順序：格式 → 錢包簽章（避免壞簽章燒掉 challenge）→ 原子消耗 → 綁定內容比對。
   * 綁定不符時 challenge 已被消耗（防止拿同一 challenge 換不同 payload 重試）。
   */
  async verifyAndConsume(
    wallet: string,
    req: ChallengeRequest,
    authorization: { challengeB64: string; expiresAt: number; signatureB64: string },
  ): Promise<void> {
    const now = this.now();
    const nonce = Buffer.from(authorization.challengeB64, "base64");
    const sig = Buffer.from(authorization.signatureB64, "base64");
    if (nonce.length !== 32) throw new ApiError(400, "VALIDATION", "challenge must be 32 bytes");
    if (sig.length !== 64) throw new ApiError(400, "VALIDATION", "signature must be 64 bytes");
    if (!Number.isInteger(authorization.expiresAt)) throw new ApiError(400, "VALIDATION", "expires_at must be unix seconds");
    if (authorization.expiresAt * 1000 <= now.getTime()) throw new ApiError(401, "CHALLENGE_EXPIRED", "challenge expired");

    const message = challengeMessage(req.purpose, nonce, req.requestHash, authorization.expiresAt);
    const pubkey = bs58.decode(wallet);
    if (!nacl.sign.detached.verify(message, sig, pubkey)) throw new ApiError(401, "CHALLENGE_BAD_SIGNATURE", "wallet signature does not match challenge");

    const c = await this.store.consumeChallenge(sha256(nonce), now);
    if (!c) throw new ApiError(401, "CHALLENGE_INVALID", "challenge unknown, expired or already used");
    const bound =
      c.wallet === wallet &&
      c.purpose === req.purpose &&
      c.requestHash?.equals(req.requestHash) === true &&
      c.taskDate === req.taskDate &&
      c.taskType === req.taskType &&
      Math.floor(c.expiresAt.getTime() / 1000) === authorization.expiresAt;
    if (!bound) throw new ApiError(401, "CHALLENGE_MISMATCH", "challenge was issued for a different wallet, purpose or request");
  }
}
