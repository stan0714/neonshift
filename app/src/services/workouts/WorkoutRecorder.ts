import { randomUUID } from 'expo-crypto';
import * as Location from 'expo-location';
import { AppState } from 'react-native';

import { liveMotion } from '@/services/sensors/LiveMotionService';
import { walletTimeline } from '@/services/wallet/walletTimeline';

import { GpsMetricsEngine, haversineMm, type IntegrityFlag, type Lap, type RawPoint, type Summary, type TrackEquivalent } from '@/domain/gps/engine';
import { GPS_QUALITY } from '@/domain/gps/thresholds';
import { ApiError, apiClient, type WorkoutGoal, type WorkoutImportInput, type WorkoutIntent } from '@/services/api/ApiClient';
import { LocalWorkoutStore, type SessionMeta } from './LocalWorkoutStore';
import { resetLocationSeq, setLocationSink, toRawPoints, WORKOUT_LOCATION_TASK } from './locationTask';

/**
 * WorkoutRecorder（PG-R-03，SD 16）：同時只允許一個主動 session。
 * 生命週期 Ready → Recording ↔ Paused → Finishing → Saved／NeedsReview；process 被殺回到 Recoverable（再選恢復／結束）。
 * - 點先寫入 LocalWorkoutStore（加密）再餵引擎；恢復以 seq 去重重播，不重播累加。
 * - 單調時間：本 process 內用定位 timestamp 差；跨 process 恢復標 interrupted（不以負時間補段）。
 * - Finish 先保存摘要；同步後端在背景進行（origin gps、只含摘要與圈，無座標），不阻塞進入摘要頁；同步失敗保留本機待重試。
 *
 * 2026-09-19 review 修正：
 * - start 失敗（定位服務起不來）會完整清理回 idle，可重試；啟動中為 `starting`。
 * - flush 寫入成功才移除待存點；失敗保留在佇列、標示 storage.failing 並以退避重試；結束時仍未落地的點數寫入 meta.unsavedPoints。
 * - 定位服務的 start／更新通知／stop 經同一條序列化佇列，並以 session id 檢查，結束後排隊中的更新不會再把定位叫起來。
 * - 感測器探測回來時確認仍是同一個 engine／session，舊運動的量測不會落到新運動。
 *
 * 2026-09-19 第二輪 review：
 * - 時間目標以運動時間（不含暫停）判定（goal.version 2），與畫面主時間一致。
 * - 配速過期：最後**採用**的定位點超過 10 s 即不再顯示速度／配速（`paceStale`），即使仍有被拒絕的點進來；距離保留。
 * - 自動繼續：改用引擎可採用門檻（50 m）並要求連續 2 個可用點都離暫停位置 ≥ 15 m，避免精度介於 20～50 m 時已起跑仍暫停。
 * - `active()` 回報進行中的 session；`markRecoverable()` 不再把它列成可恢復紀錄。
 * - finish 持久化失敗：狀態停在 finishing 並保留摘要，`retryFinish()` 可重試，不會卡死也不會遺失摘要。
 * - 自動暫停／繼續會發出事件（`onEvent`），提示服務據此震動或語音，不依賴畫面。
 */
export type RecorderState = 'idle' | 'starting' | 'recording' | 'paused' | 'finishing' | 'saved' | 'needs_review';
export type RecorderSnapshot = {
  state: RecorderState;
  sessionId: string | null;
  sport: 'run' | 'walk';
  /** 總時間（含暫停）；時間目標以此判定 */
  elapsedMs: number;
  /** 運動時間（不含暫停；暫停中不再增加）——記錄頁主時間 */
  movingMs: number;
  /** 累計暫停時間（暫停中持續增加） */
  pausedMs: number;
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
  /** PG-U-01 */
  intent: WorkoutIntent | null;
  goal: WorkoutGoal | null;
  /** 目標已達（依 elapsed／distance）；UI 只提醒一次，不自動停止 */
  goalReached: boolean;
  /** 完整性旗標（即時；防弊）；無引擎時空陣列 */
  integrityFlags: IntegrityFlag[];
  /** 即時軌跡（最近 ≤ 600 個接受點；只在記憶體） */
  path: RawPoint[];
  /** 最近 5 分鐘速度樣本（m/s） */
  speedSamples: { monotonicMs: number; speedMs: number }[];
  /** 最後一點的水平精度（m）；無點 → null */
  lastAccuracyM: number | null;
  /**
   * 配速過期（review 3）：記錄中超過 10 s 沒有任何點被**採用**（含「有點進來但全被拒」）。
   * 此時 currentSpeedMs／currentPaceSPerKm 為 null，畫面顯示「—／定位恢復中」；距離不受影響。
   */
  paceStale: boolean;
  /** 本次收到的定位點總數（含被拒絕的） */
  fixes: number;
  /**
   * 定位看門狗（實機回饋：第一次開跑「GPS 就緒」卻始終沒有點進來，要重開一次運動才會動）：
   * 開始後 12 s 仍 0 點 → 重啟背景定位任務（restarts+1）；再 12 s 仍 0 點 → 額外開啟前景 watchPosition 當備援來源（fallback）。
   */
  gpsRestarts: number;
  gpsFallback: boolean;
  /**
   * 戶外記錄中的 GPS 問題（實機回饋：跑道 14 分鐘 0 km 卻沒有提示）：
   * - `no_fix`：≥ 30 s 沒有任何定位點（系統定位關閉／室內／剛冷開機）
   * - `weak`：有點但精度都超過門檻、≥ 60 s 沒有任何點被採用（距離不會累計）
   * App 會持續嘗試，不會自行停止；非記錄中 → null
   */
  gpsIssue: { kind: 'no_fix' | 'weak'; sinceMs: number } | null;
  /** 暫停中：這次暫停是自動（靜止）還是手動；非暫停 → null */
  pauseKind: 'manual' | 'auto' | null;
  /** 本次 session 自動暫停累計（ms；含進行中的那段） */
  autoPausedMs: number;
  /**
   * 本機儲存狀態（review 2）：`pendingPoints` 為已餵引擎但尚未落地的點數；
   * `failing` 表示最近一次寫入失敗、正在退避重試。畫面距離會先累加，這裡讓使用者知道「還沒存好」。
   */
  storage: { pendingPoints: number; failing: boolean; lastError: string | null };
  /** finish 持久化失敗（review 5）：摘要已算好但寫不進本機；畫面提供重試。null＝沒有此情況 */
  finishError: string | null;
};
/** Recorder 事件（review 4／7）：提示服務用，不經畫面 */
export type RecorderEvent = { kind: 'auto_pause' } | { kind: 'auto_resume' } | { kind: 'session_start'; sessionId: string } | { kind: 'session_end'; sessionId: string };

