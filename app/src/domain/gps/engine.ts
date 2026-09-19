/**
 * GpsMetricsEngine（PG-R-04／R-05；walk-run-tracking 4、5；SD 16）。
 * 純計算、可由固定軌跡重播；不碰定位 API、不持久化。內部整數毫米／毫秒；UI 四捨五入不參與比較。
 *
 * 規則（GPS_RULES_VERSION 3；v2 完整性／防弊、v3 靜止漂移抑制）：
 * - 拒絕：非有限座標、時間倒序／重複、精度 > acceptMaxAccuracyM（50 m，見 thresholds.ts）、與前一接受點的速度超過上限（跑 12 m/s／走 4 m/s）→ 疑似跳點、暫停中的點。
 * - 連續段：與前一接受點間隔 > 5 s、或暫停後恢復，從新點重新建段；不跨缺口補直線距離。
 * - 抖動：位移小於遲滯門檻（max(3 m, 0.6 × 精度)）的點不累加距離（錨點不前進）；OS 速度 < 0.3 m/s 且位移 < 3 × 精度也視為靜止（v3），避免原地飄移增加里程。
 * - 速度：最近完整 5 秒連續窗的接受距離 ÷ 5；窗不完整（缺口／暫停／剛開始）→ null。最高速度 = 該窗最大值。
 * - Splits：每 splitLengthMm（1,000,000 或 1,609,344）在兩接受點間按距離比例插值時間；一次跨多界線逐一切；跨缺口者標 uncertain；末段 partial。
 * - Laps：手動圈與自訂距離自動圈為獨立序列；暫停時不可按 Lap；零距離／零時間不新增。
 * - 完整性（INTEGRITY_RULES）：模擬定位點一律拒絕並記數；60 秒滑動窗平均速度超過跑 6.5／走 2.8 m/s 記一次持續超速；
 *   缺口前後位移換算速度超過跳點上限記一次瞬移；utc−monotonic 偏移變化 > 30 s 記時鐘漂移；感測器探測（由 recorder 餵入）
 *   ≥ 2 次且過半不一致記 motion_mismatch。任一旗標 → needs_review、不具 PB／任務資格；後端以 client_flags 二次判定，不信任 App 單方。
 */

import { GPS_QUALITY } from './thresholds';

export const GPS_RULES_VERSION = 3;
/** 完整性（防弊）規則 v2：模擬定位、持續超速、缺口瞬移、時鐘漂移、感測器不一致（後者由 recorder 填入） */
export const INTEGRITY_RULES = {
  /** 持續超速：60 秒滑動窗平均速度上限（m/s）；跑步 6.5（≈23 km/h）、走路 2.8（≈10 km/h） */
  sustainedWindowMs: 60_000,
  sustainedSpeedMs: { run: 6.5, walk: 2.8 } as const,
  /** 缺口瞬移：缺口前後位移換算速度超過該模式跳點上限即記一次 */
  clockDriftToleranceMs: 30_000,
} as const;
export const SPLIT_KM_MM = 1_000_000;
export const SPLIT_MILE_MM = 1_609_344;
/** PG-R-12 跑道模式可接受的圈長範圍（公尺）：涵蓋 200 m 室內／400 m 標準與較長環道；超出視為輸入錯誤 */
export const TRACK_LAP_MIN_M = 100;
export const TRACK_LAP_MAX_M = 2000;

export type Sport = 'run' | 'walk';
export type GpsConfig = {
  maxAccuracyM: number;
  maxGapMs: number;
  maxSpeedMs: number;
  /** 遲滯：小於此位移不累加（mm）；實際門檻＝max(jitterFloorMm, accuracyFloorFactor × 精度) */
  jitterFloorMm: number;
  /** 精度比例遲滯（精度 20 m × 0.6 ＝ 12 m）：精度差時抖動更大 */
  accuracyFloorFactor: number;
  /** Doppler 靜止門檻：OS 回報速度 < 此值且位移 < 3 × 精度 → 視為靜止（實機：室內放桌上 1h48 漂移累積 4.39 km） */
  stillSpeedMs: number;
  splitLengthMm: number;
  /** 自訂距離自動圈（null = 關閉） */
  autoLapMm: number | null;
  /** 跑道等效圈長（mm），只作 floor 估算 */
  trackLapMm: number | null;
};

