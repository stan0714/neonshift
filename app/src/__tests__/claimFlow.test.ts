import { PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';
import bs58 from 'bs58';

import { encodeAttestationArgs, decodeAttestation } from '@/chain/attestation';
import { ApiError } from '@/services/api/ApiClient';
import { buildClaimBody, runClaimFlow, type ClaimInput, type ClaimPhase } from '@/services/claim/ClaimFlow';

import vectors from '../../../backend/src/lib/attestation-vectors.json';

const PID = '5vTs2vGPuADyCLtxkXpWQpuK25XoTihJ41drGKmfBjAf';
jest.mock('@/config/app', () => ({ APP_CONFIG: { ...jest.requireActual('@/config/app').APP_CONFIG, programId: '5vTs2vGPuADyCLtxkXpWQpuK25XoTihJ41drGKmfBjAf', chainConfigured: true } }));
jest.mock('expo-crypto', () => ({ randomUUID: () => '11111111-2222-4333-8444-555555555555' }));

const player = PublicKey.unique();

function attestationFor(wallet: PublicKey): string {
  const f = decodeAttestation(new Uint8Array(Buffer.from((vectors as { vectors: { expected_hex: string }[] }).vectors[0]!.expected_hex, 'hex')));
  f.wallet = wallet;
  f.programId = new PublicKey(PID);
  const message = new Uint8Array(164);
  message.set(new TextEncoder().encode('NEONSHIFT_ATTEST_V1'), 0);
  message.set(encodeAttestationArgs(f), 19);
  return Buffer.from(message).toString('base64');
}

function input(over: Partial<ClaimInput> = {}): ClaimInput {
  return {
    player,
    taskType: 'steps',
    taskDate: 20_706,
    steps: { total: 9_420, dataOrigins: [{ package: 'android', sourceKind: 'android_legacy', steps: 9_420, records: 40 }], stepRateSummary: { bucketMinutes: 1, buckets: [[600, 9_420]], observedMinutes: 1, maxStepsPerMinute: 9_420 }, deviceSpn: null },
    sleep: null,
    chain: { mint: PublicKey.unique(), rewardVault: PublicKey.unique() },
    client: { appVersion: '0.1.0', deviceModel: 'Seeker', osApi: 36, sdkExtension: 22 },
    ...over,
  };
}

const summary = { sampleRateHz: 49.5, windowCount: 2, windowSeconds: 10, stepDelta: 34, stepCounterAvailable: true, dominantFreqHz: 1.9, freqVariance: 0.3, accelRms: 1.2, gyroRms: 0.4, zeroCrossingRate: 3.6, accelSource: 'linear_acceleration' as const, windows: [] };

function deps(over: Partial<{ claimResult: unknown; submitOutcome: unknown }> = {}) {
  const lm = { run: jest.fn(async (onP?: (p: unknown) => void) => { onP?.({ elapsedSeconds: 10, durationSeconds: 20, windowIndex: 1, windowCount: 2 }); return summary; }), cancel: jest.fn(), getCapabilities: jest.fn() };
  const api = {
    authorizeClaim: jest.fn(async () => ({ challenge_b64: 'c', expires_at: 1, signature_b64: 's' })),
    claim: jest.fn(async () => over.claimResult ?? { attestation: { message_b64: attestationFor(player), signature_b64: Buffer.alloc(64).toString('base64'), attestor_pubkey: bs58.encode(new Uint8Array(32).fill(1)), expires_at: 1, nonce: 'n' }, rules_version: 3, effective_value: 9_420 }),
  };
  const submitter = { submit: jest.fn(async () => over.submitOutcome ?? { kind: 'confirmed', signature: 'SIG' }), receiptExists: jest.fn() };
  return { liveMotion: lm as never, api: api as never, submitter: submitter as never, raw: { lm, api, submitter } };
}

describe('PG-A-13 ClaimFlow', () => {
  test('claim body 依 SD 4.3：步數含桶與來源，睡眠含 session；不含原始序列', () => {
    const b = buildClaimBody(input(), { sample_rate_hz: 49.5 } as never);
    expect(b.task_type).toBe('steps');
    expect(b.step_rate_summary).toEqual({ bucket_minutes: 1, buckets: [[600, 9_420]] });
    expect(b.data_origins).toEqual([{ package: 'android', source_kind: 'android_legacy', steps: 9_420, records: 40 }]);
    expect(b.sleep_minutes).toBeNull();
    const s = buildClaimBody(input({ taskType: 'sleep', steps: null, sleep: { sessions: [{ startUnix: 1, endUnix: 27_001, minutes: 450, package: 'p', recordingMethod: 'automatic' }] } }), null);
    expect(s.sleep_minutes).toBe(450);
    expect(s.sleep_sessions).toEqual([{ start_unix: 1, end_unix: 27_001, package: 'p', recording_method: 'automatic' }]);
    expect(s.sensor_summary).toBeNull();
    expect(s.data_origins).toEqual([]);
  });

  test('步數：live motion → verifying → challenge → claim → awaiting_signature → confirmed；順序與參數', async () => {
    const d = deps();
    const phases: ClaimPhase['kind'][] = [];
    const final = await runClaimFlow(input({ deps: d }), (p) => phases.push(p.kind));
    expect(final).toEqual({ kind: 'confirmed', signature: 'SIG', effectiveValue: 9_420 });
    expect(phases).toEqual(['live_motion', 'live_motion', 'verifying', 'awaiting_signature', 'confirmed']);
    expect(d.raw.api.authorizeClaim).toHaveBeenCalledWith('claim', expect.any(Uint8Array), 20_706, 1);
    const [body, key] = d.raw.api.claim.mock.calls[0] as unknown as [Record<string, unknown>, string];
    expect(key).toBe('11111111-2222-4333-8444-555555555555');
    expect(body.claim_authorization).toEqual({ challenge_b64: 'c', expires_at: 1, signature_b64: 's' });
    expect(body.sensor_summary).toMatchObject({ step_delta: 34, window_count: 2 });
    const [, instructions, receipt] = d.raw.submitter.submit.mock.calls[0] as unknown as [unknown, unknown[], PublicKey];
    expect(instructions).toHaveLength(3);
    expect(receipt).toBeInstanceOf(PublicKey);
  });

  test('睡眠不做 live motion', async () => {
    const d = deps();
    await runClaimFlow(input({ taskType: 'sleep', steps: null, sleep: { sessions: [] }, deps: d }), () => {});
    expect(d.raw.lm.run).not.toHaveBeenCalled();
    expect(d.raw.api.authorizeClaim).toHaveBeenCalledWith('claim', expect.any(Uint8Array), 20_706, 2);
  });

  test('後端 422 拒絕 → rejected 帶碼與有效值；不送交易', async () => {
    const d = deps();
    d.raw.api.claim.mockRejectedValueOnce(new ApiError(422, 'TASK_NOT_MET', 'no', 3, { error: { code: 'TASK_NOT_MET', effective_value: 7_999 } }));
    const final = await runClaimFlow(input({ deps: d }), () => {});
    expect(final).toEqual({ kind: 'rejected', code: 'TASK_NOT_MET', message: 'no', rulesVersion: 3, effectiveValue: 7_999 });
    expect(d.raw.submitter.submit).not.toHaveBeenCalled();
  });

  test('already_claimed／expired／failed 映射；錢包取消為可重試 failed', async () => {
    expect((await runClaimFlow(input({ deps: deps({ submitOutcome: { kind: 'already_claimed' } }) }), () => {})).kind).toBe('already_claimed');
    expect(await runClaimFlow(input({ deps: deps({ submitOutcome: { kind: 'expired', reason: 'x', needsNewAttestation: true } }) }), () => {})).toMatchObject({ kind: 'failed', code: 'TX_EXPIRED' });
    const d = deps();
    d.raw.api.authorizeClaim.mockRejectedValueOnce(Object.assign(new Error('closed'), { code: 'REJECTED' }));
    expect(await runClaimFlow(input({ deps: d }), () => {})).toMatchObject({ kind: 'failed', code: 'REJECTED', retryable: true });
  });
});
