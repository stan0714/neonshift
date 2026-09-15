/**
 * GpsMetricsEngine（PG-R-04／R-05；walk-run-tracking 4、5；SD 16）。
 * 純計算、可由固定軌跡重播；不碰定位 API、不持久化。內部整數毫米／毫秒；UI 四捨五入不參與比較。
 *
 * 規則（GPS_RULES_VERSION 1）：
 * - 拒絕：非有限座標、時間倒序／重複、精度 > 20 m、與前一接受點的速度超過上限（跑 12 m/s／走 4 m/s）→ 疑似跳點、暫停中的點。
 * - 連續段：與前一接受點間隔 > 5 s、或暫停後恢復，從新點重新建段；不跨缺口補直線距離。
 * - 抖動：位移小於遲滯門檻的點不累加距離（錨點不前進），避免原地飄移增加里程。
 * - 速度：最近完整 5 秒連續窗的接受距離 ÷ 5；窗不完整（缺口／暫停／剛開始）→ null。最高速度 = 該窗最大值。
 * - Splits：每 splitLengthMm（1,000,000 或 1,609,344）在兩接受點間按距離比例插值時間；一次跨多界線逐一切；跨缺口者標 uncertain；末段 partial。
 * - Laps：手動圈與自訂距離自動圈為獨立序列；暫停時不可按 Lap；零距離／零時間不新增。
 */

export const GPS_RULES_VERSION = 1;
export const SPLIT_KM_MM = 1_000_000;
export const SPLIT_MILE_MM = 1_609_344;

export type Sport = 'run' | 'walk';
export type GpsConfig = {
  maxAccuracyM: number;
  maxGapMs: number;
  maxSpeedMs: number;
  /** 遲滯：小於此位移不累加（mm） */
  jitterFloorMm: number;
  splitLengthMm: number;
  /** 自訂距離自動圈（null = 關閉） */
  autoLapMm: number | null;
  /** 跑道等效圈長（mm），只作 floor 估算 */
  trackLapMm: number | null;
};

export const defaultConfig = (sport: Sport, over: Partial<GpsConfig> = {}): GpsConfig => ({
  maxAccuracyM: 20,
  maxGapMs: 5000,
  maxSpeedMs: sport === 'run' ? 12 : 4,
  jitterFloorMm: 3000,
  splitLengthMm: SPLIT_KM_MM,
  autoLapMm: null,
  trackLapMm: null,
  ...over,
});

export type RawPoint = { seq: number; monotonicMs: number; utcMs: number; lat: number; lon: number; accuracyM: number; speedMs?: number | null };
export type RejectReason = 'not_finite' | 'out_of_order' | 'duplicate' | 'low_accuracy' | 'speed_spike' | 'paused' | 'not_recording';
export type PointResult = { accepted: boolean; reason?: RejectReason; distanceMm: number; newSegment: boolean; stationary: boolean };

export type Lap = {
  kind: 'split' | 'manual' | 'auto_distance';
  index: number;
  startElapsedMs: number;
  endElapsedMs: number;
  distanceMm: number;
  durationMs: number;
  /** 秒／公里；距離 0 → null */
  paceSPerKm: number | null;
  isPartial: boolean;
  uncertain: boolean;
};

type Accepted = { monotonicMs: number; lat: number; lon: number; cumMm: number; segment: number; elapsedMs: number };

export type Summary = {
  rulesVersion: number;
  distanceMm: number;
  elapsedMs: number;
  movingMs: number;
  pausedMs: number;
  avgSpeedKmh: number | null;
  avgPaceSPerKm: number | null;
  /** 最高速度（5 秒平均），km/h */
  maxSpeed5sKmh: number | null;
  splits: Lap[];
  laps: Lap[];
  fastestSplit: Lap | null;
  trackEquivalent: { laps: number; remainderMm: number; lapMm: number } | null;
  quality: { accepted: number; rejected: Record<RejectReason, number>; stationary: number; segments: number; gaps: number; coverageRatio: number; complete: boolean };
};

const R_MM = 6_371_008_800; // 平均地球半徑（mm）
const toRad = (d: number) => (d * Math.PI) / 180;
/** 大圓距離（haversine），整數毫米 */
export function haversineMm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R_MM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

