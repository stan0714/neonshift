/**
 * PG-R-11 熱量估算（activity-running-gallery 4.1）：只在使用者自願提供體重、且沒有裝置熱量時，顯示「估算」。
 * - 版本化 MET 模型：Compendium of Physical Activities 2011 的走路／跑步依速度分級條目（下表含條目代碼，供負責人核對）。
 * - 總熱量 ≈ MET × 3.5 × 體重(kg) / 200 × 分鐘；活動熱量 ≈ max(MET − 1, 0) × 3.5 × 體重 / 200 × 分鐘。
 * - 暫停時段不套強度（只用非暫停時間）；有分段序列時逐段依該段速度計算，不硬套單一係數。
 * - 體重只存在手機（bodyStore），不上傳、不進 profile／NFT；估算不作 PB、排名、XP 或代幣依據，也不是醫療／飲食建議。
 */
export const ENERGY_MODEL_VERSION = 'compendium-2011/v1';

/** 依速度（km/h，含）向上取第一個不小於的級距；超出最高級用最高級 */
type MetRow = { maxKmh: number; met: number; code: string };
const RUN: MetRow[] = [
  { maxKmh: 6.8, met: 6.0, code: '12150 jog/walk combination' },
  { maxKmh: 8.4, met: 8.3, code: '12020 running 5 mph' },
  { maxKmh: 9.0, met: 9.0, code: '12025 running 5.2 mph' },
  { maxKmh: 10.1, met: 9.8, code: '12030 running 6 mph' },
  { maxKmh: 11.0, met: 10.5, code: '12040 running 6.7 mph' },
  { maxKmh: 11.7, met: 11.0, code: '12050 running 7 mph' },
  { maxKmh: 12.5, met: 11.5, code: '12060 running 7.5 mph' },
  { maxKmh: 13.4, met: 11.8, code: '12070 running 8 mph' },
  { maxKmh: 14.2, met: 12.3, code: '12080 running 8.6 mph' },
  { maxKmh: 15.0, met: 12.8, code: '12090 running 9 mph' },
  { maxKmh: 16.5, met: 14.5, code: '12100 running 10 mph' },
  { maxKmh: 18.1, met: 16.0, code: '12110 running 11 mph' },
  { maxKmh: 19.8, met: 19.0, code: '12120 running 12 mph' },
  { maxKmh: Number.POSITIVE_INFINITY, met: 19.8, code: '12130 running 13 mph' },
];
const WALK: MetRow[] = [
  { maxKmh: 3.5, met: 2.8, code: '17152 walking 2.0 mph' },
  { maxKmh: 4.3, met: 3.0, code: '17170 walking 2.5 mph' },
  { maxKmh: 5.3, met: 3.5, code: '17190 walking 2.8–3.2 mph' },
  { maxKmh: 6.0, met: 4.3, code: '17200 walking 3.5 mph brisk' },
  { maxKmh: 6.8, met: 5.0, code: '17220 walking 4.0 mph' },
  { maxKmh: 7.6, met: 7.0, code: '17230 walking 4.5 mph' },
  { maxKmh: Number.POSITIVE_INFINITY, met: 8.3, code: '17231 walking 5.0 mph' },
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
