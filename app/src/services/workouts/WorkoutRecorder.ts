import { randomUUID } from 'expo-crypto';
import * as Location from 'expo-location';

import { GpsMetricsEngine, type Lap, type RawPoint, type Summary, type TrackEquivalent } from '@/domain/gps/engine';
import { apiClient, type WorkoutImportInput } from '@/services/api/ApiClient';
import { LocalWorkoutStore, type SessionMeta } from './LocalWorkoutStore';
import { resetLocationSeq, setLocationSink, WORKOUT_LOCATION_TASK } from './locationTask';

/**
 * WorkoutRecorder（PG-R-03，SD 16）：同時只允許一個主動 session。
 * 生命週期 Ready → Recording ↔ Paused → Finishing → Saved／NeedsReview；process 被殺回到 Recoverable（再選恢復／結束）。
 * - 點先寫入 LocalWorkoutStore（加密）再餵引擎；恢復以 seq 去重重播，不重播累加。
 * - 單調時間：本 process 內用定位 timestamp 差；跨 process 恢復標 interrupted（不以負時間補段）。
 * - Finish 先保存摘要再同步後端（origin gps、只含摘要與圈，無座標）；同步失敗保留本機待重試。
 */
export type RecorderState = 'idle' | 'recording' | 'paused' | 'finishing' | 'saved' | 'needs_review';
export type RecorderSnapshot = {
  state: RecorderState;
  sessionId: string | null;
  sport: 'run' | 'walk';
  elapsedMs: number;
  distanceMm: number;
  currentSpeedMs: number | null;
  currentPaceSPerKm: number | null;
  gps: 'searching' | 'ok' | 'poor' | 'off';
  accepted: number;
  splits: Lap[];
  laps: Lap[];
  /** PG-R-12：跑道等效圈（依距離估算）；未啟用 → null */
  trackEquivalent: TrackEquivalent | null;
  interrupted: boolean;
};

type LocationApi = Pick<typeof Location, 'requestForegroundPermissionsAsync' | 'getForegroundPermissionsAsync' | 'startLocationUpdatesAsync' | 'stopLocationUpdatesAsync' | 'hasStartedLocationUpdatesAsync'>;
type Deps = { store?: LocalWorkoutStore; location?: LocationApi; now?: () => number; sync?: (input: WorkoutImportInput) => Promise<{ sessionId: string | null }>; foreground?: { title: string; body: string } };

const defaultSync = async (input: WorkoutImportInput) => {
  const r = await apiClient.importWorkouts([input]);
  const first = r.results[0];
  return { sessionId: first && first.outcome !== 'invalid' ? first.session.session_id : null };
};

/** meta → 引擎設定（舊 meta 無 trackLapMm → null） */
const engineConfigOf = (meta: SessionMeta) => ({ autoLapMm: meta.autoLapMm, trackLapMm: meta.trackLapMm ?? null, splitLengthMm: meta.splitLengthMm });

export class WorkoutRecorder {
  private readonly store: LocalWorkoutStore;
  private readonly location: LocationApi;
  private readonly now: () => number;
  private readonly sync: (input: WorkoutImportInput) => Promise<{ sessionId: string | null }>;
  private readonly foreground: { title: string; body: string };
  private engine: GpsMetricsEngine | null = null;
  private meta: SessionMeta | null = null;
  private state: RecorderState = 'idle';
  private lastPointAt = 0;
  private lastAccuracy: number | null = null;
  private listeners = new Set<() => void>();
  private pending: RawPoint[] = [];
  private flushing: Promise<void> | null = null;
  private readonly processId = randomUUID();

  constructor(deps: Deps = {}) {
    this.store = deps.store ?? new LocalWorkoutStore();
    this.location = deps.location ?? Location;
    this.now = deps.now ?? (() => Date.now());
    this.sync = deps.sync ?? defaultSync;
    this.foreground = deps.foreground ?? { title: 'NeonShift is recording', body: 'Your run is being tracked. Routes stay on this phone.' };
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    for (const l of this.listeners) l();
  }

