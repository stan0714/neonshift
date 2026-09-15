import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import type { ClaimRequest } from "../claim/schema.js";
import { evaluate } from "./engine.js";
import { loadRuleSetFile, parseRuleSet } from "./rules.js";

const rules = loadRuleSetFile(resolve(import.meta.dirname, "../../rules/v3.json"));

const buckets = (total: number, perMin = 100): [number, number][] => {
  const out: [number, number][] = [];
  let left = total;
  let m = 480;
  while (left > 0) {
    const s = Math.min(perMin, left);
    out.push([m++, s]);
    left -= s;
  }
  return out;
};

function stepsReq(over: Partial<ClaimRequest> & { total?: number; kind?: string }): ClaimRequest {
  const total = over.total ?? 9_420;
  return {
    task_type: "steps",
    task_date: 20_710,
    claim_authorization: { challenge_b64: "A".repeat(44), expires_at: 1, signature_b64: "B".repeat(88) },
    steps: total,
    sleep_minutes: null,
    step_rate_summary: { bucket_minutes: 1, buckets: buckets(total) },
    data_origins: [{ package: "android", source_kind: (over.kind ?? "android_legacy") as never, steps: total }],
    sensor_summary: { sample_rate_hz: 50, window_count: 2, window_seconds: 10, step_delta: 34, dominant_freq_hz: 1.87, freq_variance: 0.31, accel_rms: 1.24, gyro_rms: 0.42, zero_crossing_rate: 3.6 },
    motion_summary: null,
    client: { app_version: "0.1.0", device_model: "Seeker", os_api: 36, sdk_extension: 22 },
    ...over,
  } as ClaimRequest;
}

function sleepReq(minutes: number, over: Partial<ClaimRequest> = {}): ClaimRequest {
  const dayStart = 20_710 * 86_400;
  return {
    ...stepsReq({}),
    task_type: "sleep",
    steps: null,
    step_rate_summary: null,
    data_origins: [],
    sensor_summary: null,
    sleep_minutes: minutes,
    sleep_sessions: [{ start_unix: dayStart - minutes * 60, end_unix: dayStart, package: "com.oem.health", recording_method: "automatic" }],
    ...over,
  } as ClaimRequest;
}

describe("PG-B-07 規則集", () => {
  it("rules_version 單調 u16、rules_hash 為 canonical 設定的 SHA-256 且不含自身", () => {
    expect(rules.version).toBe(3);
    expect(rules.hash).toHaveLength(32);
    const again = parseRuleSet({ ...rules.config, rules_hash: "sha256:whatever" });
    expect(again.hash).toEqual(rules.hash);
    const changed = parseRuleSet({ ...rules.config, threshold: 61 });
    expect(changed.hash).not.toEqual(rules.hash);
    expect(() => parseRuleSet({ ...rules.config, rules_version: 70_000 })).toThrow();
    expect(() => parseRuleSet({ ...rules.config, unknown: 1 })).toThrow();
  });
});

