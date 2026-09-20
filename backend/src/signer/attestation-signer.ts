/**
 * AttestationSigner（PG-B-10，SD 3.5／4.6）：組 164-byte canonical bytes → validate → 簽章。
 * 不含金額（C-03）；expiry 固定 issued_at + TTL（≤ 600）；nonce 16-byte 隨機。
 */
import { randomBytes } from "node:crypto";
import bs58 from "bs58";

import { CHAIN_CLOCK_SKEW_SECONDS } from "../lib/achievement.js";
import { type Attestation, encode, MAX_TTL_SECONDS, TASK_SLEEP, TASK_STEPS, TASK_WORKOUT, validate, VERSION } from "../lib/attestation.js";
import type { AttestorSigner } from "./types.js";

export type IssueInput = {
  programId: Uint8Array;
  clusterId: number;
  wallet: string;
  taskDate: number;
  taskType: "steps" | "sleep" | "workout";
  rulesVersion: number;
  evidenceHash: Uint8Array;
  issuedAt: Date;
  /** 預設 600；不得超過 MAX_TTL_SECONDS */
  ttlSeconds?: number;
};

export type IssuedAttestation = {
  message: Buffer;
  signature: Buffer;
  attestorPubkey: Buffer;
  nonce: Buffer;
  issuedAt: number;
  expiresAt: number;
  fields: Attestation;
};

export class AttestationSigner {
  constructor(private readonly signer: AttestorSigner) {}

  async publicKeyBase58(): Promise<string> {
    return bs58.encode(await this.signer.publicKey());
  }

  async issue(input: IssueInput): Promise<IssuedAttestation> {
    const ttl = input.ttlSeconds ?? MAX_TTL_SECONDS;
    if (ttl <= 0 || ttl > MAX_TTL_SECONDS) throw new Error(`ttl must be within 1..${MAX_TTL_SECONDS}`);
    const issuedAt = Math.floor(input.issuedAt.getTime() / 1000) - CHAIN_CLOCK_SKEW_SECONDS; // 鏈上時鐘落後寬限（同成就證明）
    const nonce = randomBytes(16);
    const fields: Attestation = {
      version: VERSION,
      programId: Buffer.from(input.programId),
      clusterId: input.clusterId,
      wallet: Buffer.from(bs58.decode(input.wallet)),
      taskDate: input.taskDate,
      taskType: input.taskType === "steps" ? TASK_STEPS : input.taskType === "workout" ? TASK_WORKOUT : TASK_SLEEP,
      rulesVersion: input.rulesVersion,
      evidenceHash: Buffer.from(input.evidenceHash),
      issuedAt: BigInt(issuedAt),
      notBefore: BigInt(issuedAt),
      expiry: BigInt(issuedAt + ttl),
      nonce,
    };
    validate(fields);
    const message = encode(fields);
    const signature = Buffer.from(await this.signer.sign(message));
    return { message, signature, attestorPubkey: Buffer.from(await this.signer.publicKey()), nonce, issuedAt, expiresAt: issuedAt + ttl, fields };
  }
}