  snapshot(): RecorderSnapshot {
    const e = this.engine;
    const t = this.now();
    const gps: RecorderSnapshot['gps'] = this.state !== 'recording' ? 'off' : !this.lastPointAt || t - this.lastPointAt > 10_000 ? 'searching' : this.lastAccuracy !== null && this.lastAccuracy > 20 ? 'poor' : 'ok';
    return {
      state: this.state,
      sessionId: this.meta?.sessionId ?? null,
      sport: this.meta?.sport ?? 'run',
      elapsedMs: e && this.meta ? e.elapsedAt(t) + (e.status === 'finished' ? 0 : this.pausedTotal()) : 0,
      distanceMm: e?.distanceMm ?? 0,
      currentSpeedMs: e?.currentSpeedMs() ?? null,
      currentPaceSPerKm: e?.currentPaceSPerKm() ?? null,
      gps,
      accepted: this.meta?.acceptedCount ?? 0,
      splits: e ? [...e.splits] : [],
      laps: e ? [...e.laps] : [],
      trackEquivalent: e?.trackEquivalent() ?? null,
      interrupted: this.meta?.interrupted ?? false,
    };
  }
  private pausedTotal() {
    return (this.meta?.pauses ?? []).reduce((n, p) => n + ((p.resumedAtMs ?? this.now()) - p.atMs), 0);
  }

  /** 定位權限（前景即可；鎖屏由前景服務維持）；拒絕 → false，UI 提供匯入替代 */
  async ensurePermission(): Promise<boolean> {
    const cur = await this.location.getForegroundPermissionsAsync();
    if (cur.granted) return true;
    const r = await this.location.requestForegroundPermissionsAsync();
    return r.granted;
  }

  async start(opts: { sport: 'run' | 'walk'; environment: 'outdoor' | 'indoor'; autoLapMm?: number | null; trackLapMm?: number | null; splitLengthMm?: number }): Promise<SessionMeta> {
    if (this.state !== 'idle') throw new Error('a session is already active');
    if (opts.environment === 'indoor') throw new Error('indoor sessions do not use GPS'); // Indoor 不啟用 GPS 推算距離
    const t = this.now();
    const sessionId = randomUUID();
    this.meta = await this.store.create({ sessionId, sport: opts.sport, environment: opts.environment, autoLapMm: opts.autoLapMm ?? null, trackLapMm: opts.trackLapMm ?? null, splitLengthMm: opts.splitLengthMm ?? 1_000_000, status: 'recording', startedAtUtc: t, startedMonoMs: t, processId: this.processId });
    this.engine = new GpsMetricsEngine(opts.sport, engineConfigOf(this.meta));
    this.engine.start(t);
    this.state = 'recording';
    this.lastPointAt = 0;
    resetLocationSeq(0);
    setLocationSink((pts) => this.ingest(pts));
    await this.location.startLocationUpdatesAsync(WORKOUT_LOCATION_TASK, {
      accuracy: Location.Accuracy.BestForNavigation,
      timeInterval: 1000,
      distanceInterval: 0,
      foregroundService: { notificationTitle: this.foreground.title, notificationBody: this.foreground.body, killServiceOnDestroy: false },
    });
    this.emit();
    return this.meta;
  }

