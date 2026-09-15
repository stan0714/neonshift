/**
 * 回顧與分享（PG-U-03；sport-experience-gameplay 4）：
 * - 模式篩選：walking（走路＋健走合看）／running；不把每日步數與 session 步數相加。
 * - 週回顧：本地週一為顯示邊界、標時區；與鏈上 UTC 七日維持週期名稱、截止分開。
 * - 同類比較：只與同 sport／environment／verification class（origin gps＝device）／timing basis 比較；不足 3 筆不生成改善百分比。
 * - 分享預覽：預設無座標、精確開始時間與錢包地址；勾選後才加入日期／配速等公開欄位。
 */
import type { WorkoutSummary } from '@/services/api/ApiClient';

export type ModeFilter = 'all' | 'walking' | 'running';
export const matchesMode = (w: Pick<WorkoutSummary, 'sport'>, f: ModeFilter) => f === 'all' || (f === 'running' ? w.sport === 'run' : w.sport === 'walk');

/** 本地週一 00:00 起算的週鍵（YYYY-MM-DD of Monday） */
export function localWeekStart(d: Date): Date {
  const day = (d.getDay() + 6) % 7; // Mon=0
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
  s.setHours(0, 0, 0, 0);
  return s;
}
const pad = (n: number) => String(n).padStart(2, '0');
export const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const localTimeZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'; } catch { return 'local'; } };

export type WeekReview = { weekStart: string; sessions: number; activeDays: number; distanceMm: bigint; elapsedMs: bigint; byMode: { walking: number; running: number } };
/** 每週彙總（只算 saved／needs_review，不含 deleted／invalid）；同日多筆算一個活躍日 */
export function weeklyReview(items: WorkoutSummary[], filter: ModeFilter = 'all'): WeekReview[] {
  const weeks = new Map<string, WeekReview & { days: Set<string> }>();
  for (const w of items) {
    if (w.status === 'deleted' || w.status === 'invalid' || !matchesMode(w, filter)) continue;
    const start = localWeekStart(new Date(w.started_at));
    const key = dateKey(start);
    const cur = weeks.get(key) ?? { weekStart: key, sessions: 0, activeDays: 0, distanceMm: 0n, elapsedMs: 0n, byMode: { walking: 0, running: 0 }, days: new Set<string>() };
    cur.sessions += 1;
    cur.days.add(dateKey(new Date(w.started_at)));
    cur.distanceMm += BigInt(w.metrics.distance?.value_mm ?? '0');
    cur.elapsedMs += BigInt(w.elapsed_ms);
    cur.byMode[w.sport === 'run' ? 'running' : 'walking'] += 1;
    weeks.set(key, cur);
  }
  return [...weeks.values()].map(({ days, ...r }) => ({ ...r, activeDays: days.size })).sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1));
}

export const MIN_COMPARABLE = 3;
export type Comparison = { count: number; avgPaceSPerKm: number | null; avgDistanceMm: bigint; paceDeltaPct: number | null; distanceDeltaPct: number | null } | null;
/** 同類比較：同 sport／environment／來源等級（gps／device 視為 device、organizer 另類）；不足 MIN_COMPARABLE 回 null */
export function compareSameCategory(target: WorkoutSummary, items: WorkoutSummary[]): Comparison {
  const cls = (w: WorkoutSummary) => (w.source.origin === 'organizer' ? 'organizer' : 'device');
  const peers = items.filter((w) => w.session_id !== target.session_id && w.status === 'saved' && w.sport === target.sport && w.environment === target.environment && cls(w) === cls(target) && w.metrics.distance);
  if (peers.length < MIN_COMPARABLE) return null;
  const paces = peers.map((w) => w.metrics.avg_pace_s_per_km).filter((p): p is number => p !== null);
  const avgPace = paces.length >= MIN_COMPARABLE ? paces.reduce((a, b) => a + b, 0) / paces.length : null;
  const avgDist = peers.reduce((a, w) => a + BigInt(w.metrics.distance!.value_mm), 0n) / BigInt(peers.length);
  const tPace = target.metrics.avg_pace_s_per_km;
  const tDist = target.metrics.distance ? BigInt(target.metrics.distance.value_mm) : null;
  return {
    count: peers.length,
    avgPaceSPerKm: avgPace === null ? null : Math.round(avgPace),
    avgDistanceMm: avgDist,
    paceDeltaPct: avgPace !== null && tPace !== null ? Math.round(((avgPace - tPace) / avgPace) * 100) : null, // 正＝更快
    distanceDeltaPct: tDist !== null && avgDist > 0n ? Math.round(Number(((tDist - avgDist) * 1000n) / avgDist) / 10) : null,
  };
}

export type ShareFields = { date: boolean; pace: boolean; mode: boolean };
/** 分享文字：預設只含距離與時間；日期（不含精確開始時間）／配速／模式需勾選；永不含座標、錢包 */
export function shareText(w: Pick<WorkoutSummary, 'sport' | 'intent' | 'started_at' | 'elapsed_ms' | 'metrics'>, fields: ShareFields, labels: { mode: string; app: string }): string {
  const km = w.metrics.distance ? (Number(w.metrics.distance.value_mm) / 1_000_000).toFixed(2) : '—';
  const s = Number(BigInt(w.elapsed_ms) / 1000n);
  const dur = `${Math.floor(s / 3600) ? `${Math.floor(s / 3600)}:` : ''}${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  const parts = [`${fields.mode ? `${labels.mode} · ` : ''}${km} km · ${dur}`];
  if (fields.pace && w.metrics.avg_pace_s_per_km !== null) parts.push(`${Math.floor(w.metrics.avg_pace_s_per_km / 60)}:${pad(w.metrics.avg_pace_s_per_km % 60)} /km`);
  if (fields.date) parts.push(dateKey(new Date(w.started_at)));
  parts.push(`#${labels.app}`);
  return parts.join(' · ');
}
