/**
 * 成就（PB）證明 canonical bytes（PG-R-08）。與 Rust `attestation-core::achievement` 一一對應；
 * 一致性由 `achievement-vectors.json`（Rust 產生）鎖定。與 164-byte 打卡格式分開（不同 domain／長度）。
 */
export const ACHIEVEMENT_DOMAIN = Buffer.from("NEONSHIFT_ACHIEVEMENT_V1", "ascii");
export const ACHIEVEMENT_LEN = 194;
export const ACHIEVEMENT_VERSION = 1;
export const ACHIEVEMENT_MAX_TTL_SECONDS = 900;

export const CATEGORY_CODE = { fastest_1k: 1, fastest_5k: 2, fastest_10k: 3, fastest_half: 4, fastest_marathon: 5, longest_run: 6 } as const;
export const CLASS_CODE = { organizer: 1, device: 2 } as const;

const OFF = { domain: 0, version: 24, programId: 25, clusterId: 57, wallet: 58, achievementId: 90, category: 122, cls: 123, sourceRevision: 124, rulesVersion: 128, metadataHash: 130, issuedAt: 162, expiry: 170, nonce: 178 } as const;

export interface AchievementProof {
  version: number;
  programId: Buffer;
  clusterId: number;
  wallet: Buffer;
  achievementId: Buffer;
  category: number;
  verificationClass: number;
  sourceRevision: number;
  rulesVersion: number;
  metadataHash: Buffer;
  issuedAt: bigint;
  expiry: bigint;
  nonce: Buffer;
}

export class AchievementFormatError extends Error {}
const need = (b: Buffer, n: number, f: string) => { if (b.length !== n) throw new AchievementFormatError(`${f} 必須是 ${n} bytes，實際為 ${b.length}`); };

export function encodeAchievement(p: AchievementProof): Buffer {
  need(p.programId, 32, "programId");
  need(p.wallet, 32, "wallet");
  need(p.achievementId, 32, "achievementId");
  need(p.metadataHash, 32, "metadataHash");
  need(p.nonce, 16, "nonce");
  const out = Buffer.alloc(ACHIEVEMENT_LEN);
  ACHIEVEMENT_DOMAIN.copy(out, OFF.domain);
  out.writeUInt8(p.version, OFF.version);
  p.programId.copy(out, OFF.programId);
  out.writeUInt8(p.clusterId, OFF.clusterId);
  p.wallet.copy(out, OFF.wallet);
  p.achievementId.copy(out, OFF.achievementId);
  out.writeUInt8(p.category, OFF.category);
  out.writeUInt8(p.verificationClass, OFF.cls);
  out.writeUInt32LE(p.sourceRevision, OFF.sourceRevision);
  out.writeUInt16LE(p.rulesVersion, OFF.rulesVersion);
  p.metadataHash.copy(out, OFF.metadataHash);
  out.writeBigInt64LE(p.issuedAt, OFF.issuedAt);
  out.writeBigInt64LE(p.expiry, OFF.expiry);
  p.nonce.copy(out, OFF.nonce);
  return out;
}

export function decodeAchievement(bytes: Buffer): AchievementProof {
  if (bytes.length !== ACHIEVEMENT_LEN) throw new AchievementFormatError(`長度必須是 ${ACHIEVEMENT_LEN}，實際為 ${bytes.length}`);
  if (!bytes.subarray(0, 24).equals(ACHIEVEMENT_DOMAIN)) throw new AchievementFormatError("domain 不符");
  const version = bytes.readUInt8(OFF.version);
  if (version !== ACHIEVEMENT_VERSION) throw new AchievementFormatError(`不支援的版本 ${version}`);
  const category = bytes.readUInt8(OFF.category);
  if (category < 1 || category > 6) throw new AchievementFormatError(`category ${category} 無效`);
  const verificationClass = bytes.readUInt8(OFF.cls);
  if (verificationClass !== 1 && verificationClass !== 2) throw new AchievementFormatError(`verification_class ${verificationClass} 無效`);
  return {
    version, programId: Buffer.from(bytes.subarray(OFF.programId, OFF.programId + 32)), clusterId: bytes.readUInt8(OFF.clusterId), wallet: Buffer.from(bytes.subarray(OFF.wallet, OFF.wallet + 32)), achievementId: Buffer.from(bytes.subarray(OFF.achievementId, OFF.achievementId + 32)),
    category, verificationClass, sourceRevision: bytes.readUInt32LE(OFF.sourceRevision), rulesVersion: bytes.readUInt16LE(OFF.rulesVersion), metadataHash: Buffer.from(bytes.subarray(OFF.metadataHash, OFF.metadataHash + 32)),
    issuedAt: bytes.readBigInt64LE(OFF.issuedAt), expiry: bytes.readBigInt64LE(OFF.expiry), nonce: Buffer.from(bytes.subarray(OFF.nonce, OFF.nonce + 16)),
  };
}

export function validateAchievement(p: AchievementProof): void {
  if (p.expiry <= p.issuedAt) throw new AchievementFormatError("必須 issued_at < expiry");
  const ttl = p.expiry - p.issuedAt;
  if (ttl > BigInt(ACHIEVEMENT_MAX_TTL_SECONDS)) throw new AchievementFormatError(`有效期 ${ttl} 秒超過上限 ${ACHIEVEMENT_MAX_TTL_SECONDS}`);
}