type LocationApi = Pick<typeof Location, 'requestForegroundPermissionsAsync' | 'getForegroundPermissionsAsync' | 'startLocationUpdatesAsync' | 'stopLocationUpdatesAsync' | 'hasStartedLocationUpdatesAsync'> & { watchPositionAsync?: typeof Location.watchPositionAsync };
/** 感測器探測：回 true＝機身有步態、false＝沒有、null＝無法量測（無感測器／忙碌／背景） */
export type MotionProbe = () => Promise<boolean | null>;
export type ForegroundText = (s: RecorderSnapshot) => { title: string; body: string };
/** GPS 問題判定門檻（ms） */
export const GPS_ISSUE = { noFixMs: 30_000, weakMs: 60_000 } as const;
/**
 * 定位看門狗：開始（或恢復續錄）後每 `intervalMs` 檢查一次，仍沒有任何定位點 → 第 1 次重啟背景定位任務、第 2 次再開前景備援訂閱。
 * 實機：Seeker 第一次開跑常常整場 0 點（開始頁預熱已顯示就緒），結束再開一次就正常；之前只能靠使用者重開運動。
 */
export const GPS_WATCHDOG = { intervalMs: 12_000, maxRestarts: 1 } as const;
/** 前景服務通知的更新間隔：每次更新會重啟定位訂閱（expo-location setOptions），不宜太密 */
export const NOTIFICATION_UPDATE_MS = 30_000;
const defaultForegroundText: ForegroundText = (s) => ({ title: s.state === 'paused' ? 'NeonShift · paused' : 'NeonShift is recording', body: `${(s.distanceMm / 1_000_000).toFixed(2)} km · ${Math.floor(s.elapsedMs / 60000)}:${String(Math.floor((s.elapsedMs / 1000) % 60)).padStart(2, '0')} · tap to return` });
type Deps = { store?: LocalWorkoutStore; location?: LocationApi; now?: () => number; sync?: (input: WorkoutImportInput) => Promise<{ sessionId: string | null }>; foreground?: ForegroundText; motionProbe?: MotionProbe | null; probeIntervalMs?: number; /** 單調時鐘（預設 performance.now）；null＝不做時鐘漂移偵測 */ monotonic?: (() => number) | null };

/**
 * 自動暫停（Style 23.7）：5 秒窗速度 < 0.5 m/s 持續 ≥ 10 s → 自動暫停。
 * 自動繼續（review 4）：暫停中連續 `resumeConsecutive` 個可用點（精度 ≤ 引擎可採用門檻、非模擬）都離暫停位置 ≥ 15 m → 繼續。
 * 之前只看單一點且精度須 ≤ 20 m，而一般記錄接受到 50 m；精度 20～50 m 的路口起跑會一直停在暫停。
 * 改成連續兩點可抵擋單點飄移，門檻與引擎一致則「引擎會採計的移動」也能解除暫停。
 */
export const AUTO_PAUSE = { minSpeedMs: 0.5, stillMs: 10_000, resumeDistanceM: 15, maxAccuracyM: GPS_QUALITY.acceptMaxAccuracyM, resumeConsecutive: 2 } as const;
/** 裝置時區（IANA）；取不到 → null（日誌以裝置時區顯示） */
export const deviceTimeZone = (): string | null => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null; } catch { return null; } };
/** 配速過期門檻（ms）：超過此時間沒有點被採用就不顯示速度／配速 */
export const PACE_STALE_MS = 10_000;

/** 本機寫入失敗的重試退避（ms）：1 s 起倍增，最長 30 s；結束時最多再試 3 次 */
export const STORAGE_RETRY = { baseMs: 1_000, maxMs: 30_000, finishAttempts: 3 } as const;

/** 完整性探測節奏：記錄中每 3 分鐘量一次（前景才量）；GPS 5 秒窗速度 ≥ 1 m/s 才算「GPS 在動」 */
export const MOTION_PROBE_INTERVAL_MS = 180_000;
export const MOTION_PROBE_MIN_SPEED_MS = 1.0;
/** 預設探測：8 秒 50 Hz 加速度取樣；有計步器增量或 1～4 Hz 主頻＋足夠 RMS 視為有步態 */
export const defaultMotionProbe: MotionProbe = async () => {
  if (AppState.currentState !== 'active') return null;
  try {
    const s = await liveMotion.run(undefined, { durationSeconds: 8, windowSeconds: 4, sampleRateHz: 50 });
    if (s.stepCounterAvailable && s.stepDelta > 0) return true;
    return s.accelRms >= 0.6 && s.dominantFreqHz >= 1 && s.dominantFreqHz <= 4;
  } catch {
    return null;
  }
};

