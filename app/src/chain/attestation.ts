/**
 * Attestation canonical bytes 解析（SD 3.5，與 programs/attestation-core、backend/src/lib/attestation.ts 同一佈局）。
 * App 只解析後端回傳的 164 bytes 以組 clock_in 參數；不自行產生。
 */
import { PublicKey } from '@solana/web3.js';

export const ATTESTATION_LEN = 164;
export const DOMAIN = 'NEONSHIFT_ATTEST_V1';

export type AttestationFields = {
  version: number;
  programId: PublicKey;
  clusterId: number;
  wallet: PublicKey;
  taskDate: number;
  taskType: number;
  rulesVersion: number;
  evidenceHash: Uint8Array;
  issuedAt: bigint;
  notBefore: bigint;
  expiry: bigint;
  nonce: Uint8Array;
};

export function decodeAttestation(bytes: Uint8Array): AttestationFields {
  if (bytes.length !== ATTESTATION_LEN) throw new Error(`attestation must be ${ATTESTATION_LEN} bytes`);
  if (new TextDecoder().decode(bytes.subarray(0, 19)) !== DOMAIN) throw new Error('attestation domain mismatch');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    version: bytes[19]!,
    programId: new PublicKey(bytes.subarray(20, 52)),
    clusterId: bytes[52]!,
    wallet: new PublicKey(bytes.subarray(53, 85)),
    taskDate: dv.getUint32(85, true),
    taskType: bytes[89]!,
    rulesVersion: dv.getUint16(90, true),
    evidenceHash: bytes.slice(92, 124),
    issuedAt: dv.getBigInt64(124, true),
    notBefore: dv.getBigInt64(132, true),
    expiry: dv.getBigInt64(140, true),
    nonce: bytes.slice(148, 164),
  };
}

/** Anchor Borsh 序列化的 AttestationArgs（欄位順序與 Rust struct 相同） */
export function encodeAttestationArgs(f: AttestationFields): Uint8Array {
  const out = new Uint8Array(1 + 32 + 1 + 32 + 4 + 1 + 2 + 32 + 8 + 8 + 8 + 16);
  const dv = new DataView(out.buffer);
  let o = 0;
  out[o++] = f.version;
  out.set(f.programId.toBytes(), o);
  o += 32;
  out[o++] = f.clusterId;
  out.set(f.wallet.toBytes(), o);
  o += 32;
  dv.setUint32(o, f.taskDate, true);
  o += 4;
  out[o++] = f.taskType;
  dv.setUint16(o, f.rulesVersion, true);
  o += 2;
  out.set(f.evidenceHash, o);
  o += 32;
  dv.setBigInt64(o, f.issuedAt, true);
  o += 8;
  dv.setBigInt64(o, f.notBefore, true);
  o += 8;
  dv.setBigInt64(o, f.expiry, true);
  o += 8;
  out.set(f.nonce, o);
  return out;
}
