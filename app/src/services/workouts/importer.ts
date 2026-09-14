import { toImportInput, type ExerciseSessionInput } from '@/domain/workouts';
import { apiClient } from '@/services/api/ApiClient';

/**
 * Health Connect ExerciseSession 匯入（PG-R-01 契約；實際讀取由 PG-R-02 的原生模組 `readExerciseSessions` 提供）。
 * 這裡負責：轉換、過濾不支援運動、分批（≤ 50）、回報結果。原生模組未提供時回 unavailable，不假裝已匯入。
 */
export type ImportOutcome = { kind: 'ok'; imported: number; superseded: number; skipped: number } | { kind: 'unavailable' };

type Reader = { readExerciseSessions?: (startUnix: number, endUnix: number) => Promise<{ sessions: ExerciseSessionInput[] }> };

export async function importFromHealthConnect(opts: { days?: number; reader?: Reader; stepLengthMm?: number | null } = {}): Promise<ImportOutcome> {
  const reader = opts.reader ?? (require('../../../modules/neonshift-health/src/NeonshiftHealthModule') as { default: Reader }).default;
  if (typeof reader.readExerciseSessions !== 'function') return { kind: 'unavailable' };
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
