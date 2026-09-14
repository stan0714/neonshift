import type { WorkoutImportInput, WorkoutSummary } from '@/services/api/ApiClient';

/**
 * 運動 session 領域邏輯（PG-R-01；activity-running-gallery 3.2／4）。
 * 內部整數毫米／毫秒／毫 kcal；顯示才換算。估算距離只在有校準步長時產生，且不具 PB 資格（由後端判定）。
 */

/** Health Connect ExerciseSession 的最小映射輸入（R-02 由原生模組讀取後填入；此處只做轉換與檢核） */
export type ExerciseSessionInput = {
  /** Health Connect record id（跨 App 唯一）；沒有時以 dataOrigin + startTime 組成 */
  recordId: string | null;
  /** 寫入 App package（來源） */
  dataOrigin: string;
  /** Health Connect exercise type：RUNNING=56、WALKING=79、RUNNING_TREADMILL=57 */
  exerciseType: number;
  startUnixMs: number;
  endUnixMs: number;
  /** 來源 metadata 版本（clientRecordVersion 或 lastModifiedTime 秒）；沒有時 1 */
  version?: number;
  distanceMeters?: number | null;
  steps?: number | null;
  activeKcal?: number | null;
  totalKcal?: number | null;
  /** 部分權限（例如沒有 DISTANCE 權限）→ 標 partial_permissions */
  partialPermissions?: boolean;
};

const HC_RUNNING = 56;
const HC_RUNNING_TREADMILL = 57;
const HC_WALKING = 79;

export function sportOf(exerciseType: number): { sport: 'run' | 'walk'; environment: 'outdoor' | 'indoor' | 'unknown' } | null {
  if (exerciseType === HC_RUNNING) return { sport: 'run', environment: 'unknown' };
  if (exerciseType === HC_RUNNING_TREADMILL) return { sport: 'run', environment: 'indoor' };
  if (exerciseType === HC_WALKING) return { sport: 'walk', environment: 'unknown' };
  return null; // 其他運動不在範圍（僅跑步與健走）
}

const mmOf = (m: number | null | undefined) => (m === null || m === undefined || !Number.isFinite(m) || m < 0 ? null : String(Math.round(m * 1000)));
const mkcalOf = (k: number | null | undefined) => (k === null || k === undefined || !Number.isFinite(k) || k < 0 ? null : String(Math.round(k * 1000)));

/**
 * 轉成匯入 payload；不支援的運動回 null。Active／Total 熱量分開，不相加、不互充；距離來自裝置即標 device。
 * 不套通用步長：沒有校準步長就不估算距離（後端也不會）。
 */
export function toImportInput(e: ExerciseSessionInput, opts: { stepLengthMm?: number | null } = {}): WorkoutImportInput | null {
  const kind = sportOf(e.exerciseType);
  if (!kind || !Number.isFinite(e.startUnixMs) || !Number.isFinite(e.endUnixMs) || e.endUnixMs <= e.startUnixMs) return null;
  const distance = mmOf(e.distanceMeters);
  const flags: string[] = [];
  if (e.partialPermissions) flags.push('partial_permissions');
  return {
    sport: kind.sport,
    environment: kind.environment,
    origin: 'health_connect',
    source_id: e.dataOrigin,
    external_record_id: e.recordId ?? `${e.dataOrigin}:${e.startUnixMs}`,
    source_revision: Math.max(1, Math.floor(e.version ?? 1)),
    started_at: new Date(e.startUnixMs).toISOString(),
    ended_at: new Date(e.endUnixMs).toISOString(),
    distance_mm: distance,
    distance_method: distance ? 'device' : null,
    steps: e.steps === null || e.steps === undefined || !Number.isFinite(e.steps) || e.steps < 0 ? null : Math.floor(e.steps),
    active_energy_mkcal: mkcalOf(e.activeKcal),
    energy_method: mkcalOf(e.activeKcal) ? 'device' : null,
    total_energy_mkcal: mkcalOf(e.totalKcal),
    step_length_mm: distance ? null : (opts.stepLengthMm ?? null),
    client_flags: flags,
  };
}

/** 顯示用：秒／公里 → `m:ss /km`；無距離回 `—` */
export const formatPace = (sPerKm: number | null) => (sPerKm === null || !Number.isFinite(sPerKm) || sPerKm <= 0 ? '—' : `${Math.floor(sPerKm / 60)}:${String(sPerKm % 60).padStart(2, '0')} /km`);
export const formatKm = (mm: string | null | undefined) => (mm === null || mm === undefined ? '—' : `${(Number(mm) / 1_000_000).toFixed(2)} km`);
export const formatDuration = (ms: string) => {
  const s = Math.floor(Number(ms) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`;
};
export const formatKcal = (mkcal: string | null | undefined) => (mkcal === null || mkcal === undefined ? '—' : `${Math.round(Number(mkcal) / 1000)} kcal`);

/** Chip 對應：品質 → 顯示種類 */
export const qualityKind = (q: WorkoutSummary['quality']): 'synced' | 'neutral' | 'offline' | 'devnet' => (q === 'complete' ? 'synced' : q === 'estimated' || q === 'partial' ? 'neutral' : q === 'needs_review' ? 'devnet' : 'offline');
