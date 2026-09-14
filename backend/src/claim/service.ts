/**
 * `POST /attestation/claim`（PG-B-11，SD 4.3）。
 * 順序：身分（呼叫端 requireAuth）→ schema → idempotency 取得處理權（同 key 先回既有結果）
 * → challenge 驗簽與原子消耗 → 風險判定 → 落 health_snapshots／risk_decisions
 * → 簽發 attestation（落 attestations）→ 保存完整回應 → 回傳。
 * 回應不含風險分數與門檻；拒絕帶 rules_version。
 */
import { randomUUID } from "node:crypto";
import bs58 from "bs58";

import { ChallengeService } from "../auth/challenge.js";
import { ApiError } from "../errors.js";
import { evaluate, type RiskDecision } from "../risk/engine.js";
import type { RuleSet } from "../risk/rules.js";
import type { AttestationSigner } from "../signer/index.js";
import type { Store } from "../store/types.js";
import { type Json, requestHashOf, sha256Canonical } from "./canonical.js";
import { type ClaimRequest, claimRequestSchema, TASK_TYPES } from "./schema.js";

export type ClaimConfig = { programId: Uint8Array; clusterId: number };

export type ClaimSuccess = {
  attestation: { message_b64: string; signature_b64: string; attestor_pubkey: string; expires_at: number; nonce: string };
  rules_version: number;
  /** 夾限後有效值，供 UI 顯示進度 */
  effective_value: number;
};

export type ClaimOutcome = { httpStatus: number; body: ClaimSuccess | { error: { code: string; message: string; rules_version: number; effective_value?: number } } };

const REJECT_MESSAGES: Record<string, string> = {
  SRC_UNATTRIBUTED: "Steps could not be attributed to this device's built-in counter.",
  SRC_MANUAL: "Manually entered steps do not count.",
  SLEEP_RANGE: "Sleep duration is outside the accepted range.",
  NO_SENSOR: "Complete the short motion check before claiming steps.",
  LIVE_MOTION_INCOMPLETE: "The motion check did not record enough movement. Walk a little and try again.",
  TASK_NOT_MET: "Today's mission goal has not been reached yet.",
  RISK_SCORE: "This claim could not be verified.",
};