const defaultSync = async (input: WorkoutImportInput) => {
  const r = await apiClient.importWorkouts([input]);
  const first = r.results[0];
  // 後端判為 invalid（例：結束早於開始）→ 明確回原因，不再靜默當成「沒同步」
  if (first && first.outcome === 'invalid') throw new SyncRejected((first as { reasons?: string[] }).reasons ?? []);
  return { sessionId: first ? first.session.session_id : null };
};
/** 後端拒絕匯入（outcome invalid） */
export class SyncRejected extends Error {
  constructor(public readonly reasons: string[]) { super(reasons.join(', ') || 'invalid'); }
}
/** 同步結果（實機回饋：按「立即同步」沒有任何反應——之前所有錯誤都被吞掉） */
export type SyncOutcome = { ok: true } | { ok: false; code: 'NO_SESSION' | 'NETWORK_ERROR' | 'REJECTED' | 'UNKNOWN' | /** PG-LINK-02：自動同步關閉，只保存本機 */ 'DISABLED' | /** 較早紀錄待處理，本筆未輪到 */ 'BLOCKED_EARLIER' | /** 使用者已排除 */ 'EXCLUDED'; message: string };
export const syncOutcomeOf = (e: unknown): SyncOutcome => {
  if (e instanceof SyncRejected) return { ok: false, code: 'REJECTED', message: e.message };
  if (e instanceof ApiError) return { ok: false, code: e.code === 'NO_SESSION' ? 'NO_SESSION' : e.code === 'NETWORK_ERROR' ? 'NETWORK_ERROR' : 'UNKNOWN', message: e.message };
  return { ok: false, code: 'UNKNOWN', message: e instanceof Error ? e.message : String(e) };
};

/**
 * PG-U-01：目標達成判定；free 永不達。
 * review 2：時間目標用**運動時間**（不含暫停），與畫面主時間一致——之前用含暫停的 elapsed，休息時會默默達標。
 * 距離目標用接受距離。
 */
export const goalReached = (goal: WorkoutGoal | null, movingMs: number, distanceMm: number) => !!goal && goal.kind !== 'free' && goal.target > 0 && (goal.kind === 'time' ? movingMs >= goal.target * 1000 : distanceMm >= goal.target);

/** meta → 引擎設定（舊 meta 無 trackLapMm → null） */
const engineConfigOf = (meta: SessionMeta) => ({ autoLapMm: meta.autoLapMm, trackLapMm: meta.trackLapMm ?? null, splitLengthMm: meta.splitLengthMm });

export class WorkoutRecorder {
  private readonly store: LocalWorkoutStore;
  private readonly location: LocationApi;
  private readonly now: () => number;
  private readonly sync: (input: WorkoutImportInput) => Promise<{ sessionId: string | null }>;
  private foreground: ForegroundText;
  private lastNotifyAt = 0;
  private readonly motionProbe: MotionProbe | null;
  private readonly probeIntervalMs: number;
  private probeTimer: ReturnType<typeof setInterval> | null = null;
  /** 牆鐘 − 單調時鐘 的基準偏移；變動 > 容忍值＝記錄中有人改系統時間（定位點的兩個時間戳同源，無法自證） */
  private clockOffset0: number | null = null;
  private readonly monotonic: (() => number) | null;
  private probing = false;
  // 自動暫停狀態：靜止起算時間、自動暫停時的錨點（不持久化；跨 process 恢復後重算）
  private stillSince: number | null = null;
  private autoPausedAt: { lat: number; lon: number } | null = null;
  /** 自動暫停中連續「已離開暫停位置」的可用點數（review 4） */
  private resumeStreak = 0;
  private eventListeners = new Set<(e: RecorderEvent) => void>();
  /** finish 持久化失敗時保留的摘要與時間，供 retryFinish（review 5） */
  private finishPending: { summary: Summary; endedAt: number; unsaved: number } | null = null;
  private finishError: string | null = null;
  private engine: GpsMetricsEngine | null = null;
  private meta: SessionMeta | null = null;
  private state: RecorderState = 'idle';
  private lastPointAt = 0;
  private lastAccuracy: number | null = null;
  private lastAcceptedAt = 0;
  private fixes = 0;
  private listeners = new Set<() => void>();
  private pending: RawPoint[] = [];
  private flushing: Promise<void> | null = null;
  private storage: RecorderSnapshot['storage'] = { pendingPoints: 0, failing: false, lastError: null };
  private storageFailures = 0;
  private storageRetryTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * 定位服務操作序列化（review 4）：start／更新通知／stop 依序執行，不交錯。
   * `locationSession` 是「目前應該在跑定位服務」的 session；finish 一開始就清成 null，
   * 排隊中的更新通知執行時發現不符就跳過，不會在 stop 之後又把服務叫起來。
   */
  private locationBusy: Promise<void> | null = null;
  private locationSession: string | null = null;
  private readonly processId = randomUUID();
  // 定位看門狗（見 GPS_WATCHDOG）
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private gpsRestarts = 0;
  private fallbackSub: { remove: () => void } | null = null;
  private fallbackStarting = false;

  constructor(deps: Deps = {}) {
    this.store = deps.store ?? new LocalWorkoutStore();
    this.location = deps.location ?? Location;
    this.now = deps.now ?? (() => Date.now());
    this.sync = deps.sync ?? defaultSync;
    this.foreground = deps.foreground ?? defaultForegroundText;
    this.motionProbe = deps.motionProbe === undefined ? defaultMotionProbe : deps.motionProbe;
    this.probeIntervalMs = deps.probeIntervalMs ?? MOTION_PROBE_INTERVAL_MS;
    this.monotonic = deps.monotonic === undefined ? (typeof globalThis.performance?.now === 'function' ? () => globalThis.performance.now() : null) : deps.monotonic;
  }