const paceOf = (distanceMm: number, durationMs: number) => (distanceMm > 0 ? Math.round(durationMs / 1000 / (distanceMm / 1_000_000)) : null);

export class GpsMetricsEngine {
  readonly config: GpsConfig;
  private state: 'ready' | 'recording' | 'paused' | 'finished' = 'ready';
  private startMono = 0;
  private pausedAtMono = 0;
  private pausedTotalMs = 0;
  private lastMono = 0;
  private lastSeq = -1;
  /** 錨點：最後一個累加距離的接受點 */
  private anchor: Accepted | null = null;
  private last: Accepted | null = null;
  private cumMm = 0;
  private segment = 0;
  private window: Accepted[] = [];
  private maxSpeed5s: number | null = null;
  private coveredMs = 0;
  private rejected: Record<RejectReason, number> = { not_finite: 0, out_of_order: 0, duplicate: 0, low_accuracy: 0, speed_spike: 0, paused: 0, not_recording: 0 };
  private accepted = 0;
  private stationary = 0;
  private gaps = 0;
  private resumePending = false;
  readonly splits: Lap[] = [];
  readonly laps: Lap[] = [];
  private splitStart: { elapsedMs: number; cumMm: number; uncertain: boolean } = { elapsedMs: 0, cumMm: 0, uncertain: false };
  private autoStart: { elapsedMs: number; cumMm: number; uncertain: boolean } = { elapsedMs: 0, cumMm: 0, uncertain: false };
  private manualStart: { elapsedMs: number; cumMm: number } = { elapsedMs: 0, cumMm: 0 };
  private manualCount = 0;
  private autoCount = 0;

  constructor(readonly sport: Sport, config: Partial<GpsConfig> = {}) {
    this.config = defaultConfig(sport, config);
  }

  get status() {
    return this.state;
  }
  get distanceMm() {
    return this.cumMm;
  }

  start(monotonicMs: number) {
    if (this.state !== 'ready') throw new Error('already started');
    this.state = 'recording';
    this.startMono = monotonicMs;
    this.lastMono = monotonicMs;
  }
  pause(monotonicMs: number) {
    if (this.state !== 'recording') return false;
    this.state = 'paused';
    this.pausedAtMono = monotonicMs;
    return true;
  }
  resume(monotonicMs: number) {
    if (this.state !== 'paused') return false;
    this.pausedTotalMs += Math.max(0, monotonicMs - this.pausedAtMono);
    this.state = 'recording';
    this.resumePending = true; // 恢復後從新點重新建段
    this.window = [];
    return true;
  }
  elapsedAt(monotonicMs: number) {
    const pausedNow = this.state === 'paused' ? Math.max(0, monotonicMs - this.pausedAtMono) : 0;
    return Math.max(0, monotonicMs - this.startMono - this.pausedTotalMs - pausedNow);
  }

