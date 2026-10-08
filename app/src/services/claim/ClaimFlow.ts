/**
 * 打卡流程（PG-A-13，SA 6.3、SD 4.3／5.3）：
 *   ready → [steps: 20 秒 live motion] → 組 claim body → request_hash → /auth/challenge（MWA 簽）
 *   → /attestation/claim → attestation → TxBuilder → 錢包簽送 → ClaimSubmitter 冪等確認。
 * 每一步以 `onPhase` 回報供 UI 顯示 Style 7.3 狀態；不保存原始感測器序列。
 */
import type { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { randomUUID } from 'expo-crypto';

import { buildClaimInstructions } from '@/chain/txBuilder';
import { TASK_CODE, type TaskType } from '@/domain/taskEngine';
import { ApiError, apiClient, type ClaimResponse } from '@/services/api/ApiClient';
import { requestHashOf, type Json } from '@/services/api/canonical';
import { claimSubmitter, type SubmitOutcome } from '@/services/chain/ClaimSubmitter';
import { liveMotion, toSensorSummaryPayload } from '@/services/sensors/LiveMotionService';

import type { SleepResult, StepsResult } from '../../../modules/neonshift-health';
import type { LiveMotionProgress } from '../../../modules/neonshift-sensors';

export type ClaimPhase =
  | { kind: 'live_motion'; progress: LiveMotionProgress | null }
  | { kind: 'verifying' }
  | { kind: 'awaiting_signature' }
  | { kind: 'confirming'; signature: string | null }
  | { kind: 'confirmed'; signature: string | null; effectiveValue: number }
  | { kind: 'already_claimed' }
  | { kind: 'rejected'; code: string; message: string; rulesVersion?: number; effectiveValue?: number }
  | { kind: 'failed'; code: string; message: string; retryable: boolean; referenceId?: string };

export type ClaimInput = {
  player: PublicKey;
  taskType: TaskType;
  taskDate: number;
  steps: StepsResult | null;
  sleep: SleepResult | null;
  /** 維持規則 v2：運動任務證據（當日已同步的伺服器 session id；後端會自行核對） */
  workout?: { serverId: string | null; distanceM: number; movingMs: number } | null;
  chain: { mint: PublicKey; rewardVault: PublicKey };
  /** PG-V-02：目前 profile 的維持狀態（由 dashboard 讀取）；缺省視為不需前置 */
  maintenance?: { migrate: boolean; pendingEpochs: number; freezeExists?: boolean };
  client: { appVersion: string; deviceModel: string; osApi: number; sdkExtension: number };
  /** 測試注入 */
  deps?: Partial<{ liveMotion: typeof liveMotion; api: typeof apiClient; submitter: typeof claimSubmitter }>;
};

/** SD 4.3 claim body（不含 claim_authorization） */
export function buildClaimBody(input: ClaimInput, sensorSummary: Json | null): Record<string, Json> {
  const isSteps = input.taskType === 'steps';
  if (input.taskType === 'workout') {
    return {
      task_type: 'workout',
      task_date: input.taskDate,
      steps: null,
      sleep_minutes: null,
      ...(input.workout?.serverId ? { workout_session_id: input.workout.serverId } : {}),
      step_rate_summary: null,
      data_origins: [],
      sensor_summary: null,
      motion_summary: null,
      client: { app_version: input.client.appVersion, device_model: input.client.deviceModel, os_api: input.client.osApi, sdk_extension: input.client.sdkExtension },
    };
  }
  return {
    task_type: input.taskType,
    task_date: input.taskDate,
    steps: isSteps ? (input.steps?.total ?? 0) : null,
    sleep_minutes: isSteps ? null : (input.sleep?.sessions.reduce((n, s) => n + s.minutes, 0) ?? 0),
    sleep_sessions: isSteps
      ? []
      : (input.sleep?.sessions ?? []).map((s) => ({ start_unix: s.startUnix, end_unix: s.endUnix, package: s.package, recording_method: s.recordingMethod })),
    step_rate_summary: isSteps && input.steps ? { bucket_minutes: 1, buckets: input.steps.stepRateSummary.buckets.map(([m, n]) => [m, n]) } : null,
    data_origins: (isSteps ? (input.steps?.dataOrigins ?? []) : []).map((o) => ({ package: o.package, source_kind: o.sourceKind, steps: o.steps, records: o.records })),
    sensor_summary: sensorSummary,
    motion_summary: null,
    client: { app_version: input.client.appVersion, device_model: input.client.deviceModel, os_api: input.client.osApi, sdk_extension: input.client.sdkExtension },
  };
}

export async function runClaimFlow(input: ClaimInput, onPhase: (p: ClaimPhase) => void): Promise<ClaimPhase> {
  const lm = input.deps?.liveMotion ?? liveMotion;
  const api = input.deps?.api ?? apiClient;
  const submitter = input.deps?.submitter ?? claimSubmitter;
  const done = (p: ClaimPhase) => {
    onPhase(p);
    return p;
  };

  try {
    // 1. 步數任務：當日首次領取前的 live motion check（BR-09）
    let sensorSummary: Json | null = null;
    if (input.taskType === 'steps') {
      onPhase({ kind: 'live_motion', progress: null });
      const summary = await lm.run((p) => onPhase({ kind: 'live_motion', progress: p }));
      sensorSummary = toSensorSummaryPayload(summary) as unknown as Json;
    }

    // 2. claim body → request_hash
    onPhase({ kind: 'verifying' });
    const body = buildClaimBody(input, sensorSummary);
    const requestHash = requestHashOf(body);

    // 3. challenge（MWA 簽章）→ 4. attestation
    const claim_authorization = await api.authorizeClaim('claim', requestHash, input.taskDate, TASK_CODE[input.taskType]);
    let att: ClaimResponse;
    try {
      att = await api.claim({ ...body, claim_authorization }, randomUUID());
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) {
        const eb = e.body as { error?: { effective_value?: number } } | undefined;
        return done({ kind: 'rejected', code: e.code, message: e.message, rulesVersion: e.rulesVersion, effectiveValue: eb?.error?.effective_value });
      }
      throw e;
    }

    // 5. 組交易 → 6. 錢包簽送 → 7. 冪等確認
    onPhase({ kind: 'awaiting_signature' });
    const { instructions, receipt, fields } = buildClaimInstructions({
      player: input.player,
      attestation: { message_b64: att.attestation.message_b64, signature_b64: att.attestation.signature_b64, attestor_pubkey_bytes: bs58.decode(att.attestation.attestor_pubkey) },
      accts: input.chain,
      maintenance: input.maintenance,
    });
    const outcome: SubmitOutcome = await submitter.submit(input.player, instructions, receipt, { taskDate: fields.taskDate, taskType: fields.taskType });
    switch (outcome.kind) {
      case 'confirmed':
        return done({ kind: 'confirmed', signature: outcome.signature, effectiveValue: att.effective_value });
      case 'already_claimed':
        return done({ kind: 'already_claimed' });
      case 'expired':
        return done({ kind: 'failed', code: 'TX_EXPIRED', message: 'The transaction expired before it was confirmed. Nothing was claimed; try again to get a fresh attestation.', retryable: true });
      case 'failed':
        return done({ kind: 'failed', code: 'TX_FAILED', message: outcome.reason, retryable: true });
      default:
        return done({ kind: 'failed', code: 'UNKNOWN', message: 'unknown outcome', retryable: true });
    }
  } catch (e) {
    const code = (e as { code?: string })?.code ?? 'UNKNOWN';
    const message = e instanceof Error ? e.message : String(e);
    if (code === 'CANCELLED' || code === 'REJECTED') return done({ kind: 'failed', code, message: 'Request canceled. Nothing was claimed.', retryable: true });
    const referenceId = (e as { requestId?: string })?.requestId;
    return done({ kind: 'failed', code, message, retryable: true, ...(referenceId ? { referenceId } : {}) });
  }
}
