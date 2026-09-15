import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ACHIEVEMENT_LEN, decodeAchievement, encodeAchievement, validateAchievement, type AchievementProof } from "./achievement.js";

type Vec = { name: string; fields: Record<string, string | number>; expected_hex: string; validate_ok: boolean };
const doc = JSON.parse(readFileSync(join(import.meta.dirname, "achievement-vectors.json"), "utf8")) as { length: number; vectors: Vec[] };

const fromVec = (f: Vec["fields"]): AchievementProof => ({
  version: Number(f.version), programId: Buffer.from(String(f.program_id), "hex"), clusterId: Number(f.cluster_id), wallet: Buffer.from(String(f.wallet), "hex"), achievementId: Buffer.from(String(f.achievement_id), "hex"),
  category: Number(f.category), verificationClass: Number(f.verification_class), sourceRevision: Number(f.source_revision), rulesVersion: Number(f.rules_version), metadataHash: Buffer.from(String(f.metadata_hash), "hex"),
  issuedAt: BigInt(String(f.issued_at)), expiry: BigInt(String(f.expiry)), nonce: Buffer.from(String(f.nonce), "hex"),
});

describe("PG-R-08 achievement canonical bytes", () => {
  it(`與 Rust 向量逐 byte 一致（${doc.vectors.length} 組，長度 ${ACHIEVEMENT_LEN}）`, () => {
    expect(doc.length).toBe(ACHIEVEMENT_LEN);
    for (const v of doc.vectors) {
      const p = fromVec(v.fields);
      const bytes = encodeAchievement(p);
      expect(bytes.toString("hex"), v.name).toBe(v.expected_hex);
      expect(decodeAchievement(bytes), v.name).toEqual(p);
      let ok = true;
      try { validateAchievement(p); } catch { ok = false; }
      expect(ok, v.name).toBe(v.validate_ok);
    }
  });
  it("與 164-byte 打卡格式不互通", () => {
    expect(() => decodeAchievement(Buffer.alloc(164))).toThrow(/長度/);
  });
});
