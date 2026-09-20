import { routeAppearanceOf, type RouteAppearance } from '@/domain/appearance';
/**
 * 我的運動 Activity（PG-LINK-04，docs/shoe-sync-activity.md §4）：純函式——合併本機與伺服器紀錄、以 canonical id 去重、
 * 月／日分組依 session 保存的當地時區（跨午夜歸開始日）、篩選、穩定排序、月總覽（只計有效且去重的紀錄，待審另列）。
 * 缺值一律 null（顯示 —），不當 0；不以均速偽造最快分段。
 */
import type { WorkoutIntent, WorkoutSummary } from '@/services/api/ApiClient';
import type { SessionMeta } from '@/services/workouts/LocalWorkoutStore';
import type { OutboxEntry } from '@/services/workouts/WorkoutOutbox';

export type ActivityStatus = 'local' | 'queued' | 'sync_failed' | 'excluded' | 'delete_pending' | 'synced' | 'needs_review' | 'server_only';
export type ActivitySource = 'device_gps' | 'imported' | 'manual';
export type ActivityItem = {
  /** canonical id：已同步／伺服器 → 伺服器 session id；純本機 → 本機 sessionId */
  id: string;
  routeAppearance: RouteAppearance;
  localId: string | null;
  serverId: string | null;
  sport: 'run' | 'walk';
  intent: WorkoutIntent | null;
  startedAtUtc: number;
  endedAtUtc: number | null;
  /** session 保存的當地時區；缺 → null（用裝置時區顯示） */
  timeZone: string | null;
  distanceMm: number | null;
  elapsedMs: number | null;
  movingMs: number | null;
  avgPaceSPerKm: number | null;
  avgSpeedKmh: number | null;
  steps: number | null;
  activeKcalMkcal: number | null;
  source: ActivitySource;
  status: ActivityStatus;
  needsReview: boolean;
  shoe: { level: 1 | 2 | 3 | 4 | 5; shoeId: string } | null;
  /** 分段／圈數（本機摘要或伺服器 extras）；沒有就 null */
  splits: { distanceMm: number; durationMs: number; paceSPerKm: number | null; isPartial: boolean }[] | null;
  laps: number | null;
  pbEligible: boolean | null;
  reviewReasons: string[];
};

const num = (s: string | null | undefined) => (s === null || s === undefined ? null : Number(s));

export function itemFromLocal(m: SessionMeta, entry: OutboxEntry | null): ActivityItem | null {
  if (!m.summary || (m.status !== 'saved' && m.status !== 'needs_review')) return null;
  const s = m.summary;
  const status: ActivityStatus = m.deletedAt ? 'delete_pending'
    : entry?.status === 'excluded' ? 'excluded'
    : m.syncedSessionId ? (m.status === 'needs_review' ? 'needs_review' : 'synced')
    : entry && (entry.status === 'blocked' || entry.status === 'retry_wait') ? 'sync_failed'
    : entry ? 'queued'
    : 'local';
  return {
    routeAppearance: routeAppearanceOf(m.routeAppearance),
    id: m.syncedSessionId ?? m.sessionId, localId: m.sessionId, serverId: m.syncedSessionId ?? null,
    sport: m.sport, intent: m.intent ?? (m.sport === 'run' ? 'run' : null),
    startedAtUtc: m.startedAtUtc, endedAtUtc: m.endedAtUtc, timeZone: m.recordedTimeZone ?? null,
    distanceMm: s.distanceMm, elapsedMs: s.elapsedMs, movingMs: s.movingMs,
    avgPaceSPerKm: s.movingAvgPaceSPerKm ?? s.avgPaceSPerKm, avgSpeedKmh: s.movingAvgSpeedKmh ?? s.avgSpeedKmh,
    steps: null, activeKcalMkcal: null,
    source: 'device_gps', status, needsReview: m.status === 'needs_review',
    shoe: m.shoeSnapshot ? { level: m.shoeSnapshot.level, shoeId: m.shoeSnapshot.shoeId } : null,
    splits: s.splits.map((l) => ({ distanceMm: l.distanceMm, durationMs: l.durationMs, paceSPerKm: l.paceSPerKm, isPartial: l.isPartial })),
    laps: s.laps.length, pbEligible: null, reviewReasons: [],
  };
}

