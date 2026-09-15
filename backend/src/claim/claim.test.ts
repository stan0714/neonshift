import { describe, expect, it } from "vitest";

import { canonicalize, requestHashOf, sha256Canonical } from "./canonical.js";
import { claimRequestSchema } from "./schema.js";
import { attributeAndClampSteps, mergeSleepMinutes } from "./steps.js";

describe("RFC 8785 canonicalization", () => {
  it("鍵排序、無空白、數字 ES6 序列化、忽略 undefined", () => {
    expect(canonicalize({ b: 1, a: [true, null, "xé"], c: { z: 1.5, y: 10 } })).toBe('{"a":[true,null,"xé"],"b":1,"c":{"y":10,"z":1.5}}');
    expect(canonicalize({ a: 1e21, b: 0.1 })).toBe('{"a":1e+21,"b":0.1}');
    expect(canonicalize({ b: 2, a: undefined as never })).toBe('{"b":2}');
    expect(() => canonicalize({ a: Number.NaN })).toThrow();
  });
  it("request_hash 不含 claim_authorization，且與欄位順序無關", () => {
    const a = { task_type: "steps", steps: 1, claim_authorization: { challenge_b64: "x" } };
    const b = { claim_authorization: { challenge_b64: "y" }, steps: 1, task_type: "steps" };
    expect(requestHashOf(a)).toEqual(requestHashOf(b));
    expect(requestHashOf(a)).toEqual(sha256Canonical({ steps: 1, task_type: "steps" }));
    expect(requestHashOf({ ...a, steps: 2 })).not.toEqual(requestHashOf(a));
  });
});

describe("claim schema（SD 4.3）", () => {
  const base = {
    task_type: "steps",
    task_date: 20_710,
    claim_authorization: { challenge_b64: "A".repeat(44), expires_at: 1, signature_b64: "B".repeat(88) },
    steps: 9420,
    sleep_minutes: null,
    step_rate_summary: { bucket_minutes: 1, buckets: [[600, 120], [601, 130]] },
    data_origins: [{ package: "android", source_kind: "android_legacy", steps: 9420 }],
    sensor_summary: { sample_rate_hz: 50, window_count: 2, window_seconds: 10, step_delta: 34, dominant_freq_hz: 1.87, freq_variance: 0.31, accel_rms: 1.24, gyro_rms: 0.42, zero_crossing_rate: 3.6 },
    motion_summary: null,
    client: { app_version: "0.1.0", device_model: "Seeker", os_api: 36, sdk_extension: 22 },
  };
  it("合法請求通過；未知欄位、桶不遞增、task_type 錯誤被拒", () => {
    expect(claimRequestSchema.safeParse(base).success).toBe(true);
    expect(claimRequestSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
    expect(claimRequestSchema.safeParse({ ...base, step_rate_summary: { bucket_minutes: 1, buckets: [[5, 1], [5, 1]] } }).success).toBe(false);
    expect(claimRequestSchema.safeParse({ ...base, task_type: "cycling" }).success).toBe(false);
  });
});

describe("步數歸因與夾限（BR-07／08／10）", () => {
  const origins = (steps: number, kind = "android_legacy") => [{ package: "p", source_kind: kind as never, steps }];

  it("只計允許來源；手動與第三方排除但不整筆拒絕", () => {
    const r = attributeAndClampSteps(
      [
        { package: "android", source_kind: "android_legacy", steps: 8_500 },
        { package: "com.fit", source_kind: "third_party", steps: 3_000 },
        { package: "manual", source_kind: "manual", steps: 500 },
      ],
      { bucket_minutes: 1, buckets: [[600, 4_250], [700, 4_250]] },
    );
    expect(r.attributedSteps).toBe(8_500);
    expect(r.excludedSteps).toBe(3_500);
    expect(r.includesManual).toBe(true);
    expect(r.effectiveSteps).toBe(500); // 每桶夾 250
    expect(r.clamps).toEqual(["RATE_EXCEEDED"]);
  });

  it("每分鐘 250 與單日 40,000 夾限；7,999／8,000 邊界由呼叫端判定", () => {
    // 200 桶 × 250 = 50,000，與允許來源總和一致 → 夾到單日 40,000
    const buckets = Array.from({ length: 200 }, (_, i) => [i, 250] as [number, number]);
    const ok = attributeAndClampSteps(origins(50_000), { bucket_minutes: 1, buckets });
    expect(ok.inconsistent).toBe(false);
    expect(ok.effectiveSteps).toBe(40_000);
    expect(ok.clamps).toEqual(["DAILY_CAP"]);
    const exact = attributeAndClampSteps(origins(8_000), { bucket_minutes: 1, buckets: [[0, 8_000]] });
    expect(exact.effectiveSteps).toBe(250);
    const fine = attributeAndClampSteps(origins(8_000), { bucket_minutes: 1, buckets: Array.from({ length: 32 }, (_, i) => [i, 250] as [number, number]) });
    expect(fine.effectiveSteps).toBe(8_000);
    expect(fine.inconsistent).toBe(false);
  });

  it("沒有桶 → 不假裝已夾限，有效步數 0；桶總和與來源不一致標記", () => {
    const r = attributeAndClampSteps(origins(9_000), null);
    expect(r.effectiveSteps).toBe(0);
    expect(r.inconsistent).toBe(true);
    const z = attributeAndClampSteps([], null);
    expect(z.inconsistent).toBe(false);
    const bad = attributeAndClampSteps(origins(9_000), { bucket_minutes: 1, buckets: [[0, 100]] });
    expect(bad.inconsistent).toBe(true);
  });

  it("睡眠 session 聯集去重（重疊不重複計）", () => {
    expect(mergeSleepMinutes([{ start_unix: 0, end_unix: 3600 }, { start_unix: 1800, end_unix: 7200 }])).toBe(120);
    expect(mergeSleepMinutes([{ start_unix: 0, end_unix: 3600 }, { start_unix: 7200, end_unix: 10800 }])).toBe(120);
    expect(mergeSleepMinutes([{ start_unix: 100, end_unix: 50 }])).toBe(0);
    expect(mergeSleepMinutes([])).toBe(0);
  });
});
