/**
 * `POST /tournament/steps`（SD 4.1／4.2 UC-08）。沿用 claim 的來源歸因與分鐘桶夾限，
 * 但窗口為賽事 `[starts_at, ends_at)`，步數以「窗內累計」提交；後端保證單調不減。
 */
import { z } from "zod";

import { clientInfoSchema, dataOriginSchema } from "../claim/schema.js";

export const tournamentStepsRequestSchema = z
  .object({
    week_id: z.number().int().min(2026_01).max(2100_53),
    /** 窗內所有允許來源的累計步數（client 計算，後端重算並夾限） */
    steps: z.number().int().min(0).max(10_000_000),
    /** 達到 `steps` 的時間（最後一筆計入紀錄的結束時間，unix 秒）；BR-20 決勝 */
    reached_at: z.number().int().min(0),
    data_origins: z.array(dataOriginSchema).min(1).max(20),
    /** 賽事窗內每小時桶 `[hour_index_from_starts_at, steps]`，升冪不重複；供 250/min 夾限重算 */
    step_rate_summary: z.object({
      bucket_minutes: z.literal(60),
      buckets: z
        .array(z.tuple([z.number().int().min(0).max(24 * 7), z.number().int().min(0).max(1_000_000)]))
        .max(24 * 7 + 1)
        .refine((b) => b.every((x, i) => i === 0 || x[0] > b[i - 1]![0]), "buckets must be strictly increasing"),
    }),
    client: clientInfoSchema,
    claim_authorization: z.object({ challenge_b64: z.string().min(1).max(64), expires_at: z.number().int(), signature_b64: z.string().min(1).max(128) }),
  })
  .strict();

export type TournamentStepsRequest = z.infer<typeof tournamentStepsRequestSchema>;