export function itemFromRemote(w: WorkoutSummary): ActivityItem {
  const extras = (w.extras ?? {}) as { splits?: { distanceMm: number; durationMs: number; paceSPerKm: number | null; isPartial: boolean }[]; laps?: unknown[]; recorded_time_zone?: string; moving_ms?: number; shoe?: { level: 1 | 2 | 3 | 4 | 5; shoeId: string } };
  return {
    routeAppearance: routeAppearanceOf(w.extras?.route_appearance),
    id: w.session_id, localId: null, serverId: w.session_id,
    sport: w.sport, intent: w.intent ?? (w.sport === 'run' ? 'run' : null),
    startedAtUtc: Date.parse(w.started_at), endedAtUtc: Date.parse(w.ended_at), timeZone: extras.recorded_time_zone ?? null,
    distanceMm: num(w.metrics.distance?.value_mm), elapsedMs: num(w.elapsed_ms), movingMs: typeof extras.moving_ms === 'number' ? extras.moving_ms : null,
    avgPaceSPerKm: w.metrics.avg_pace_s_per_km, avgSpeedKmh: w.metrics.avg_speed_kmh,
    steps: w.metrics.steps, activeKcalMkcal: num(w.metrics.active_energy?.value_mkcal),
    source: w.source.origin === 'gps' ? 'device_gps' : w.source.origin === 'manual' ? 'manual' : 'imported',
    status: w.status === 'needs_review' ? 'needs_review' : 'server_only', needsReview: w.status === 'needs_review',
    shoe: extras.shoe ?? null,
    splits: Array.isArray(extras.splits) ? extras.splits.map((l) => ({ distanceMm: l.distanceMm, durationMs: l.durationMs, paceSPerKm: l.paceSPerKm ?? null, isPartial: !!l.isPartial })) : null,
    laps: Array.isArray(extras.laps) ? extras.laps.length : null, pbEligible: w.pb_eligible, reviewReasons: w.review_reasons ?? [],
  };
}

/** 合併：本機（含佇列狀態）＋伺服器；已同步的同一筆只留一列（本機為詳情來源、狀態取伺服器審查結果） */
export function mergeActivity(local: SessionMeta[], remote: WorkoutSummary[], entries: OutboxEntry[]): ActivityItem[] {
  const byEntry = new Map(entries.map((e) => [e.meta.sessionId, e]));
  const remoteById = new Map(remote.filter((w) => w.status !== 'deleted' && w.status !== 'invalid').map((w) => [w.session_id, w]));
  const out: ActivityItem[] = [];
  const seen = new Set<string>();
  for (const m of local) {
    const item = itemFromLocal(m, byEntry.get(m.sessionId) ?? null);
    if (!item) continue;
    const r = m.syncedSessionId ? remoteById.get(m.syncedSessionId) : undefined;
    if (r) {
      remoteById.delete(m.syncedSessionId!);
      if (r.status === 'needs_review') { item.status = item.status === 'delete_pending' ? item.status : 'needs_review'; item.needsReview = true; }
      item.pbEligible = r.pb_eligible;
      item.reviewReasons = r.review_reasons ?? [];
      item.steps = r.metrics.steps;
      item.activeKcalMkcal = num(r.metrics.active_energy?.value_mkcal);
    }
    // 伺服器上的同一筆也可能以我們的 external_record_id 出現（例如本機 syncedSessionId 遺失）
    for (const [id, w] of remoteById) if (w.source.origin === 'gps' && w.source.external_record_id === m.sessionId) { remoteById.delete(id); item.serverId = id; if (item.status === 'local' || item.status === 'queued') item.status = 'synced'; }
    if (!seen.has(item.id)) { seen.add(item.id); out.push(item); }
  }
  for (const w of remoteById.values()) { const item = itemFromRemote(w); if (!seen.has(item.id)) { seen.add(item.id); out.push(item); } }
  return out;
}