  /** 定位點進來：先持久化（批次）再餵引擎；引擎拒絕的點也保留（審查用） */
  ingest(points: RawPoint[]) {
    if (!this.engine || !this.meta || (this.state !== 'recording' && this.state !== 'paused')) return;
    this.pending.push(...points);
    for (const p of points) {
      this.lastPointAt = this.now();
      this.lastAccuracy = p.accuracyM;
      const r = this.engine.addPoint(p);
      if (r.accepted) this.meta.acceptedCount += 1;
      this.meta.lastSeq = Math.max(this.meta.lastSeq, p.seq);
    }
    void this.flush();
    this.emit();
  }
  private async flush() {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      while (this.pending.length && this.meta) {
        const batch = this.pending.splice(0, 50);
        await this.store.appendPoints(this.meta.sessionId, batch);
        await this.store.writeMeta(this.meta);
      }
    })().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  async pause() {
    if (this.state !== 'recording' || !this.engine || !this.meta) return false;
    const t = this.now();
    this.engine.pause(t);
    this.meta.pauses.push({ atMs: t, resumedAtMs: null });
    this.meta.status = 'paused';
    this.state = 'paused';
    await this.store.writeMeta(this.meta);
    this.emit();
    return true;
  }
  async resume() {
    if (this.state !== 'paused' || !this.engine || !this.meta) return false;
    const t = this.now();
    this.engine.resume(t);
    const last = this.meta.pauses[this.meta.pauses.length - 1];
    if (last && last.resumedAtMs === null) last.resumedAtMs = t;
    this.meta.status = 'recording';
    this.state = 'recording';
    await this.store.writeMeta(this.meta);
    this.emit();
    return true;
  }
  async lap(): Promise<Lap | null> {
    if (this.state !== 'recording' || !this.engine || !this.meta) return null;
    const t = this.now();
    const l = this.engine.lap(t);
    if (l) {
      this.meta.manualLapsAtMs.push(t);
      await this.store.writeMeta(this.meta);
      this.emit();
    }
    return l;
  }

  /** 結束：停止定位 → 先保存摘要 → 同步後端；同步失敗不影響本機已保存 */
  async finish(): Promise<{ meta: SessionMeta; summary: Summary; synced: boolean }> {
    if (!this.engine || !this.meta || (this.state !== 'recording' && this.state !== 'paused')) throw new Error('no active session');
    this.state = 'finishing';
    this.emit();
    setLocationSink(null);
    try {
      if (await this.location.hasStartedLocationUpdatesAsync(WORKOUT_LOCATION_TASK)) await this.location.stopLocationUpdatesAsync(WORKOUT_LOCATION_TASK);
    } catch {
      /* 服務可能已被系統停止 */
    }
    const t = this.now();
    const last = this.meta.pauses[this.meta.pauses.length - 1];
    if (last && last.resumedAtMs === null) last.resumedAtMs = t;
    const summary = this.engine.finish(t);
    this.meta.endedAtUtc = t;
    this.meta.summary = summary;
    this.meta.status = summary.quality.complete && !this.meta.interrupted ? 'saved' : 'needs_review';
    await this.flush();
    await this.store.writeMeta(this.meta);
    this.state = this.meta.status;
    this.emit();
    const synced = await this.syncMeta(this.meta);
    const out = { meta: this.meta, summary, synced };
    this.engine = null;
    this.meta = null;
    this.state = 'idle';
    this.emit();
    return out;
  }

  /** 摘要同步（origin gps；不含座標）；冪等：external_record_id = sessionId */
  async syncMeta(meta: SessionMeta): Promise<boolean> {
    if (!meta.summary || meta.syncedSessionId) return !!meta.syncedSessionId;
    const s = meta.summary;
    const flags: string[] = [];
    if (s.quality.gaps > 0 || s.quality.coverageRatio < 0.9) flags.push('gps_gap');
    if (meta.interrupted) flags.push('interrupted');
    try {
      const r = await this.sync({
        sport: meta.sport,
        environment: meta.environment,
        origin: 'gps',
        source_id: 'cc.neonshift.app/gps',
        external_record_id: meta.sessionId,
        source_revision: 1,
        started_at: new Date(meta.startedAtUtc).toISOString(),
        ended_at: new Date(meta.endedAtUtc ?? meta.startedAtUtc + s.elapsedMs).toISOString(),
        paused_ms: String(s.pausedMs),
        distance_mm: s.distanceMm > 0 ? String(s.distanceMm) : null,
        distance_method: s.distanceMm > 0 ? 'gps' : null,
        client_flags: flags,
        extras: { gps_rules_version: s.rulesVersion, max_speed_5s_kmh: s.maxSpeed5sKmh, splits: s.splits, laps: s.laps, quality: s.quality, track_equivalent: s.trackEquivalent },
      });
      if (r.sessionId) {
        meta.syncedSessionId = r.sessionId;
        await this.store.writeMeta(meta);
        return true;
      }
    } catch {
      /* 離線：保留本機待重試 */
    }
    return false;
  }

  /** 恢復未正常結束的 session：同 process 可續錄；跨 process 標 interrupted 只允許結束 */
  async recover(sessionId: string, action: 'continue' | 'finish' | 'discard'): Promise<{ meta: SessionMeta | null; summary?: Summary }> {
    const meta = this.store.readMeta(sessionId);
    if (!meta) return { meta: null };
    if (action === 'discard') {
      this.store.delete(sessionId);
      return { meta: null };
    }
    const points = await this.store.readPoints(sessionId);
    const engine = new GpsMetricsEngine(meta.sport, engineConfigOf(meta));
    engine.start(meta.startedMonoMs);
    // 重播：依 seq 順序，暫停／手動圈依記錄時間插入
    const events: { t: number; kind: 'pause' | 'resume' | 'lap' }[] = [];
    for (const p of meta.pauses) { events.push({ t: p.atMs, kind: 'pause' }); if (p.resumedAtMs !== null) events.push({ t: p.resumedAtMs, kind: 'resume' }); }
    for (const t of meta.manualLapsAtMs) events.push({ t, kind: 'lap' });
    events.sort((a, b) => a.t - b.t);
    let ei = 0;
    const apply = (upTo: number) => {
      while (ei < events.length && events[ei]!.t <= upTo) {
        const ev = events[ei++]!;
        if (ev.kind === 'pause') engine.pause(ev.t);
        else if (ev.kind === 'resume') engine.resume(ev.t);
        else engine.lap(ev.t);
      }
    };
    let accepted = 0;
    for (const p of points) {
      apply(p.monotonicMs);
      if (engine.addPoint(p).accepted) accepted += 1;
    }
    apply(Number.MAX_SAFE_INTEGER);
    meta.acceptedCount = accepted;
    meta.interrupted = meta.interrupted || meta.processId !== this.processId;
    if (action === 'continue' && !meta.interrupted && this.state === 'idle') {
      this.engine = engine;
      this.meta = meta;
      this.state = engine.status === 'paused' ? 'paused' : 'recording';
      meta.status = this.state;
      await this.store.writeMeta(meta);
      resetLocationSeq(meta.lastSeq + 1);
      setLocationSink((pts) => this.ingest(pts));
      this.emit();
      return { meta };
    }
    // 跨 process 或選擇結束：以最後一點時間結束，不用負時間補段
    const endT = points.length ? points[points.length - 1]!.monotonicMs : meta.startedMonoMs + 1;
    const summary = engine.finish(Math.max(endT, meta.startedMonoMs + 1));
    meta.endedAtUtc = meta.endedAtUtc ?? meta.startedAtUtc + summary.elapsedMs;
    meta.summary = summary;
    meta.status = 'needs_review';
    await this.store.writeMeta(meta);
    await this.syncMeta(meta);
    return { meta, summary };
  }

  /** 啟動時：把仍在 recording／paused 的 session 標為 recoverable（不自動續錄） */
  async markRecoverable(): Promise<SessionMeta[]> {
    const list = this.store.recoverable();
    for (const m of list) {
      if (m.processId !== this.processId && m.status !== 'recoverable') {
        m.status = 'recoverable';
        m.interrupted = true;
        await this.store.writeMeta(m);
      }
    }
    return list;
  }
}

export const workoutRecorder = new WorkoutRecorder();