  /** 前景通知文案（在地化由畫面提供；記錄中會定期以最新距離／時間更新，點通知回到 App） */
  setForegroundText(fn: ForegroundText) {
    this.foreground = fn;
  }
  /** PG-LINK-02：結束運動後的上傳掛鉤（由 WorkoutOutbox 安裝：依自動同步開關與有序佇列處理）；未安裝＝直接同步（測試／舊行為） */
  setAfterFinish(fn: ((meta: SessionMeta) => Promise<SyncOutcome>) | null) {
    this.afterFinish = fn;
  }
  private afterFinish: ((meta: SessionMeta) => Promise<SyncOutcome>) | null = null;
  /** 佇列／日誌需要直接讀本機 session（WorkoutOutbox、Activity） */
  localStore(): LocalWorkoutStore {
    return this.store;
  }
  private locationOptions() {
    const text = this.foreground(this.snapshot());
    return { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0, foregroundService: { notificationTitle: text.title, notificationBody: text.body, notificationColor: '#2EEAC6', killServiceOnDestroy: false } };
  }
  /**
   * 定位服務操作排隊執行。佇列閒置時立即開始（保持既有的同步呼叫時序），忙碌時接在前一個之後。
   * 失敗不會讓佇列卡住。
   */
  private runLocationOp(op: () => Promise<void>): Promise<void> {
    const prev = this.locationBusy;
    const run = prev ? prev.then(op, op) : op();
    const tracked: Promise<void> = run.catch(() => undefined).finally(() => {
      if (this.locationBusy === tracked) this.locationBusy = null;
    });
    this.locationBusy = tracked;
    return run;
  }
  /** 更新前景通知（實機回饋：退到背景後不知道 App 還在記錄）；重新送同一組定位選項即可讓 expo-location 重建通知 */
  private async refreshForeground(force = false) {
    const sid = this.meta?.sessionId;
    if (!sid || (this.state !== 'recording' && this.state !== 'paused')) return;
    const t = this.now();
    if (!force && t - this.lastNotifyAt < NOTIFICATION_UPDATE_MS) return;
    this.lastNotifyAt = t;
    await this.runLocationOp(async () => {
      // 排隊期間 session 可能已結束（review 4）：stop 之後不可再 start
      if (this.locationSession !== sid || this.meta?.sessionId !== sid) return;
      try {
        await this.location.startLocationUpdatesAsync(WORKOUT_LOCATION_TASK, this.locationOptions());
      } catch {
        // 通知只是輔助；失敗不影響記錄
      }
    });
  }

  /**
   * 定位看門狗（GPS_WATCHDOG）：開始後仍沒有任何點進來 → 先重啟背景定位任務，再不行就開前景備援訂閱。
   * 有點進來（fixes > 0）就不再檢查；備援訂閱與任務共用同一條去重／序號（toRawPoints），同一筆定位不會重複餵入。
   */
  private armWatchdog() {
    this.stopWatchdog();
    const sid = this.meta?.sessionId ?? null;
    const fixesAtArm = this.fixes;
    const schedule = () => {
      const timer = setTimeout(() => {
        this.watchdogTimer = null;
        if (!sid || this.meta?.sessionId !== sid || (this.state !== 'recording' && this.state !== 'paused')) return;
        if (this.fixes > fixesAtArm) return; // 已有定位點：不再檢查
        if (this.gpsRestarts < GPS_WATCHDOG.maxRestarts) {
          this.gpsRestarts += 1;
          this.emit();
          void this.restartLocation(sid);
          schedule();
        } else if (!this.fallbackSub && !this.fallbackStarting) {
          void this.startFallbackWatch(sid);
        }
      }, GPS_WATCHDOG.intervalMs);
      (timer as unknown as { unref?: () => void }).unref?.();
      this.watchdogTimer = timer;
    };
    schedule();
  }
  private stopWatchdog() {
    if (this.watchdogTimer) { clearTimeout(this.watchdogTimer); this.watchdogTimer = null; }
    this.fallbackSub?.remove();
    this.fallbackSub = null;
    this.fallbackStarting = false;
  }
  /** 停掉再啟動背景定位任務（同一 session；排隊執行，不與通知更新／finish 交錯） */
  private restartLocation(sid: string) {
    return this.runLocationOp(async () => {
      if (this.locationSession !== sid) return;
      try {
        if (await this.location.hasStartedLocationUpdatesAsync(WORKOUT_LOCATION_TASK)) await this.location.stopLocationUpdatesAsync(WORKOUT_LOCATION_TASK);
      } catch { /* 可能已被系統停止 */ }
      if (this.locationSession !== sid) return;
      try {
        await this.location.startLocationUpdatesAsync(WORKOUT_LOCATION_TASK, this.locationOptions());
      } catch { /* 起不來就交給備援訂閱 */ }
    });
  }
  /** 前景備援定位訂閱：與背景任務同時餵 ingest；session 結束時移除 */
  private async startFallbackWatch(sid: string) {
    const watch = this.location.watchPositionAsync;
    if (!watch) return;
    this.fallbackStarting = true;
    try {
      const sub = await watch({ accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 }, (l) => {
        if (this.meta?.sessionId !== sid) return;
        const pts = toRawPoints([l]);
        if (pts.length) this.ingest(pts);
      });
      if (this.meta?.sessionId !== sid || (this.state !== 'recording' && this.state !== 'paused')) { sub.remove(); return; }
      this.fallbackSub = sub;
      this.emit();
    } catch {
      /* 備援也起不來：畫面已有 no_fix 警示 */
    } finally {
      this.fallbackStarting = false;
    }
  }