describe("PG-B-08 硬拒絕與夾限（每條規則正負案例）", () => {
  it("SRC_UNATTRIBUTED：只有第三方來源", () => {
    expect(evaluate(stepsReq({ kind: "third_party" }), rules).rejectCode).toBe("SRC_UNATTRIBUTED");
    expect(evaluate(stepsReq({}), rules).decision).toBe("pass");
  });
  it("SRC_MANUAL：只有手動輸入", () => {
    expect(evaluate(stepsReq({ kind: "manual" }), rules).rejectCode).toBe("SRC_UNATTRIBUTED");
  });
  it("NO_SENSOR／LIVE_MOTION_INCOMPLETE", () => {
    expect(evaluate(stepsReq({ sensor_summary: null }), rules).rejectCode).toBe("NO_SENSOR");
    const r = stepsReq({});
    r.sensor_summary!.step_delta = 9;
    expect(evaluate(r, rules).rejectCode).toBe("LIVE_MOTION_INCOMPLETE");
    r.sensor_summary!.step_delta = 10;
    expect(evaluate(r, rules).decision).toBe("pass");
  });
  it("夾限後才判達標：7,999／8,000 邊界；超速桶夾到 250 後未達即 TASK_NOT_MET", () => {
    expect(evaluate(stepsReq({ total: 7_999 }), rules).rejectCode).toBe("TASK_NOT_MET");
    expect(evaluate(stepsReq({ total: 8_000 }), rules)).toMatchObject({ decision: "pass", effectiveValue: 8_000 });
    const fast = stepsReq({ total: 9_000, step_rate_summary: { bucket_minutes: 1, buckets: buckets(9_000, 1_000) } });
    const d = evaluate(fast, rules);
    expect(d.rejectCode).toBe("TASK_NOT_MET");
    expect(d.effectiveValue).toBe(9 * 250);
    expect(d.matched).toContain("RATE_EXCEEDED");
  });
  it("排除資料不使其餘合格資料被拒", () => {
    const r = stepsReq({});
    r.data_origins.push({ package: "com.fit", source_kind: "third_party", steps: 50_000 });
    expect(evaluate(r, rules).decision).toBe("pass");
  });
  it("SLEEP_RANGE：179／180／720／721；419／420 達標", () => {
    expect(evaluate(sleepReq(179), rules).rejectCode).toBe("SLEEP_RANGE");
    expect(evaluate(sleepReq(180), rules).rejectCode).toBe("TASK_NOT_MET");
    expect(evaluate(sleepReq(419), rules).rejectCode).toBe("TASK_NOT_MET");
    expect(evaluate(sleepReq(420), rules).decision).toBe("pass");
    expect(evaluate(sleepReq(720), rules).decision).toBe("pass");
    expect(evaluate(sleepReq(721), rules).rejectCode).toBe("SLEEP_RANGE");
  });
  it("零步數的合格睡眠不被步數規則拒絕", () => {
    expect(evaluate(sleepReq(450, { data_origins: [], sensor_summary: null }), rules).decision).toBe("pass");
  });
});

describe("PG-B-09 評分與門檻", () => {
  it("freq_variance_low 35 + stride_implausible 25 = 60 → RISK_SCORE；單一規則不足門檻通過", () => {
    const r = stepsReq({});
    r.sensor_summary!.freq_variance = 0.05;
    expect(evaluate(r, rules)).toMatchObject({ decision: "pass", score: 35, matched: ["freq_variance_low"] });
    r.motion_summary = { gps_available: true, displacement_m: 100_000 }; // 步幅 > 1.5
    expect(evaluate(r, rules)).toMatchObject({ decision: "reject", rejectCode: "RISK_SCORE", score: 60 });
  });
  it("no_displacement_high_steps 只在有 GPS 且 > 15,000 步時；無定位不加分（BR-11）", () => {
    const r = stepsReq({ total: 16_000 });
    expect(evaluate(r, rules).score).toBe(0);
    r.motion_summary = { gps_available: true, displacement_m: 50 };
    const d = evaluate(r, rules);
    expect(d.matched).toContain("no_displacement_high_steps");
    expect(d.score).toBe(20 + 25); // 位移 50m/16,000 步 → 步幅也不合理
    expect(d.decision).toBe("pass");
  });
  it("sleep_overlap_stepping：睡眠期間 > 60 分鐘高步頻加 20 分，未達門檻不拒絕（BR-12）", () => {
    const dayStart = 20_710 * 86_400;
    const r = sleepReq(480, {
      sleep_sessions: [{ start_unix: dayStart, end_unix: dayStart + 480 * 60, package: "p", recording_method: "automatic" }],
      steps: 5_000,
      step_rate_summary: { bucket_minutes: 1, buckets: Array.from({ length: 70 }, (_, i) => [i, 60] as [number, number]) },
    });
    const d = evaluate(r, rules);
    expect(d.sleepOverlapMinutes).toBe(70);
    expect(d).toMatchObject({ decision: "pass", score: 20, matched: ["sleep_overlap_stepping"] });
  });
  it("判定輸出含 rules_version 與 rules_hash", () => {
    const d = evaluate(stepsReq({}), rules);
    expect(d.rulesVersion).toBe(3);
    expect(d.rulesHash).toEqual(rules.hash);
  });
});
