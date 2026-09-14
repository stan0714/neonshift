/**
 * 驗證 TypeScript 實作與 Rust 產生的測試向量逐 byte 一致。
 *
 * 這支測試是後端與鏈上格式一致性的唯一保證。失敗時**不要**改向量檔，
 * 要改的是 encode 實作，或先確認 Rust 那邊的規格變更是否有意為之。
 *
 * 執行：npm test（需先安裝 Node.js，見 docs/build-and-test.md 1.2）
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  encode,
  decode,
  validate,
  ATTESTATION_LEN,
  type Attestation,
} from "./attestation.js";

interface VectorFields {
  version: number;
  program_id: string;
  cluster_id: number;
  wallet: string;
  task_date: number;
  task_type: number;
  rules_version: number;
  evidence_hash: string;
  // i64 以字串表示。JSON number 無法安全承載超過 2^53 的值，
  // 直接用 number 會在解析階段就失去精度。
  issued_at: string;
  not_before: string;
  expiry: string;
  nonce: string;
}

interface Vector {
  name: string;
  note: string;
  fields: VectorFields;
  expected_hex: string;
  validate_ok: boolean;
}

const doc = JSON.parse(
  readFileSync(join(import.meta.dirname, "attestation-vectors.json"), "utf8"),
) as { length: number; vectors: Vector[] };

function toAttestation(f: VectorFields): Attestation {
  return {
    version: f.version,
    programId: Buffer.from(f.program_id, "hex"),
    clusterId: f.cluster_id,
    wallet: Buffer.from(f.wallet, "hex"),
    taskDate: f.task_date,
    taskType: f.task_type,
    rulesVersion: f.rules_version,
    evidenceHash: Buffer.from(f.evidence_hash, "hex"),
    issuedAt: BigInt(f.issued_at),
    notBefore: BigInt(f.not_before),
    expiry: BigInt(f.expiry),
    nonce: Buffer.from(f.nonce, "hex"),
  };
}

describe("attestation canonical bytes", () => {
  it("向量檔宣告的長度與常數一致", () => {
    expect(doc.length).toBe(ATTESTATION_LEN);
  });

  it("向量檔不是空的", () => {
    expect(doc.vectors.length).toBeGreaterThan(0);
  });

  for (const vec of doc.vectors) {
    it(`encode 與 Rust 一致：${vec.name}（${vec.note}）`, () => {
      const actual = encode(toAttestation(vec.fields)).toString("hex");
      expect(actual).toBe(vec.expected_hex);
    });

    it(`decode 可還原：${vec.name}`, () => {
      const bytes = Buffer.from(vec.expected_hex, "hex");
      const decoded = decode(bytes);
      expect(encode(decoded).toString("hex")).toBe(vec.expected_hex);
    });

    it(`validate 結果與 Rust 一致：${vec.name}`, () => {
      const a = toAttestation(vec.fields);
      if (vec.validate_ok) {
        expect(() => validate(a)).not.toThrow();
      } else {
        expect(() => validate(a)).toThrow();
      }
    });
  }
});

describe("validate 負向案例（SD 3.3 步驟 7，與 Rust 共用向量之外的直接測試）", () => {
  const base = toAttestation(doc.vectors[0]!.fields);

  it("至少 20 組向量，且含 validate 失敗案例", () => {
    expect(doc.vectors.length).toBeGreaterThanOrEqual(20);
    expect(doc.vectors.some((v) => !v.validate_ok)).toBe(true);
  });

  it("issuedAt > notBefore 拒絕", () => {
    expect(() => validate({ ...base, issuedAt: base.notBefore + 1n })).toThrow(/issuedAt <= notBefore/);
  });

  it("notBefore > expiry 拒絕", () => {
    expect(() => validate({ ...base, notBefore: base.expiry + 1n })).toThrow();
  });

  it("ttl 601 拒絕、600 通過、三者相等通過", () => {
    expect(() => validate({ ...base, expiry: base.issuedAt + 601n })).toThrow(/超過上限/);
    expect(() => validate({ ...base, expiry: base.issuedAt + 600n })).not.toThrow();
    expect(() => validate({ ...base, notBefore: base.issuedAt, expiry: base.issuedAt })).not.toThrow();
  });
});