  /** 完整性探測（防弊）：GPS 顯示在動而機身沒有步態 → 記一次不一致；量不到（背景／無感測器）不計 */
  private startProbes() {
    this.stopProbes();
    if (!this.motionProbe) return;
    this.probeTimer = setInterval(() => void this.runProbe(), this.probeIntervalMs);
  }
  private stopProbes() {
    if (this.probeTimer) clearInterval(this.probeTimer);
    this.probeTimer = null;
  }
  async runProbe(): Promise<void> {
    const engine = this.engine;
    const sid = this.meta?.sessionId ?? null;
    if (this.probing || !this.motionProbe || !engine || !sid || this.state !== 'recording') return;
    const speed = engine.windowSpeedMs();
    if (speed === null || speed < MOTION_PROBE_MIN_SPEED_MS) return; // GPS 沒在動就不用比
    this.probing = true;
    try {
      const moving = await this.motionProbe();
      // 量測期間可能已結束舊運動並開始新運動（review 6）：結果只能記到發起量測的那個 engine
      if (moving === null || this.engine !== engine || this.meta?.sessionId !== sid || this.state !== 'recording') return;
      engine.recordMotionProbe(!moving);
      this.emit();
    } finally {
      this.probing = false;
    }
  }

  /** 訂閱狀態變化；回傳的退訂函式可直接作 useEffect 的 cleanup */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
  /** 訂閱事件（自動暫停／繼續、session 開始／結束）；提示服務用 */
  onEvent(fn: (e: RecorderEvent) => void): () => void {
    this.eventListeners.add(fn);
    return () => { this.eventListeners.delete(fn); };
  }
  private emitEvent(e: RecorderEvent) {
    for (const l of this.eventListeners) l(e);
  }
  /** 進行中的 session（recording／paused／finishing）；畫面用來提供「返回目前運動」入口（review 6） */
  active(): { sessionId: string; state: RecorderState; sport: 'run' | 'walk' } | null {
    if (!this.meta || (this.state !== 'recording' && this.state !== 'paused' && this.state !== 'finishing')) return null;
    return { sessionId: this.meta.sessionId, state: this.state, sport: this.meta.sport };
  }
  private emit() {
    for (const l of this.listeners) l();
  }