/** 依 session 時區的日曆日（YYYY-MM-DD）；時區無效或缺 → 裝置時區 */
export function calendarDay(utcMs: number, timeZone: string | null): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone ?? undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(utcMs));
  } catch {
    const d = new Date(utcMs);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}
export const monthOf = (day: string) => day.slice(0, 7);
export const dayOfItem = (it: ActivityItem) => calendarDay(it.startedAtUtc, it.timeZone);

export type ActivityFilter = { mode?: 'all' | 'run' | 'brisk' | 'walk'; source?: 'all' | ActivitySource; status?: 'all' | 'local' | 'synced' | 'review' | 'failed'; day?: string | null };
export function filterActivity(items: ActivityItem[], f: ActivityFilter): ActivityItem[] {
  return items.filter((it) => {
    if (f.mode && f.mode !== 'all') {
      if (f.mode === 'run' && it.sport !== 'run') return false;
      if (f.mode === 'brisk' && !(it.sport === 'walk' && it.intent === 'brisk')) return false;
      if (f.mode === 'walk' && !(it.sport === 'walk' && it.intent !== 'brisk')) return false;
    }
    if (f.source && f.source !== 'all' && it.source !== f.source) return false;
    if (f.status && f.status !== 'all') {
      const local = it.status === 'local' || it.status === 'queued';
      const synced = it.status === 'synced' || it.status === 'server_only';
      const review = it.needsReview || it.status === 'excluded';
      const failed = it.status === 'sync_failed' || it.status === 'delete_pending';
      if (f.status === 'local' && !local) return false;
      if (f.status === 'synced' && !synced) return false;
      if (f.status === 'review' && !review) return false;
      if (f.status === 'failed' && !failed) return false;
    }
    // Chart selection can be a day, month or year; use calendar boundaries.
    if (f.day && !(dayOfItem(it) === f.day || dayOfItem(it).startsWith(`${f.day}-`))) return false;
    return true;
  });
}

/** 穩定排序：開始時間 → id；預設由舊到新（同步順序），可選由新到舊 */
export function sortActivity(items: ActivityItem[], order: 'asc' | 'desc'): ActivityItem[] {
  const cmp = (a: ActivityItem, b: ActivityItem) => a.startedAtUtc - b.startedAtUtc || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return [...items].sort((a, b) => (order === 'asc' ? cmp(a, b) : cmp(b, a)));
}

/** 月總覽：只計有效（非待審、非排除、非刪除中）且去重後的紀錄；待審／排除另列筆數 */
export function monthSummary(items: ActivityItem[], month: string) {
  const inMonth = items.filter((it) => monthOf(dayOfItem(it)) === month);
  const counted = inMonth.filter((it) => !it.needsReview && it.status !== 'excluded' && it.status !== 'delete_pending');
  return {
    count: counted.length,
    distanceMm: counted.reduce((a, it) => a + (it.distanceMm ?? 0), 0),
    hasDistance: counted.some((it) => it.distanceMm !== null),
    elapsedMs: counted.reduce((a, it) => a + (it.elapsedMs ?? 0), 0),
    excluded: inMonth.length - counted.length,
    byDay: inMonth.reduce<Record<string, { count: number; distanceMm: number }>>((acc, it) => { const d = dayOfItem(it); acc[d] = { count: (acc[d]?.count ?? 0) + 1, distanceMm: (acc[d]?.distanceMm ?? 0) + (it.distanceMm ?? 0) }; return acc; }, {}),
  };
}

/** 月曆格：該月每一天（依 ISO 週一起算補前置空格）；month＝YYYY-MM */
export function calendarGrid(month: string): (string | null)[] {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // 週一＝0
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d++) cells.push(`${month}-${String(d).padStart(2, '0')}`);
  while (cells.length % 7) cells.push(null);
  return cells;
}
export const shiftMonth = (month: string, delta: number) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
/** [from,to) 該月（UTC 邊界放寬前後一天，涵蓋時區差；細分再由 calendarDay 決定） */
export const monthRangeUtc = (month: string) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return { from: new Date(Date.UTC(y, m - 1, 1) - 86_400_000).toISOString(), to: new Date(Date.UTC(y, m, 1) + 86_400_000).toISOString() };
};