  addPoint(p: RawPoint): PointResult {
    const none = (reason: RejectReason): PointResult => {
      this.rejected[reason] += 1;
      return { accepted: false, reason, distanceMm: 0, newSegment: false, stationary: false };
    };
    if (this.state === 'ready' || this.state === 'finished') return none('not_recording');
    if (this.state === 'paused') return none('paused');
    if (![p.lat, p.lon, p.accuracyM, p.monotonicMs].every(Number.isFinite) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) return none('not_finite');
    if (p.seq <= this.lastSeq) return none('duplicate');
    if (p.monotonicMs < this.lastMono) return none('out_of_order');
    if (this.last && p.monotonicMs === this.last.monotonicMs) return none('duplicate');
    if (p.accuracyM > this.config.maxAccuracyM) return none('low_accuracy');
    const elapsedMs = this.elapsedAt(p.monotonicMs);
    let newSegment = false;
    let distanceMm = 0;
    let stationary = false;
    if (!this.last || this.resumePending || p.monotonicMs - this.last.monotonicMs > this.config.maxGapMs) {
      // 新連續段：不跨缺口補距離
      if (this.last && !this.resumePending) this.gaps += 1;
      this.segment += 1;
      newSegment = true;
      this.resumePending = false;
      this.window = [];
      this.splitStart.uncertain = this.splitStart.uncertain || this.splits.length > 0 || this.cumMm > 0;
      this.autoStart.uncertain = this.autoStart.uncertain || this.cumMm > 0;
      this.anchor = null;
    } else {
      const dt = (p.monotonicMs - this.last.monotonicMs) / 1000;
      const dFromLast = haversineMm(this.last.lat, this.last.lon, p.lat, p.lon);
      if (dt > 0 && dFromLast / 1000 / dt > this.config.maxSpeedMs) return none('speed_spike');
      const base = this.anchor ?? this.last;
      const dFromAnchor = haversineMm(base.lat, base.lon, p.lat, p.lon);
      if (dFromAnchor < this.config.jitterFloorMm) {
        stationary = true;
        this.stationary += 1;
      } else {
        distanceMm = dFromAnchor;
      }
      this.coveredMs += p.monotonicMs - this.last.monotonicMs;
    }
    this.lastSeq = p.seq;
    this.lastMono = p.monotonicMs;
    const prevCum = this.cumMm;
    this.cumMm += distanceMm;
    const acc: Accepted = { monotonicMs: p.monotonicMs, lat: p.lat, lon: p.lon, cumMm: this.cumMm, segment: this.segment, elapsedMs };
    if (!stationary) this.anchor = acc;
    const prev = this.last;
    this.last = acc;
    this.accepted += 1;
    // 5 秒窗
    this.window.push(acc);
    while (this.window.length > 1 && acc.monotonicMs - this.window[0]!.monotonicMs > 5000) {
      if (acc.monotonicMs - this.window[1]!.monotonicMs >= 5000) this.window.shift();
      else break;
    }
    const cur = this.currentSpeedMs();
    if (cur !== null && (this.maxSpeed5s === null || cur > this.maxSpeed5s)) this.maxSpeed5s = cur;
    // 界線：在 prev→acc 間插值
    if (distanceMm > 0 && prev) this.crossBoundaries(prev.elapsedMs, prevCum, acc.elapsedMs, this.cumMm);
    return { accepted: true, distanceMm, newSegment, stationary };
  }

  /** 最近完整 5 秒連續窗的平均速度（m/s）；窗不完整回 null */
  currentSpeedMs(): number | null {
    if (this.state !== 'recording' || this.window.length < 2) return null;
    const last = this.window[this.window.length - 1]!;
    const first = this.window[0]!;
    if (last.monotonicMs - first.monotonicMs < 5000) return null;
    // 窗起點在 first 與 window[1] 之間插值累積距離
    const t0 = last.monotonicMs - 5000;
    const second = this.window[1]!;
    const ratio = second.monotonicMs === first.monotonicMs ? 0 : (t0 - first.monotonicMs) / (second.monotonicMs - first.monotonicMs);
    const cumAtT0 = first.cumMm + (second.cumMm - first.cumMm) * Math.min(1, Math.max(0, ratio));
    return (last.cumMm - cumAtT0) / 1000 / 5;
  }
  currentPaceSPerKm(): number | null {
    const v = this.currentSpeedMs();
    return v === null || v < 0.3 ? null : Math.round(1000 / v);
  }

  private crossBoundaries(t0: number, d0: number, t1: number, d1: number) {
    const cross = (lenMm: number, startRef: { elapsedMs: number; cumMm: number; uncertain: boolean }, kind: 'split' | 'auto_distance', list: Lap[], count: () => number) => {
      let boundary = startRef.cumMm + lenMm;
      while (boundary <= d1) {
        const ratio = (boundary - d0) / (d1 - d0);
        const tCross = Math.round(t0 + (t1 - t0) * ratio);
        const durationMs = tCross - startRef.elapsedMs;
        list.push({ kind, index: count(), startElapsedMs: startRef.elapsedMs, endElapsedMs: tCross, distanceMm: lenMm, durationMs, paceSPerKm: paceOf(lenMm, durationMs), isPartial: false, uncertain: startRef.uncertain });
        startRef.elapsedMs = tCross;
        startRef.cumMm = boundary;
        startRef.uncertain = false;
        boundary += lenMm;
      }
    };
    cross(this.config.splitLengthMm, this.splitStart, 'split', this.splits, () => this.splits.length + 1);
    if (this.config.autoLapMm) cross(this.config.autoLapMm, this.autoStart, 'auto_distance', this.laps, () => ++this.autoCount);
  }