  snapshot(): RecorderSnapshot {
    const e = this.engine;
    const t = this.now();
    const gps: RecorderSnapshot['gps'] = this.state !== 'recording' ? 'off' : !this.lastPointAt || t - this.lastPointAt > 10_000 ? 'searching' : this.lastAccuracy !== null && this.lastAccuracy > GPS_QUALITY.goodAccuracyM ? 'poor' : 'ok';
    const movingMs = e && this.meta ? e.elapsedAt(t) : 0;
    const pausedMs = e && this.meta && e.status !== 'finished' ? this.pausedTotal() : 0;
    const startedAt = this.meta?.startedMonoMs ?? t;
    const sinceFix = t - (this.lastPointAt || startedAt);
    const sinceAccepted = t - (this.lastAcceptedAt || startedAt);
    // review 3：以「最後採用點」判斷配速是否過期；只要 10 s 內沒有點被採用（不管有沒有點進來）就不展示舊速度
    const paceStale = this.state === 'recording' && sinceAccepted > PACE_STALE_MS;
    const gpsIssue: RecorderSnapshot['gpsIssue'] =
      this.state !== 'recording' ? null
      : sinceFix >= GPS_ISSUE.noFixMs ? { kind: 'no_fix', sinceMs: sinceFix }
      : this.lastAccuracy !== null && this.lastAccuracy > (e?.config.maxAccuracyM ?? 50) && sinceAccepted >= GPS_ISSUE.weakMs ? { kind: 'weak', sinceMs: sinceAccepted }
      : null;
    return {
      state: this.state,
      sessionId: this.meta?.sessionId ?? null,
      sport: this.meta?.sport ?? 'run',
      elapsedMs: movingMs + pausedMs,
      movingMs,
      pausedMs,
      distanceMm: e?.distanceMm ?? 0,
      // PG-U-02／review 3：定位失效或持續不合格（> 10 s 無採用點）不展示舊速度
      currentSpeedMs: gps === 'searching' || paceStale ? null : (e?.currentSpeedMs() ?? null),
      currentPaceSPerKm: gps === 'searching' || paceStale ? null : (e?.currentPaceSPerKm() ?? null),
      gps,
      accepted: this.meta?.acceptedCount ?? 0,
      splits: e ? [...e.splits] : [],
      laps: e ? [...e.laps] : [],
      trackEquivalent: e?.trackEquivalent() ?? null,
      interrupted: this.meta?.interrupted ?? false,
      intent: this.meta?.intent ?? null,
      goal: this.meta?.goal ?? null,
      goalReached: goalReached(this.meta?.goal ?? null, movingMs, e?.distanceMm ?? 0),
      integrityFlags: e ? e.integrity().flags : [],
      path: e ? e.recentPath() : [],
      speedSamples: e ? e.recentSpeeds() : [],
      lastAccuracyM: this.lastAccuracy,
      paceStale,
      fixes: this.fixes,
      gpsRestarts: this.gpsRestarts,
      gpsFallback: this.fallbackSub !== null,
      gpsIssue,
      pauseKind: this.state === 'paused' ? (this.meta?.pauses[this.meta.pauses.length - 1]?.kind ?? 'manual') : null,
      autoPausedMs: (this.meta?.pauses ?? []).filter((p) => p.kind === 'auto').reduce((n, p) => n + ((p.resumedAtMs ?? this.now()) - p.atMs), 0),
      storage: { ...this.storage, pendingPoints: this.pending.length },
      finishError: this.finishError,
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

  async start(opts: { sport: 'run' | 'walk'; intent?: WorkoutIntent | null; goal?: WorkoutGoal | null; environment: 'outdoor' | 'indoor'; autoLapMm?: number | null; trackLapMm?: number | null; splitLengthMm?: number; autoPause?: boolean; /** PG-LINK-01：開始時的跑鞋外觀快照 */ shoeSnapshot?: SessionMeta['shoeSnapshot']; routeAppearance?: SessionMeta['routeAppearance']; /** PG-LINK-02：建立時的玩家 */ owner?: string | null }): Promise<SessionMeta> {
    if (this.state !== 'idle') throw new Error('a session is already active');
    if (opts.environment === 'indoor') throw new Error('indoor sessions do not use GPS'); // Indoor 不啟用 GPS 推算距離
    const t = this.now();
    const sessionId = randomUUID();
    // review 1：啟動中另立狀態。定位服務起不來時完整清理回 idle，下一次 start 不會被「已有運動」擋住
    this.state = 'starting';
    this.emit();
    let created = false;
    try {
      this.meta = await this.store.create({ sessionId, sport: opts.sport, intent: opts.intent ?? (opts.sport === 'run' ? 'run' : null), goal: opts.goal ?? null, environment: opts.environment, autoLapMm: opts.autoLapMm ?? null, trackLapMm: opts.trackLapMm ?? null, autoPause: opts.autoPause ?? false, splitLengthMm: opts.splitLengthMm ?? 1_000_000, status: 'recording', startedAtUtc: t, startedMonoMs: t, processId: this.processId, shoeSnapshot: opts.shoeSnapshot ?? null, routeAppearance: opts.routeAppearance, owner: opts.owner ?? null, recordedTimeZone: deviceTimeZone() });
      created = true;
      this.engine = new GpsMetricsEngine(opts.sport, engineConfigOf(this.meta));
      this.engine.start(t);
      this.lastPointAt = 0;
      this.lastAcceptedAt = 0;
      this.fixes = 0;
      this.clockOffset0 = null;
      this.stillSince = null;
      this.autoPausedAt = null;
      this.resumeStreak = 0;
      this.finishPending = null;
      this.finishError = null;
      this.pending = [];
      this.resetStorageState();
      this.lastNotifyAt = t;
      this.gpsRestarts = 0;
      this.locationSession = sessionId;
      resetLocationSeq(0);
      await this.runLocationOp(async () => {
        if (this.locationSession !== sessionId) return; // 啟動途中已被取消
        // 上一個 process 沒停掉的任務登記（被系統殺掉／滑掉 App）：同名再 start 只會換選項，定位有時不會真的重來；先停乾淨再啟動
        try {
          if (await this.location.hasStartedLocationUpdatesAsync(WORKOUT_LOCATION_TASK)) await this.location.stopLocationUpdatesAsync(WORKOUT_LOCATION_TASK);
        } catch { /* 查不到就直接啟動 */ }
        await this.location.startLocationUpdatesAsync(WORKOUT_LOCATION_TASK, this.locationOptions());
      });
      // 定位服務已在跑，才開始收點
      setLocationSink((pts) => this.ingest(pts));
      this.state = 'recording';
      this.startProbes();
      this.armWatchdog();
      this.emit();
      this.emitEvent({ kind: 'session_start', sessionId });
      return this.meta;
    } catch (e) {
      this.locationSession = null;
      setLocationSink(null);
      this.stopProbes();
      this.stopWatchdog();
      this.engine = null;
      this.meta = null;
      this.pending = [];
      this.state = 'idle';
      if (created) {
        try { this.store.delete(sessionId); } catch { /* 清不掉就留給 markRecoverable 當可恢復紀錄 */ }
      }
      this.emit();
      throw e;
    }
  }

  /** 定位點進來：先持久化（批次）再餵引擎；引擎拒絕的點也保留（審查用） */
  ingest(points: RawPoint[]) {
    if (!this.engine || !this.meta || (this.state !== 'recording' && this.state !== 'paused')) return;
    this.pending.push(...points);
    if (this.monotonic) {
      const offset = this.now() - this.monotonic();
      if (this.clockOffset0 === null) this.clockOffset0 = offset;
      else this.engine.recordClockDrift(Math.abs(offset - this.clockOffset0));
    }
    let autoResume = false;
    for (const p of points) {
      this.lastPointAt = this.now();
      this.lastAccuracy = p.accuracyM;
      this.fixes += 1;
      // 自動暫停中（review 4）：連續 N 個可用點（精度 ≤ 引擎可採用門檻、非模擬）都離暫停位置 ≥ 15 m → 自動繼續；單點飄移歸零重數
      if (this.autoPausedAt && this.state === 'paused') {
        const usable = !p.mocked && p.accuracyM <= AUTO_PAUSE.maxAccuracyM;
        const away = usable && haversineMm(this.autoPausedAt.lat, this.autoPausedAt.lon, p.lat, p.lon) >= AUTO_PAUSE.resumeDistanceM * 1000;
        this.resumeStreak = away ? this.resumeStreak + 1 : 0;
        if (this.resumeStreak >= AUTO_PAUSE.resumeConsecutive) autoResume = true;
      }
      const r = this.engine.addPoint(p);
      if (r.accepted) { this.meta.acceptedCount += 1; this.lastAcceptedAt = this.now(); }
      this.meta.lastSeq = Math.max(this.meta.lastSeq, p.seq);
    }
    void this.flush();
    if (autoResume) void this.resume('auto');
    else this.maybeAutoPause(points[points.length - 1]);
    this.emit();
    void this.refreshForeground();
  }

  /** 自動暫停判定：只在 recording 且啟用時；5 秒窗速度 < 0.5 m/s 累計 ≥ 10 s → pause('auto') */
  private maybeAutoPause(last: RawPoint | undefined) {
    if (!this.engine || !this.meta?.autoPause || this.state !== 'recording' || !last) return;
    const speed = this.engine.windowSpeedMs(); // 用未平滑的 5 秒窗：停下要即時反應，顯示用的 EMA 會拖慢
    if (speed === null) return; // 窗不完整（剛開始／缺口）不判定
    const t = this.now();
    if (speed >= AUTO_PAUSE.minSpeedMs) {
      this.stillSince = null;
      return;
    }
    this.stillSince ??= t;
    if (t - this.stillSince >= AUTO_PAUSE.stillMs) {
      this.stillSince = null;
      this.autoPausedAt = { lat: last.lat, lon: last.lon };
      this.resumeStreak = 0;
      void this.pause('auto').then((ok) => { if (ok) this.emitEvent({ kind: 'auto_pause' }); });
    }
  }
  private resetStorageState() {
    this.storage = { pendingPoints: 0, failing: false, lastError: null };
    this.storageFailures = 0;
    if (this.storageRetryTimer) clearTimeout(this.storageRetryTimer);
    this.storageRetryTimer = null;
  }
  private scheduleStorageRetry() {
    if (this.storageRetryTimer) return;
    const delay = Math.min(STORAGE_RETRY.maxMs, STORAGE_RETRY.baseMs * 2 ** Math.max(0, this.storageFailures - 1));
    this.storageRetryTimer = setTimeout(() => {
      this.storageRetryTimer = null;
      void this.flush();
    }, delay);
  }
  /**
   * 把待存點批次寫入本機。review 2：寫入成功才從佇列移除；失敗保留原批、標示 storage.failing 並退避重試。
   * 之前是先 splice 再寫，磁碟或加密寫入失敗時那批點就永遠不見了，但畫面距離已先累加。
   */
  private async flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      while (this.pending.length && this.meta) {
        const meta = this.meta;
        const batch = this.pending.slice(0, 50);
        try {
          await this.store.appendPoints(meta.sessionId, batch);
          await this.store.writeMeta(meta);
        } catch (e) {
          this.storageFailures += 1;
          this.storage = { pendingPoints: this.pending.length, failing: true, lastError: e instanceof Error ? e.message : String(e) };
          this.scheduleStorageRetry();
          this.emit();
          return;
        }
        // 只移除剛寫成功的那一批；期間新進的點在尾端，不受影響
        this.pending.splice(0, batch.length);
        if (this.storage.failing) {
          this.resetStorageState();
          this.emit();
        }
      }
    })().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  async pause(kind: 'manual' | 'auto' = 'manual') {
    if (this.state !== 'recording' || !this.engine || !this.meta) return false;
    const t = this.now();
    this.engine.pause(t);
    if (kind === 'manual') this.autoPausedAt = null; // 手動暫停不會被移動自動解除
    this.meta.pauses.push({ atMs: t, resumedAtMs: null, kind });
    this.meta.status = 'paused';
    this.state = 'paused';
    await this.store.writeMeta(this.meta);
    this.emit();
    void this.refreshForeground(true);
    return true;
  }
  async resume(by: 'manual' | 'auto' = 'manual') {
    if (this.state !== 'paused' || !this.engine || !this.meta) return false;
    const t = this.now();
    this.engine.resume(t);
    this.autoPausedAt = null;
    this.stillSince = null;
    this.resumeStreak = 0;
    if (by === 'auto') this.emitEvent({ kind: 'auto_resume' });
    const last = this.meta.pauses[this.meta.pauses.length - 1];
    if (last && last.resumedAtMs === null) last.resumedAtMs = t;
    this.meta.status = 'recording';
    this.state = 'recording';
    await this.store.writeMeta(this.meta);
    this.emit();
    void this.refreshForeground(true);
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

  /**
   * 結束：停止定位 → 先保存摘要 → 回傳（畫面可立即進摘要頁）；後端同步在背景進行，結果由 `sync` 取得。
   * review 3：之前會等 syncMeta 完成才回傳，網路卡住時摘要頁與 Recorder 重設都被延遲。
   */
  async finish(): Promise<{ meta: SessionMeta; summary: Summary; sync: Promise<SyncOutcome> }> {
    if (!this.engine || !this.meta || (this.state !== 'recording' && this.state !== 'paused')) throw new Error('no active session');
    this.state = 'finishing';
    this.emit();
    this.stopProbes();
    this.stopWatchdog();
    setLocationSink(null);
    // review 4：先撤銷 session 標記，排隊中的更新通知執行時會跳過；stop 接在既有操作之後，不與 start 交錯
    this.locationSession = null;
    await this.runLocationOp(async () => {
      try {
        if (await this.location.hasStartedLocationUpdatesAsync(WORKOUT_LOCATION_TASK)) await this.location.stopLocationUpdatesAsync(WORKOUT_LOCATION_TASK);
      } catch {
        /* 服務可能已被系統停止 */
      }
    });
    const t = this.now();
    const last = this.meta.pauses[this.meta.pauses.length - 1];
    if (last && last.resumedAtMs === null) last.resumedAtMs = t;
    const summary = this.engine.finish(t);
    // review 2：儲存失敗時再試幾次；仍未落地的點數記入 meta，讓摘要與後端都知道這筆不完整
    for (let i = 0; i < STORAGE_RETRY.finishAttempts && this.pending.length; i++) await this.flush();
    this.finishPending = { summary, endedAt: t, unsaved: this.pending.length };
    return this.persistFinish();
  }
  /**
   * finish 的持久化段（review 5）：寫 meta 失敗時狀態停在 finishing、保留摘要並記錄 finishError，
   * 畫面可呼叫 `retryFinish()`；成功才重設為 idle。之前寫入拋錯會讓畫面停在「結束中」且無法再試。
   */
  private async persistFinish(): Promise<{ meta: SessionMeta; summary: Summary; sync: Promise<SyncOutcome> }> {
    if (!this.meta || !this.finishPending) throw new Error('nothing to finish');
    const { summary, endedAt, unsaved } = this.finishPending;
    this.meta.endedAtUtc = endedAt;
    this.meta.summary = summary;
    if (unsaved > 0) this.meta.unsavedPoints = unsaved;
    this.meta.status = summary.quality.complete && !this.meta.interrupted && summary.integrity.flags.length === 0 && unsaved === 0 ? 'saved' : 'needs_review';
    try {
      await this.store.writeMeta(this.meta);
    } catch (e) {
      this.finishError = e instanceof Error ? e.message : String(e);
      this.emit();
      throw e;
    }
    this.finishError = null;
    this.finishPending = null;
    this.state = this.meta.status;
    this.emit();
    const meta = this.meta;
    const out = { meta, summary, sync: this.syncInBackground(meta) };
    this.engine = null;
    this.meta = null;
    this.pending = [];
    this.resetStorageState();
    this.state = 'idle';
    this.emit();
    this.emitEvent({ kind: 'session_end', sessionId: meta.sessionId });
    return out;
  }
  /** 重試 finish 的本機保存（review 5）；只在 finish 因寫入失敗停在 finishing 時有效 */
  async retryFinish(): Promise<{ meta: SessionMeta; summary: Summary; sync: Promise<SyncOutcome> }> {
    if (this.state !== 'finishing' || !this.finishPending) throw new Error('no failed finish to retry');
    // 再給待存點一次機會
    for (let i = 0; i < STORAGE_RETRY.finishAttempts && this.pending.length; i++) await this.flush();
    this.finishPending.unsaved = this.pending.length;
    return this.persistFinish();
  }
  /** 背景同步：完成後 emit，讓已開啟的摘要頁重讀 meta；syncMeta 不會 reject */
  private syncInBackground(meta: SessionMeta): Promise<SyncOutcome> {
    return (this.afterFinish ? this.afterFinish(meta) : this.syncMeta(meta)).then((r) => {
      this.emit();
      return r;
    });
  }

  /** 已結束但尚未同步到帳號的本機 session（實機回饋：離開摘要頁後就再也找不到、無法補同步） */
  unsynced(): SessionMeta[] {
    return this.store.list().filter((m) => (m.status === 'saved' || m.status === 'needs_review') && !m.syncedSessionId && !!m.summary && !m.deletedAt).sort((a, b) => b.startedAtUtc - a.startedAtUtc);
  }
  /** 刪除本機 session（未同步的測試紀錄）；記錄中不可刪 */
  deleteLocal(sessionId: string) {
    if (this.meta?.sessionId === sessionId) throw new Error('session is active');
    this.store.delete(sessionId);
  }

  /** 摘要同步（origin gps；不含座標）；冪等：external_record_id = sessionId */
  async syncMeta(meta: SessionMeta): Promise<SyncOutcome> {
    if (meta.syncedSessionId) return { ok: true };
    if (!meta.summary) return { ok: false, code: 'UNKNOWN', message: 'no summary' };
    const s = meta.summary;
    const flags: string[] = [];
    if (s.quality.gaps > 0 || s.quality.coverageRatio < 0.9) flags.push('gps_gap');
    if (meta.interrupted) flags.push('interrupted');
    if ((meta.unsavedPoints ?? 0) > 0) flags.push('storage_incomplete'); // review 2：本機有點未落地，摘要距離含未持久化的部分
    flags.push(...(s.integrity?.flags ?? [])); // 完整性旗標原樣上送；後端二次判定，不只信 App
    try {
      const r = await this.sync({
        sport: meta.sport,
        intent: meta.intent ?? null,
        goal: meta.goal ?? null,
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
        extras: { gps_rules_version: s.rulesVersion, max_speed_5s_kmh: s.maxSpeed5sKmh, moving_ms: s.movingMs, splits: s.splits, laps: s.laps, quality: s.quality, integrity: s.integrity ?? null, track_equivalent: s.trackEquivalent, recorded_time_zone: meta.recordedTimeZone ?? null, shoe: meta.shoeSnapshot ?? null, route_appearance: meta.routeAppearance ?? { version: 1, layer: 'grid' } },
      });
      if (r.sessionId) {
        meta.syncedSessionId = r.sessionId;
        await this.store.writeMeta(meta);
        return { ok: true };
      }
      return { ok: false, code: 'UNKNOWN', message: 'no session id' };
    } catch (e) {
      // 離線／未登入／被拒：保留本機待重試，把原因交給畫面
      return syncOutcomeOf(e);
    }
  }

  /** 恢復未正常結束的 session：同 process 可續錄；跨 process 標 interrupted 只允許結束 */
  async recover(sessionId: string, action: 'continue' | 'finish' | 'discard'): Promise<{ meta: SessionMeta | null; summary?: Summary; sync?: Promise<SyncOutcome> }> {
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
      this.pending = [];
      this.resetStorageState();
      this.resumeStreak = 0;
      this.finishPending = null;
      this.finishError = null;
      this.state = engine.status === 'paused' ? 'paused' : 'recording';
      meta.status = this.state;
      await this.store.writeMeta(meta);
      this.locationSession = meta.sessionId;
      resetLocationSeq(meta.lastSeq + 1);
      setLocationSink((pts) => this.ingest(pts));
      this.gpsRestarts = 0;
      this.armWatchdog();
      this.emit();
      this.emitEvent({ kind: 'session_start', sessionId: meta.sessionId });
      return { meta };
    }
    // 跨 process 或選擇結束：以最後一點時間結束，不用負時間補段
    const endT = points.length ? points[points.length - 1]!.monotonicMs : meta.startedMonoMs + 1;
    const summary = engine.finish(Math.max(endT, meta.startedMonoMs + 1));
    meta.endedAtUtc = meta.endedAtUtc ?? meta.startedAtUtc + summary.elapsedMs;
    meta.summary = summary;
    meta.status = 'needs_review';
    await this.store.writeMeta(meta);
    return { meta, summary, sync: this.syncInBackground(meta) };
  }

  /** 啟動時：把仍在 recording／paused 的 session 標為 recoverable（不自動續錄）；進行中的 session 不在其列（review 6） */
  async markRecoverable(): Promise<SessionMeta[]> {
    const activeId = this.active()?.sessionId ?? null;
    const list = this.store.recoverable().filter((m) => m.sessionId !== activeId);
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
// XD-02：讓錢包時間線知道操作是否發生在運動記錄中（避免 wallet → workouts 反向 import）
walletTimeline.setRecordingProbe(() => workoutRecorder.active() !== null);