// ---- PG-LINK-06：儀表板（週／月／年／全部）----

export type ActivityPeriod = 'week' | 'month' | 'year' | 'all';
const pad2 = (n: number) => String(n).padStart(2, '0');
const localDay = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const addDays = (day: string, n: number) => { const [y, m, d] = day.split('-').map(Number) as [number, number, number]; const x = new Date(Date.UTC(y, m - 1, d + n)); return `${x.getUTCFullYear()}-${pad2(x.getUTCMonth() + 1)}-${pad2(x.getUTCDate())}`; };
const mondayOf = (day: string) => { const [y, m, d] = day.split('-').map(Number) as [number, number, number]; const wd = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; return addDays(day, -wd); };

/** 目前期間的錨點（裝置時區）：week → 該週週一 YYYY-MM-DD；month → YYYY-MM；year → YYYY；all → '' */
export function periodAnchorNow(kind: ActivityPeriod, now = new Date()): string {
  const day = localDay(now);
  return kind === 'week' ? mondayOf(day) : kind === 'month' ? day.slice(0, 7) : kind === 'year' ? day.slice(0, 4) : '';
}
export function shiftPeriod(kind: ActivityPeriod, anchor: string, delta: number): string {
  if (kind === 'week') return addDays(anchor, 7 * delta);
  if (kind === 'month') return shiftMonth(anchor, delta);
  if (kind === 'year') return String(Number(anchor) + delta);
  return anchor;
}
/** 期間涵蓋的日曆日 [from, to)（字串比較即可）；all → 無界 */
export function periodDays(kind: ActivityPeriod, anchor: string): { from: string | null; to: string | null } {
  if (kind === 'week') return { from: anchor, to: addDays(anchor, 7) };
  if (kind === 'month') return { from: `${anchor}-01`, to: `${shiftMonth(anchor, 1)}-01` };
  if (kind === 'year') return { from: `${anchor}-01-01`, to: `${Number(anchor) + 1}-01-01` };
  return { from: null, to: null };
}
/** 伺服器查詢用 UTC 範圍（前後放寬一天涵蓋時區差；細分再由 calendarDay 決定）；all → 不帶範圍（伺服器保留期內全部） */
export function periodRangeUtc(kind: ActivityPeriod, anchor: string): { from?: string; to?: string } {
  const { from, to } = periodDays(kind, anchor);
  if (!from || !to) return {};
  return { from: new Date(Date.parse(`${addDays(from, -1)}T00:00:00Z`)).toISOString(), to: new Date(Date.parse(`${addDays(to, 1)}T00:00:00Z`)).toISOString() };
}
export function inPeriod(it: ActivityItem, kind: ActivityPeriod, anchor: string): boolean {
  const { from, to } = periodDays(kind, anchor);
  const day = dayOfItem(it);
  return (!from || day >= from) && (!to || day < to);
}

export type ActivityBucket = { key: string; label: string; count: number; distanceMm: number; elapsedMs: number; isToday: boolean };
/**
 * 期間總覽：只計有效（非待審、非排除、非刪除中）且去重後的紀錄；待審／排除另列筆數。
 * 平均配速＝總經過時間／總距離（跑步 s/km），平均速度＝總距離／總經過時間（km/h）；沒有距離 → null。
 * 長條分桶：週＝7 天（key YYYY-MM-DD，label 週幾鍵 Mo…Su）、月＝每天（label 日）、年＝12 個月（label 月）、全部＝最早紀錄年至今年（label 年）。
 */