  /** 手動圈：暫停中不可；零距離／零時間不新增（重複觸發去重） */
  lap(monotonicMs: number): Lap | null {
    if (this.state !== 'recording') return null;
    const elapsedMs = this.elapsedAt(monotonicMs);
    const distanceMm = this.cumMm - this.manualStart.cumMm;
    const durationMs = elapsedMs - this.manualStart.elapsedMs;
    if (distanceMm <= 0 || durationMs <= 0) return null;
    const l: Lap = { kind: 'manual', index: ++this.manualCount, startElapsedMs: this.manualStart.elapsedMs, endElapsedMs: elapsedMs, distanceMm, durationMs, paceSPerKm: paceOf(distanceMm, durationMs), isPartial: false, uncertain: false };
    this.laps.push(l);
    this.manualStart = { elapsedMs, cumMm: this.cumMm };
    return l;
  }

  finish(monotonicMs: number): Summary {
    if (this.state === 'paused') this.resume(monotonicMs);
    if (this.state !== 'recording') throw new Error('not recording');
    const elapsedMs = this.elapsedAt(monotonicMs) + this.pausedTotalMs;
    const movingMs = elapsedMs - this.pausedTotalMs;
    this.state = 'finished';
    const splits = [...this.splits];
    const partialMm = this.cumMm - this.splitStart.cumMm;
    if (partialMm > 0) {
      const durationMs = movingMs - this.splitStart.elapsedMs;
      splits.push({ kind: 'split', index: splits.length + 1, startElapsedMs: this.splitStart.elapsedMs, endElapsedMs: movingMs, distanceMm: partialMm, durationMs, paceSPerKm: paceOf(partialMm, durationMs), isPartial: true, uncertain: this.splitStart.uncertain });
    }
    const laps = [...this.laps];
    if (this.config.autoLapMm) {
      const rem = this.cumMm - this.autoStart.cumMm;
      if (rem > 0) {
        const durationMs = movingMs - this.autoStart.elapsedMs;
        laps.push({ kind: 'auto_distance', index: ++this.autoCount, startElapsedMs: this.autoStart.elapsedMs, endElapsedMs: movingMs, distanceMm: rem, durationMs, paceSPerKm: paceOf(rem, durationMs), isPartial: true, uncertain: this.autoStart.uncertain });
      }
    }
    const complete = splits.filter((s) => !s.isPartial && !s.uncertain);
    const fastestSplit = complete.length ? complete.reduce((a, b) => (b.durationMs < a.durationMs ? b : a)) : null;
    const km = this.cumMm / 1_000_000;
    const coverageRatio = movingMs > 0 ? Math.min(1, this.coveredMs / movingMs) : 0;
    return {
      rulesVersion: GPS_RULES_VERSION,
      distanceMm: this.cumMm,
      elapsedMs,
      movingMs,
      pausedMs: this.pausedTotalMs,
      avgSpeedKmh: km > 0 && elapsedMs > 0 ? Number((km / (elapsedMs / 3_600_000)).toFixed(3)) : null,
      avgPaceSPerKm: paceOf(this.cumMm, elapsedMs),
      maxSpeed5sKmh: this.maxSpeed5s === null ? null : Number((this.maxSpeed5s * 3.6).toFixed(2)),
      splits,
      laps,
      fastestSplit,
      trackEquivalent: this.config.trackLapMm ? { laps: Math.floor(this.cumMm / this.config.trackLapMm), remainderMm: this.cumMm % this.config.trackLapMm, lapMm: this.config.trackLapMm } : null,
      quality: { accepted: this.accepted, rejected: { ...this.rejected }, stationary: this.stationary, segments: this.segment, gaps: this.gaps, coverageRatio, complete: this.gaps === 0 && coverageRatio >= 0.9 },
    };
  }
}