export const defaultConfig = (sport: Sport, over: Partial<GpsConfig> = {}): GpsConfig => ({
  /** 2026-09-17 實機：無 SIM（無 A-GPS）戶外跑道 14 分鐘精度一直 > 20 m → 全部拒絕、0 km；放寬到 50 m（見 thresholds.ts），抖動由 0.6×精度的遲滯門檻抑制 */
  maxAccuracyM: GPS_QUALITY.acceptMaxAccuracyM,
  maxGapMs: 5000,
  maxSpeedMs: sport === 'run' ? 12 : 4,
  jitterFloorMm: 3000,
  accuracyFloorFactor: 0.6,
  stillSpeedMs: 0.3,
  splitLengthMm: SPLIT_KM_MM,
  autoLapMm: null,
  trackLapMm: null,
  ...over,
});

export type RawPoint = { seq: number; monotonicMs: number; utcMs: number; lat: number; lon: number; accuracyM: number; speedMs?: number | null; /** Android 模擬定位（LocationObject.mocked） */ mocked?: boolean };
export type RejectReason = 'not_finite' | 'out_of_order' | 'duplicate' | 'low_accuracy' | 'speed_spike' | 'paused' | 'not_recording' | 'mock_location';
export type IntegrityFlag = 'mock_location' | 'sustained_speed' | 'gap_teleport' | 'clock_drift' | 'motion_mismatch';
/** 完整性摘要（防弊）：計數與旗標；旗標非空 → session needs_review、不具 PB 資格、不計探索任務 */
export type Integrity = { mockPoints: number; sustainedSpeedEpisodes: number; gapTeleports: number; clockDriftMs: number; motionProbes: { total: number; mismatched: number }; flags: IntegrityFlag[] };
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

/** 跑道等效圈：`floor(distance / lapMm)` ＋ 餘數；依距離估算，非實體過線圈（PG-R-12） */
export type TrackEquivalent = { laps: number; remainderMm: number; lapMm: number };