export function periodSummary(items: ActivityItem[], kind: ActivityPeriod, anchor: string, now = new Date()) {
  const inRange = items.filter((it) => inPeriod(it, kind, anchor));
  const counted = inRange.filter((it) => !it.needsReview && it.status !== 'excluded' && it.status !== 'delete_pending');
  const distanceMm = counted.reduce((a, it) => a + (it.distanceMm ?? 0), 0);
  const elapsedMs = counted.reduce((a, it) => a + (it.elapsedMs ?? 0), 0);
  const timed = counted.filter((it) => it.distanceMm !== null && it.distanceMm > 0 && it.elapsedMs !== null && it.elapsedMs > 0);
  const timedDistanceMm = timed.reduce((sum, it) => sum + it.distanceMm!, 0);
  const timedElapsedMs = timed.reduce((sum, it) => sum + it.elapsedMs!, 0);
  const today = localDay(now);
  const bucketKey = (day: string) => (kind === 'week' || kind === 'month' ? day : kind === 'year' ? day.slice(0, 7) : day.slice(0, 4));
  const keys: { key: string; label: string }[] = [];
  if (kind === 'week') for (let i = 0; i < 7; i++) { const d = addDays(anchor, i); keys.push({ key: d, label: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'][i]! }); }
  if (kind === 'month') for (const d of calendarGrid(anchor)) if (d) keys.push({ key: d, label: String(Number(d.slice(8))) });
  if (kind === 'year') for (let m = 1; m <= 12; m++) keys.push({ key: `${anchor}-${pad2(m)}`, label: String(m) });
  if (kind === 'all') {
    const years = counted.map((it) => Number(dayOfItem(it).slice(0, 4)));
    const first = years.length ? Math.min(...years) : now.getFullYear();
    for (let y = first; y <= now.getFullYear(); y++) keys.push({ key: String(y), label: String(y) });
  }
  const agg = counted.reduce<Record<string, { count: number; distanceMm: number; elapsedMs: number }>>((acc, it) => {
    const k = bucketKey(dayOfItem(it));
    acc[k] = { count: (acc[k]?.count ?? 0) + 1, distanceMm: (acc[k]?.distanceMm ?? 0) + (it.distanceMm ?? 0), elapsedMs: (acc[k]?.elapsedMs ?? 0) + (it.elapsedMs ?? 0) };
    return acc;
  }, {});
  const buckets: ActivityBucket[] = keys.map((k) => ({ ...k, count: agg[k.key]?.count ?? 0, distanceMm: agg[k.key]?.distanceMm ?? 0, elapsedMs: agg[k.key]?.elapsedMs ?? 0, isToday: k.key === bucketKey(today) }));
  const active = buckets.filter((b) => b.count > 0);
  return {
    count: counted.length,
    distanceMm,
    hasDistance: counted.some((it) => it.distanceMm !== null),
    elapsedMs,
    hasTime: counted.some((it) => it.elapsedMs !== null),
    avgPaceSPerKm: timedDistanceMm > 0 ? Math.round(timedElapsedMs / 1000 / (timedDistanceMm / 1_000_000)) : null,
    avgSpeedKmh: timedElapsedMs > 0 ? timedDistanceMm / 1_000_000 / (timedElapsedMs / 3_600_000) : null,
    excluded: inRange.length - counted.length,
    buckets,
    /** 有紀錄的桶平均距離（虛線） */
    avgBucketMm: active.length ? active.reduce((a, b) => a + b.distanceMm, 0) / active.length : 0,
  };
}

/** 自動命名的時段（依 session 時區的開始小時） */
export type TimeOfDay = 'early' | 'morning' | 'midday' | 'afternoon' | 'evening' | 'night';
export function timeOfDay(utcMs: number, timeZone: string | null): TimeOfDay {
  let h: number;
  try { h = Number(new Intl.DateTimeFormat('en-US', { timeZone: timeZone ?? undefined, hour: 'numeric', hour12: false }).format(new Date(utcMs))) % 24; } catch { h = new Date(utcMs).getHours(); }
  return h < 5 ? 'early' : h < 11 ? 'morning' : h < 14 ? 'midday' : h < 17 ? 'afternoon' : h < 20 ? 'evening' : 'night';
}
