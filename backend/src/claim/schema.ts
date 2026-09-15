/**
 * `POST /attestation/claim` 請求（SD 4.3；step_rate_summary 依 4.4「摘要可重算性」改為分鐘桶）。
 * 全部欄位為不可信 client input；後端只把來源／套件當風險訊號。
 */
import { z } from "zod";

export const TASK_TYPES = { steps: 1, sleep: 2 } as const;
export type TaskTypeName = keyof typeof TASK_TYPES;

const sourceKind = z.enum(["android_legacy", "current_device_spn", "manual", "third_party"]);

export const dataOriginSchema = z.object({
  package: z.string().min(1).max(200),
  source_kind: sourceKind,
  steps: z.number().int().min(0).max(10_000_000),
  records: z.number().int().min(0).max(100_000).optional(),
});

/** 可重算的分鐘桶：`[minute_of_utc_day, steps]`，minute 0..1439，升冪、不重複 */
export const stepRateSummarySchema = z.object({
  bucket_minutes: z.literal(1),
  buckets: z
    .array(z.tuple([z.number().int().min(0).max(1439), z.number().int().min(0).max(100_000)]))
    .max(1440)
    .refine((b) => b.every((x, i) => i === 0 || x[0] > b[i - 1]![0]), "buckets must be strictly increasing by minute"),
});

export const sensorSummarySchema = z.object({
  sample_rate_hz: z.number().min(0).max(1000),
  window_count: z.number().int().min(0).max(10),
  window_seconds: z.number().int().min(1).max(60),
  step_delta: z.number().int().min(0).max(10_000),
  dominant_freq_hz: z.number().min(0).max(20),
  freq_variance: z.number().min(0).max(100),
  accel_rms: z.number().min(0).max(1000),
  gyro_rms: z.number().min(0).max(1000),
  zero_crossing_rate: z.number().min(0).max(1000),
});

export const motionSummarySchema = z.object({
  displacement_m: z.number().min(0).max(1_000_000),
  gps_available: z.boolean(),
});

export const clientInfoSchema = z.object({
  app_version: z.string().max(32),
  device_model: z.string().max(64),
  os_api: z.number().int().min(34).max(99),
  sdk_extension: z.number().int().min(0).max(999),
});

export const claimAuthorizationSchema = z.object({
  challenge_b64: z.string().length(44),
  expires_at: z.number().int().positive(),
  signature_b64: z.string().length(88),
});

export const sleepSessionSchema = z.object({
  start_unix: z.number().int().min(0),
  end_unix: z.number().int().min(0),
  package: z.string().min(1).max(200),
  recording_method: z.enum(["manual", "automatic", "active", "unknown"]),
});

export const claimRequestSchema = z
  .object({
    task_type: z.enum(["steps", "sleep"]),
    task_date: z.number().int().min(0).max(0xffff_ffff),
    claim_authorization: claimAuthorizationSchema,
    steps: z.number().int().min(0).max(10_000_000).nullable(),
    sleep_minutes: z.number().int().min(0).max(24 * 60).nullable(),
    /** 睡眠任務：結束時間落在任務日的 session 清單（BR-05；重疊去重在後端） */
    sleep_sessions: z.array(sleepSessionSchema).max(50).optional(),
    step_rate_summary: stepRateSummarySchema.nullable(),
    data_origins: z.array(dataOriginSchema).max(50),
    sensor_summary: sensorSummarySchema.nullable(),
    motion_summary: motionSummarySchema.nullable(),
    client: clientInfoSchema,
  })
  .strict();

export type ClaimRequest = z.infer<typeof claimRequestSchema>;
export type DataOrigin = z.infer<typeof dataOriginSchema>;
export type StepRateSummary = z.infer<typeof stepRateSummarySchema>;
export type SensorSummary = z.infer<typeof sensorSummarySchema>;
