/**
 * 規則集載入（PG-B-07，SD 4.4、BR-13）。
 * `rules_version` 為單調遞增 u16；`rules_hash` = SHA-256(canonical(config 去掉 rules_hash))。
 * 兩者一起保存到 `rule_sets`，判定結果只引用版本號即可還原當時規則。
 */
import { readFileSync } from "node:fs";
import { z } from "zod";

import { type Json, sha256Canonical } from "../claim/canonical.js";

const taskEnum = z.enum(["steps", "sleep"]);

export const ruleSetSchema = z
  .object({
    rules_version: z.number().int().min(0).max(65_535),
    description: z.string().optional(),
    goals: z.object({ steps: z.number().int().positive(), sleep_minutes: z.number().int().positive() }),
    hard_reject: z.array(
      z.discriminatedUnion("id", [
        z.object({ id: z.literal("SRC_UNATTRIBUTED"), task: taskEnum }),
        z.object({ id: z.literal("SRC_MANUAL"), task: taskEnum }),
        z.object({ id: z.literal("SLEEP_RANGE"), task: taskEnum, min_minutes: z.number().int(), max_minutes: z.number().int() }),
        z.object({ id: z.literal("NO_SENSOR"), task: taskEnum }),
        z.object({ id: z.literal("LIVE_MOTION_INCOMPLETE"), task: taskEnum, min_step_delta: z.number().int() }),
      ]),
    ),
    clamp: z.array(
      z.discriminatedUnion("id", [
        z.object({ id: z.literal("RATE_EXCEEDED"), max_steps_per_minute: z.number().int().positive() }),
        z.object({ id: z.literal("DAILY_CAP"), max_steps_per_day: z.number().int().positive() }),
      ]),
    ),
    score: z.array(
      z.discriminatedUnion("id", [
        z.object({ id: z.literal("freq_variance_low"), task: taskEnum, weight: z.number().int().min(0).max(100), max_freq_variance: z.number(), min_step_delta: z.number().int() }),
        z.object({ id: z.literal("no_displacement_high_steps"), task: taskEnum, weight: z.number().int().min(0).max(100), max_displacement_m: z.number(), min_steps: z.number().int() }),
        z.object({ id: z.literal("stride_implausible"), task: taskEnum, weight: z.number().int().min(0).max(100), min_stride_m: z.number(), max_stride_m: z.number() }),
        z.object({ id: z.literal("sleep_overlap_stepping"), task: taskEnum, weight: z.number().int().min(0).max(100), min_overlap_minutes: z.number().int() }),
      ]),
    ),
    threshold: z.number().int().min(0).max(100),
  })
  .strict();

export type RuleSetConfig = z.infer<typeof ruleSetSchema>;

export type RuleSet = { version: number; hash: Buffer; config: RuleSetConfig };

export function parseRuleSet(raw: unknown): RuleSet {
  const { rules_hash: _ignored, ...rest } = (raw ?? {}) as Record<string, unknown>;
  const config = ruleSetSchema.parse(rest);
  return { version: config.rules_version, hash: sha256Canonical(config as unknown as Json), config };
}

export function loadRuleSetFile(path: string): RuleSet {
  return parseRuleSet(JSON.parse(readFileSync(path, "utf8")));
}
