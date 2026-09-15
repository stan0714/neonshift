/**
 * NeonShift attestation canonical bytes（TypeScript 實作）。
 *
 * 這是 `programs/attestation-core` 的鏡像實作，兩者必須逐 byte 一致。
 * 唯一的一致性保證來自 `attestation-vectors.json`：該檔由 Rust 產生，
 * 本模組的測試讀同一份檔案比對。**不要**手改向量檔來讓測試通過。
 *
 * 規格：docs/sd.md 3.5。規則：BR-14、BR-15。
 */

export const DOMAIN = Buffer.from("NEONSHIFT_ATTEST_V1", "ascii");
export const ATTESTATION_LEN = 164;
export const VERSION = 1;
export const MAX_TTL_SECONDS = 600;

export const TASK_STEPS = 1;
export const TASK_SLEEP = 2;
export const CLUSTER_DEVNET = 1;
export const CLUSTER_LOCALNET = 2;

/** 欄位 offset，對照 SD 3.5 表格。 */
const OFF = {
  domain: 0,
  version: 19,
  programId: 20,
  clusterId: 52,
  wallet: 53,
  taskDate: 85,
  taskType: 89,
  rulesVersion: 90,
  evidenceHash: 92,
  issuedAt: 124,
  notBefore: 132,
  expiry: 140,
  nonce: 148,
} as const;

export interface Attestation {
  version: number;
  /** 32 bytes */
  programId: Buffer;
  clusterId: number;
  /** 32 bytes */
  wallet: Buffer;
  /** UTC 日序 */
  taskDate: number;
  taskType: number;
  rulesVersion: number;
  /** 32 bytes */
  evidenceHash: Buffer;
  issuedAt: bigint;
  notBefore: bigint;
  expiry: bigint;
  /** 16 bytes */
  nonce: Buffer;
}

export class AttestationFormatError extends Error {}

function requireLen(buf: Buffer, len: number, field: string): void {
  if (buf.length !== len) {
    throw new AttestationFormatError(
      `${field} 必須是 ${len} bytes，實際為 ${buf.length}`,
    );
  }
}

/**
 * 產生要簽章的 164 bytes。
 *
 * 不做時間驗證，簽章前請先呼叫 `validate`。
 */
export function encode(a: Attestation): Buffer {
  requireLen(a.programId, 32, "programId");
  requireLen(a.wallet, 32, "wallet");
  requireLen(a.evidenceHash, 32, "evidenceHash");
  requireLen(a.nonce, 16, "nonce");

  const out = Buffer.alloc(ATTESTATION_LEN);
  DOMAIN.copy(out, OFF.domain);
  out.writeUInt8(a.version, OFF.version);
  a.programId.copy(out, OFF.programId);
  out.writeUInt8(a.clusterId, OFF.clusterId);
  a.wallet.copy(out, OFF.wallet);
  out.writeUInt32LE(a.taskDate, OFF.taskDate);
  out.writeUInt8(a.taskType, OFF.taskType);
  out.writeUInt16LE(a.rulesVersion, OFF.rulesVersion);
  a.evidenceHash.copy(out, OFF.evidenceHash);
  out.writeBigInt64LE(a.issuedAt, OFF.issuedAt);
  out.writeBigInt64LE(a.notBefore, OFF.notBefore);
  out.writeBigInt64LE(a.expiry, OFF.expiry);
  a.nonce.copy(out, OFF.nonce);
  return out;
}

/** 從收到的 bytes 還原欄位。只檢查結構，不檢查時效。 */
export function decode(bytes: Buffer): Attestation {
  if (bytes.length !== ATTESTATION_LEN) {
    throw new AttestationFormatError(
      `長度必須是 ${ATTESTATION_LEN}，實際為 ${bytes.length}`,
    );
  }
  if (!bytes.subarray(0, DOMAIN.length).equals(DOMAIN)) {
    throw new AttestationFormatError("domain 前綴不符");
  }
  const version = bytes.readUInt8(OFF.version);
  if (version !== VERSION) {
    throw new AttestationFormatError(`不支援的版本 ${version}`);
  }
  const taskType = bytes.readUInt8(OFF.taskType);
  if (taskType !== TASK_STEPS && taskType !== TASK_SLEEP) {
    throw new AttestationFormatError(`無效的 taskType ${taskType}`);
  }

  return {
    version,
    programId: Buffer.from(bytes.subarray(OFF.programId, OFF.programId + 32)),
    clusterId: bytes.readUInt8(OFF.clusterId),
    wallet: Buffer.from(bytes.subarray(OFF.wallet, OFF.wallet + 32)),
    taskDate: bytes.readUInt32LE(OFF.taskDate),
    taskType,
    rulesVersion: bytes.readUInt16LE(OFF.rulesVersion),
    evidenceHash: Buffer.from(
      bytes.subarray(OFF.evidenceHash, OFF.evidenceHash + 32),
    ),
    issuedAt: bytes.readBigInt64LE(OFF.issuedAt),
    notBefore: bytes.readBigInt64LE(OFF.notBefore),
    expiry: bytes.readBigInt64LE(OFF.expiry),
    nonce: Buffer.from(bytes.subarray(OFF.nonce, OFF.nonce + 16)),
  };
}

/**
 * 檢查時間欄位自洽。後端簽章前必須通過。
 *
 * 這不取代鏈上驗證，鏈上仍會用自己的 clock 檢查時效。
 */
export function validate(a: Attestation): void {
  // SD 3.3 步驟 7：issued_at <= not_before <= expiry
  if (a.issuedAt > a.notBefore || a.notBefore > a.expiry) {
    throw new AttestationFormatError("必須滿足 issuedAt <= notBefore <= expiry");
  }
  const ttl = a.expiry - a.issuedAt;
  if (ttl > BigInt(MAX_TTL_SECONDS)) {
    throw new AttestationFormatError(
      `有效期 ${ttl} 秒超過上限 ${MAX_TTL_SECONDS} 秒`,
    );
  }
}

/** 依 UTC 秒數換算任務日序（BR-05）。 */
export function taskDateFromUnix(unixSeconds: number): number {
  return Math.floor(unixSeconds / 86_400);
}
