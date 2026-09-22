/**
 * PG-R-11 熱量估算（activity-running-gallery 4.1）：只在使用者自願提供體重、且沒有裝置熱量時，顯示「估算」。
 * - 版本化 MET 模型：2024 Adult Compendium of Physical Activities 的走路／跑步依速度分級條目（下表含條目代碼與來源）。
 * - 總熱量 ≈ MET × 3.5 × 體重(kg) / 200 × 分鐘；活動熱量 ≈ max(MET − 1, 0) × 3.5 × 體重 / 200 × 分鐘。
 * - 暫停時段不套強度（只用非暫停時間）；有分段序列時逐段依該段速度計算，不硬套單一係數。
 * - 體重只存在手機（bodyStore），不上傳、不進 profile／NFT；估算不作 PB、排名、XP 或代幣依據，也不是醫療／飲食建議。
 */
export const ENERGY_MODEL_VERSION = 'compendium-2024/v1';

/**
 * 2024 Adult Compendium of Physical Activities（Herrmann et al., 2024；pacompendium.com）走路／跑步依速度分級。
 * 表內 maxKmh 為級距上界（取相鄰條目速度的中點），code 為 Compendium 條目與其標示速度（mph→km/h ×1.609）。
 * 2026-09-22 負責人核對來源：https://pacompendium.com/running/ 、https://pacompendium.com/walking/
 */
type MetRow = { maxKmh: number; met: number; code: string };
const RUN: MetRow[] = [
  { maxKmh: 6.2, met: 3.3, code: '12026 jogging 2.6–3.7 mph (4.2–6.0 km/h)' },
  { maxKmh: 6.85, met: 6.5, code: '12028 running 4–4.2 mph (6.4–6.8 km/h)' },
  { maxKmh: 7.85, met: 7.8, code: '12029 running 4.3–4.8 mph (6.9–7.7 km/h)' },
  { maxKmh: 8.65, met: 8.5, code: '12030 running 5.0–5.2 mph (8.0–8.4 km/h)' },
  { maxKmh: 9.5, met: 9.0, code: '12045 running 5.5–5.8 mph (8.9–9.3 km/h)' },
  { maxKmh: 10.45, met: 9.3, code: '12050 running 6–6.3 mph (9.7–10.1 km/h)' },
  { maxKmh: 11.05, met: 10.5, code: '12060 running 6.7 mph (10.8 km/h)' },
  { maxKmh: 11.7, met: 11.0, code: '12070 running 7 mph (11.3 km/h)' },
  { maxKmh: 12.5, met: 11.8, code: '12080 running 7.5 mph (12.1 km/h)' },
  { maxKmh: 13.35, met: 12.0, code: '12090 running 8 mph (12.9 km/h)' },
  { maxKmh: 14.15, met: 12.5, code: '12100 running 8.6 mph (13.8 km/h)' },
  { maxKmh: 14.75, met: 13.0, code: '12110 running 9 mph (14.5 km/h)' },
  { maxKmh: 16.9, met: 14.8, code: '12115/12120 running 9.3–10 mph (15.0–16.1 km/h)' },
  { maxKmh: 18.5, met: 16.8, code: '12130 running 11 mph (17.7 km/h)' },
  { maxKmh: 20.1, met: 18.5, code: '12132 running 12 mph (19.3 km/h)' },
  { maxKmh: 21.7, met: 19.8, code: '12134 running 13 mph (20.9 km/h)' },
  { maxKmh: Number.POSITIVE_INFINITY, met: 23.0, code: '12135 running 14 mph (22.5 km/h)' },
];
const WALK: MetRow[] = [
  { maxKmh: 3.95, met: 2.8, code: '17152 walking 2.0–2.4 mph (3.2–3.9 km/h), slow' },
  { maxKmh: 4.4, met: 3.0, code: '17170 walking 2.5 mph (4.0 km/h)' },
  { maxKmh: 5.55, met: 3.8, code: '17190 walking 2.8–3.4 mph (4.5–5.5 km/h), moderate' },
  { maxKmh: 6.35, met: 4.8, code: '17200 walking 3.5–3.9 mph (5.6–6.3 km/h), brisk' },
  { maxKmh: 7.15, met: 5.5, code: '17220 walking 4.0–4.4 mph (6.4–7.1 km/h), very brisk' },
  { maxKmh: 8.0, met: 7.0, code: '17230 walking 4.5–4.9 mph (7.2–7.9 km/h)' },
  { maxKmh: Number.POSITIVE_INFINITY, met: 8.5, code: '17231 walking 5.0–5.5 mph (8.0–8.9 km/h)' },
];

export function metFor(sport: 'run' | 'walk', speedKmh: number): { met: number; code: string } {
  const table = sport === 'run' ? RUN : WALK;
  const row = table.find((r) => speedKmh <= r.maxKmh) ?? table[table.length - 1]!;
  return { met: row.met, code: row.code };
}

export type EnergySegment = { distanceMm: number; durationMs: number };
export type EnergyEstimate = { activeKcal: number; totalKcal: number; avgMet: number; model: string; minutes: number };

/**
 * 估算。`segments`（分段：距離／非暫停時長）優先；沒有就用整段 movingMs 與 distanceMm。
 * 回 null：體重無效、沒有時間、或距離／速度無法判定。
 */
export function estimateEnergy(input: { sport: 'run' | 'walk'; weightKg: number | null | undefined; movingMs: number | null; distanceMm: number | null; segments?: EnergySegment[] | null }): EnergyEstimate | null {
  const w = input.weightKg;
  if (!w || !Number.isFinite(w) || w < 20 || w > 300) return null;
  const segs = (input.segments ?? []).filter((s) => s.durationMs > 0 && s.distanceMm >= 0);
  const use: EnergySegment[] = segs.length ? segs : input.movingMs && input.movingMs > 0 && input.distanceMm !== null && input.distanceMm >= 0 ? [{ distanceMm: input.distanceMm, durationMs: input.movingMs }] : [];
  if (!use.length) return null;
  let total = 0;
  let active = 0;
  let metMinutes = 0;
  let minutes = 0;
  for (const s of use) {
    const min = s.durationMs / 60_000;
    const kmh = (s.distanceMm / 1_000_000) / (s.durationMs / 3_600_000);
    const { met } = metFor(input.sport, kmh);
    total += (met * 3.5 * w) / 200 * min;
    active += (Math.max(met - 1, 0) * 3.5 * w) / 200 * min;
    metMinutes += met * min;
    minutes += min;
  }
  if (minutes <= 0) return null;
  return { activeKcal: Math.round(active), totalKcal: Math.round(total), avgMet: Number((metMinutes / minutes).toFixed(1)), model: ENERGY_MODEL_VERSION, minutes: Math.round(minutes) };
}