export type Summary = {
  rulesVersion: number;
  distanceMm: number;
  elapsedMs: number;
  movingMs: number;
  pausedMs: number;
  /**
   * 全程平均（含暫停）：距離 ÷ elapsed。與後端 `avg_pace_s_per_km` 定義一致（伺服器以 ended−started 計）。
   * 2026-09-19 review 1：跑步畫面主數字用的是運動平均（不含暫停），摘要主數字也改用 `movingAvg*`；這兩個欄位保留給「全程」與後端對照。
   */
  avgSpeedKmh: number | null;
  avgPaceSPerKm: number | null;
  /** 運動平均（不含暫停）：距離 ÷ moving。跑步中畫面與摘要主數字皆用此，兩處一致 */
  movingAvgSpeedKmh: number | null;
  movingAvgPaceSPerKm: number | null;
  /** 最高速度（5 秒平均），km/h */
  maxSpeed5sKmh: number | null;
  splits: Lap[];
  laps: Lap[];
  fastestSplit: Lap | null;
  trackEquivalent: TrackEquivalent | null;
  quality: { accepted: number; rejected: Record<RejectReason, number>; stationary: number; segments: number; gaps: number; coverageRatio: number; complete: boolean };
  integrity: Integrity;
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
  /** 顯示用平滑速度（5 秒窗再做 EMA，τ≈8 s）；實機回饋：主數字每秒跳動太快。防弊／最高速度仍用原始 5 秒窗 */
  private smoothSpeedMs: number | null = null;
  private smoothAtMono = 0;
  static readonly SPEED_SMOOTH_TAU_MS = 8000;
  private maxSpeed5s: number | null = null;
  private coveredMs = 0;
  private rejected: Record<RejectReason, number> = { not_finite: 0, out_of_order: 0, duplicate: 0, low_accuracy: 0, speed_spike: 0, paused: 0, not_recording: 0, mock_location: 0 };
  // 完整性（防弊）
  private sustainedWindow: { monotonicMs: number; cumMm: number }[] = [];
  private inSustained = false;
  private sustainedEpisodes = 0;
  private gapTeleports = 0;
  private clockOffset0: number | null = null;
  private clockDriftMs = 0;
  private motionProbes = { total: 0, mismatched: 0 };
  // 記錄頁即時視覺化（只在記憶體、不持久化）：最近接受點與 5 秒窗速度樣本
  private recent: RawPoint[] = [];
  private speedSamples: { monotonicMs: number; speedMs: number }[] = [];
  static readonly RECENT_MAX = 600;
  static readonly SPEED_SAMPLE_WINDOW_MS = 300_000;
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
    this.smoothSpeedMs = null;
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
    if (p.mocked) return none('mock_location');
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
      if (this.last && !this.resumePending) {
        this.gaps += 1;
        // 缺口瞬移：缺口期間的位移若超過該模式跳點上限，記一次（不計距離、只作完整性旗標）
        const gapS = (p.monotonicMs - this.last.monotonicMs) / 1000;
        if (gapS > 0 && haversineMm(this.last.lat, this.last.lon, p.lat, p.lon) / 1000 / gapS > this.config.maxSpeedMs) this.gapTeleports += 1;
      }
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
      const floorMm = Math.max(this.config.jitterFloorMm, this.config.accuracyFloorFactor * p.accuracyM * 1000);
      // Doppler 靜止：OS 速度可用且接近 0，而位移仍在精度雜訊範圍內（< 3 × 精度）→ 不累加（位移很大時仍信位置，避免某些裝置永遠回報 0）
      const dopplerStill = typeof p.speedMs === 'number' && p.speedMs >= 0 && p.speedMs < this.config.stillSpeedMs && dFromAnchor < 3 * p.accuracyM * 1000;
      if (dFromAnchor < floorMm || dopplerStill) {
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
    const raw = this.windowSpeedMs();
    if (raw !== null && (this.maxSpeed5s === null || raw > this.maxSpeed5s)) this.maxSpeed5s = raw;
    if (raw === null || newSegment) this.smoothSpeedMs = raw;
    else {
      const dt = Math.max(0, p.monotonicMs - this.smoothAtMono);
      const alpha = 1 - Math.exp(-dt / GpsMetricsEngine.SPEED_SMOOTH_TAU_MS);
      this.smoothSpeedMs = this.smoothSpeedMs === null ? raw : this.smoothSpeedMs + alpha * (raw - this.smoothSpeedMs);
    }
    this.smoothAtMono = p.monotonicMs;
    const cur = this.currentSpeedMs();
    this.trackIntegrity(p, acc, newSegment);
    this.recent.push({ seq: p.seq, monotonicMs: p.monotonicMs, utcMs: p.utcMs, lat: p.lat, lon: p.lon, accuracyM: p.accuracyM });
    if (this.recent.length > GpsMetricsEngine.RECENT_MAX) this.recent.splice(0, this.recent.length - GpsMetricsEngine.RECENT_MAX);
    if (cur !== null) {
      this.speedSamples.push({ monotonicMs: p.monotonicMs, speedMs: cur });
      while (this.speedSamples.length && p.monotonicMs - this.speedSamples[0]!.monotonicMs > GpsMetricsEngine.SPEED_SAMPLE_WINDOW_MS) this.speedSamples.shift();
    }
    // 界線：在 prev→acc 間插值
    if (distanceMm > 0 && prev) this.crossBoundaries(prev.elapsedMs, prevCum, acc.elapsedMs, this.cumMm);
    return { accepted: true, distanceMm, newSegment, stationary };
  }

  /** 完整性：60 秒滑動窗持續超速（以 episode 計）與時鐘漂移（utc − monotonic 偏移量變化） */
  private trackIntegrity(p: RawPoint, acc: Accepted, newSegment: boolean) {
    if (newSegment) {
      this.sustainedWindow = [];
      this.inSustained = false;
    }
    this.sustainedWindow.push({ monotonicMs: acc.monotonicMs, cumMm: acc.cumMm });
    while (this.sustainedWindow.length > 2 && acc.monotonicMs - this.sustainedWindow[1]!.monotonicMs >= INTEGRITY_RULES.sustainedWindowMs) this.sustainedWindow.shift();
    const first = this.sustainedWindow[0]!;
    const span = acc.monotonicMs - first.monotonicMs;
    if (span >= INTEGRITY_RULES.sustainedWindowMs) {
      const avg = (acc.cumMm - first.cumMm) / 1000 / (span / 1000);
      const over = avg > INTEGRITY_RULES.sustainedSpeedMs[this.sport];
      if (over && !this.inSustained) this.sustainedEpisodes += 1;
      this.inSustained = over;
    }
    if (Number.isFinite(p.utcMs)) {
      const offset = p.utcMs - p.monotonicMs;
      if (this.clockOffset0 === null) this.clockOffset0 = offset;
      else this.clockDriftMs = Math.max(this.clockDriftMs, Math.abs(offset - this.clockOffset0));
    }
  }

  /** 最近接受點（最多 600 個；即時軌跡用，缺口以時間差在投影時斷線） */
  recentPath(): RawPoint[] {
    return this.recent;
  }
  /** 最近 5 分鐘的 5 秒窗速度樣本（sparkline 用） */
  recentSpeeds(): { monotonicMs: number; speedMs: number }[] {
    return this.speedSamples;
  }

  /** 外部時鐘漂移觀測（recorder 以單調時鐘對照牆鐘；點本身的 utc/monotonic 若同源則靠這個） */
  recordClockDrift(ms: number) {
    if (Number.isFinite(ms) && ms > this.clockDriftMs) this.clockDriftMs = ms;
  }

  /** 感測器探測結果（recorder 每隔一段時間量一次；GPS 在動但機身沒有步態＝不一致） */
  recordMotionProbe(mismatched: boolean) {
    this.motionProbes.total += 1;
    if (mismatched) this.motionProbes.mismatched += 1;
  }

  /** 目前完整性摘要（記錄中亦可讀，供即時提示） */
  integrity(): Integrity {
    const flags: IntegrityFlag[] = [];
    if (this.rejected.mock_location > 0) flags.push('mock_location');
    if (this.sustainedEpisodes > 0) flags.push('sustained_speed');
    if (this.gapTeleports > 0) flags.push('gap_teleport');
    if (this.clockDriftMs > INTEGRITY_RULES.clockDriftToleranceMs) flags.push('clock_drift');
    if (this.motionProbes.total >= 2 && this.motionProbes.mismatched >= 2 && this.motionProbes.mismatched * 2 >= this.motionProbes.total) flags.push('motion_mismatch');
    return { mockPoints: this.rejected.mock_location, sustainedSpeedEpisodes: this.sustainedEpisodes, gapTeleports: this.gapTeleports, clockDriftMs: this.clockDriftMs, motionProbes: { ...this.motionProbes }, flags };
  }

  /** 顯示用目前速度（m/s）：5 秒窗經 EMA 平滑；窗不完整回 null */
  currentSpeedMs(): number | null {
    if (this.state !== 'recording' || this.windowSpeedMs() === null) return null;
    return this.smoothSpeedMs;
  }
  /** 最近完整 5 秒連續窗的平均速度（m/s，未平滑；最高速度與防弊用）；窗不完整回 null */
  windowSpeedMs(): number | null {
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
  /** 顯示用目前配速（s/km），取到 5 秒（如 5:30、5:35），避免每秒個位數跳動 */
  currentPaceSPerKm(): number | null {
    const v = this.currentSpeedMs();
    return v === null || v < 0.3 ? null : Math.round(1000 / v / 5) * 5;
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

  /** PG-R-12：目前累積距離的跑道等效圈（記錄中即時顯示與摘要共用）；未設 trackLapMm → null */
  trackEquivalent(): TrackEquivalent | null {
    const lapMm = this.config.trackLapMm;
    if (!lapMm || lapMm <= 0) return null;
    return { laps: Math.floor(this.cumMm / lapMm), remainderMm: this.cumMm % lapMm, lapMm };
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
      movingAvgSpeedKmh: km > 0 && movingMs > 0 ? Number((km / (movingMs / 3_600_000)).toFixed(3)) : null,
      movingAvgPaceSPerKm: paceOf(this.cumMm, movingMs),
      maxSpeed5sKmh: this.maxSpeed5s === null ? null : Number((this.maxSpeed5s * 3.6).toFixed(2)),
      splits,
      laps,
      fastestSplit,
      trackEquivalent: this.trackEquivalent(),
      quality: { accepted: this.accepted, rejected: { ...this.rejected }, stationary: this.stationary, segments: this.segment, gaps: this.gaps, coverageRatio, complete: this.gaps === 0 && coverageRatio >= 0.9 },
      integrity: this.integrity(),
    };
  }
}
