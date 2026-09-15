import { toImportInput, type ExerciseSessionInput } from '@/domain/workouts';
import { apiClient } from '@/services/api/ApiClient';

/**
 * Health Connect ExerciseSession 匯入（PG-R-01 契約；實際讀取由 PG-R-02 的原生模組 `readExerciseSessions` 提供）。
 * 這裡負責：轉換、過濾不支援運動、分批（≤ 50）、回報結果。原生模組未提供時回 unavailable，不假裝已匯入。
 */
export type ImportOutcome = { kind: 'ok'; imported: number; superseded: number; skipped: number } | { kind: 'unavailable' } | { kind: 'denied' };

type Reader = {
  PERMISSION_READ_EXERCISE?: string;
  PERMISSION_READ_DISTANCE?: string;
  PERMISSION_READ_ACTIVE_CALORIES?: string;
  PERMISSION_READ_TOTAL_CALORIES?: string;
  getGrantedPermissions?: () => Promise<string[]>;
  requestPermissions?: (permissions: string[]) => Promise<string[]>;
  readExerciseSessions?: (startUnix: number, endUnix: number) => Promise<{ sessions: ExerciseSessionInput[] }>;
};

/** 需要 READ_EXERCISE 才能匯入；距離／熱量為可選（缺時欄位為 null、標 partial_permissions），拒絕不阻擋其他功能 */
async function ensureExercisePermission(reader: Reader): Promise<boolean> {
  const need = reader.PERMISSION_READ_EXERCISE;
  if (!need || !reader.getGrantedPermissions || !reader.requestPermissions) return true;
  let granted = await reader.getGrantedPermissions();
  if (granted.includes(need)) return true;
  granted = await reader.requestPermissions([need, reader.PERMISSION_READ_DISTANCE, reader.PERMISSION_READ_ACTIVE_CALORIES, reader.PERMISSION_READ_TOTAL_CALORIES].filter((p): p is string => !!p));
  return granted.includes(need);
}

export async function importFromHealthConnect(opts: { days?: number; reader?: Reader; stepLengthMm?: number | null } = {}): Promise<ImportOutcome> {
  const reader = opts.reader ?? (require('../../../modules/neonshift-health/src/NeonshiftHealthModule') as { default: Reader }).default;
  if (typeof reader.readExerciseSessions !== 'function') return { kind: 'unavailable' };
  if (!(await ensureExercisePermission(reader))) return { kind: 'denied' };
  const end = Math.floor(Date.now() / 1000);
  const start = end - (opts.days ?? 30) * 86_400;
  const { sessions } = await reader.readExerciseSessions(start, end);
  const inputs = sessions.map((s) => toImportInput(s, { stepLengthMm: opts.stepLengthMm ?? null })).filter((x): x is NonNullable<typeof x> => x !== null);
  let imported = 0;
  let superseded = 0;
  for (let i = 0; i < inputs.length; i += 50) {
    const r = await apiClient.importWorkouts(inputs.slice(i, i + 50));
    imported += r.imported;
    superseded += r.results.filter((x) => x.outcome === 'superseded').length;
  }
  return { kind: 'ok', imported, superseded, skipped: sessions.length - inputs.length };
}