export class ClaimService {
  constructor(
    private readonly store: Store,
    private readonly challenge: ChallengeService,
    private readonly signer: AttestationSigner,
    private readonly rules: RuleSet,
    private readonly cfg: ClaimConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** 啟動時把規則集寫入 rule_sets（同版本不同 hash 會拋錯，阻止靜默改規則） */
  async init(): Promise<void> {
    await this.store.ensureRuleSet({ rulesVersion: this.rules.version, rulesHash: this.rules.hash, config: this.rules.config });
  }

  async claim(wallet: string, idempotencyKey: string, rawBody: unknown): Promise<ClaimOutcome> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
      throw new ApiError(400, "VALIDATION", "Idempotency-Key must be a UUID");
    }
    const parsed = claimRequestSchema.safeParse(rawBody);
    if (!parsed.success) throw new ApiError(400, "VALIDATION", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const req = parsed.data;
    const requestHash = requestHashOf(rawBody as Record<string, Json>);
    const now = this.now();

    // idempotency：同 key 先回既有結果；不同 payload → 409
    const begin = await this.store.beginClaim(wallet, idempotencyKey, requestHash, now);
    if (!begin.acquired) {
      const ex = begin.existing!;
      if (!ex.requestHash.equals(requestHash)) throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was used with a different payload");
      if (ex.status === "processing") throw new ApiError(409, "IDEMPOTENCY_IN_PROGRESS", "a request with this key is being processed");
      return { httpStatus: ex.httpStatus!, body: ex.response as ClaimOutcome["body"] };
    }

    try {
      const taskType = TASK_TYPES[req.task_type];
      await this.challenge.verifyAndConsume(
        wallet,
        { purpose: "claim", requestHash, taskDate: req.task_date, taskType },
        { challengeB64: req.claim_authorization.challenge_b64, expiresAt: req.claim_authorization.expires_at, signatureB64: req.claim_authorization.signature_b64 },
      );

      const decision = evaluate(req, this.rules);
      if (req.task_type === "steps" && decision.steps?.inconsistent) {
        throw new ApiError(400, "VALIDATION", "step_rate_summary buckets do not add up to attributed steps");
      }
      const inputHash = this.evidenceHash(req, decision);
      const snapshotId = await this.store.insertHealthSnapshot({
        wallet,
        taskDate: req.task_date,
        taskType,
        attributedSteps: decision.steps?.attributedSteps ?? null,
        sleepMinutes: decision.sleepMinutes,
        sourceSummary: req.data_origins,
        stepRateSummary: req.step_rate_summary,
        sleepOverlapMinutes: decision.sleepOverlapMinutes,
        sensorSummary: req.sensor_summary,
        motionSummary: req.motion_summary,
        clientInfo: req.client,
        inputHash,
      });
      await this.store.insertRiskDecision({
        snapshotId,
        rulesVersion: decision.rulesVersion,
        riskScore: decision.score,
        matchedRules: decision.matched,
        decision: decision.decision,
        rejectCode: decision.rejectCode,
      });

      let outcome: ClaimOutcome;
      if (decision.decision === "reject") {
        outcome = {
          httpStatus: 422,
          body: { error: { code: decision.rejectCode!, message: REJECT_MESSAGES[decision.rejectCode!] ?? "Claim rejected", rules_version: decision.rulesVersion, effective_value: decision.effectiveValue } },
        };
      } else {
        const issued = await this.signer.issue({
          programId: this.cfg.programId,
          clusterId: this.cfg.clusterId,
          wallet,
          taskDate: req.task_date,
          taskType: req.task_type,
          rulesVersion: decision.rulesVersion,
          evidenceHash: inputHash,
          issuedAt: now,
        });
        await this.store.insertAttestation({
          nonce: issued.nonce,
          idempotencyKey,
          requestHash,
          wallet,
          taskDate: req.task_date,
          taskType,
          rulesVersion: decision.rulesVersion,
          evidenceHash: inputHash,
          issuedAt: new Date(issued.issuedAt * 1000),
          expiresAt: new Date(issued.expiresAt * 1000),
        });
        outcome = {
          httpStatus: 200,
          body: {
            attestation: {
              message_b64: issued.message.toString("base64"),
              signature_b64: issued.signature.toString("base64"),
              attestor_pubkey: bs58.encode(issued.attestorPubkey),
              expires_at: issued.expiresAt,
              nonce: issued.nonce.toString("base64"),
            },
            rules_version: decision.rulesVersion,
            effective_value: decision.effectiveValue,
          },
        };
      }
      // 完整回應保存（含 signature），重試期限內原樣回傳，不重新簽章
      await this.store.completeClaim(wallet, idempotencyKey, outcome.httpStatus === 200 ? "succeeded" : "rejected", outcome.httpStatus, outcome.body, now);
      return outcome;
    } catch (e) {
      // 未完成處理（challenge 失敗、signer 失敗、crash 前）：釋放 key 讓 client 可重試
      await this.store.releaseClaim(wallet, idempotencyKey).catch(() => {});
      throw e;
    }
  }

  /** evidence_hash：只含實際參與判定的欄位、來源摘要與 rules_hash（SD 3.5），RFC 8785 後 SHA-256 */
  private evidenceHash(req: ClaimRequest, d: RiskDecision): Buffer {
    const input: Json = {
      task_type: req.task_type,
      task_date: req.task_date,
      attributed_steps: d.steps?.attributedSteps ?? null,
      effective_value: d.effectiveValue,
      sleep_minutes: d.sleepMinutes,
      sleep_overlap_minutes: d.sleepOverlapMinutes,
      data_origins: req.data_origins.map((o) => ({ package: o.package, source_kind: o.source_kind, steps: o.steps })),
      sensor_summary: req.sensor_summary,
      motion_summary: req.motion_summary,
      matched_rules: d.matched,
      rules_version: d.rulesVersion,
      rules_hash: d.rulesHash.toString("hex"),
    };
    return sha256Canonical(input);
  }
}

export const newIdempotencyKey = () => randomUUID();
