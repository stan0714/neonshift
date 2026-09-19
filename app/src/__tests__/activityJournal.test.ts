/** PG-LINK-04：Activity 純函式——合併去重、時區日曆日（跨午夜歸開始日）、篩選、穩定排序、月總覽只計有效、月曆格。 */
import { calendarDay, calendarGrid, filterActivity, itemFromRemote, mergeActivity, monthRangeUtc, monthSummary, shiftMonth, sortActivity } from '@/domain/activity';
import type { WorkoutSummary } from '@/services/api/ApiClient';
import type { SessionMeta } from '@/services/workouts/LocalWorkoutStore';
import type { OutboxEntry } from '@/services/workouts/WorkoutOutbox';

const local = (id: string, startedAtUtc: number, o: Partial<SessionMeta> = {}): SessionMeta => ({ sessionId: id, sport: 'run', intent: 'run', goal: null, environment: 'outdoor', autoLapMm: null, splitLengthMm: 1_000_000, status: 'saved', startedAtUtc, startedMonoMs: 0, processId: 'p', pauses: [], manualLapsAtMs: [], lastSeq: 0, acceptedCount: 1, interrupted: false, endedAtUtc: startedAtUtc + 1_800_000, syncedSessionId: null, updatedAt: 0, owner: 'A', recordedTimeZone: 'Asia/Taipei', summary: { distanceMm: 5_000_000, elapsedMs: 1_800_000, movingMs: 1_700_000, movingAvgPaceSPerKm: 340, avgPaceSPerKm: 360, movingAvgSpeedKmh: null, avgSpeedKmh: null, splits: [], laps: [] } as never, ...o });
const remote = (id: string, startedAt: string, o: Partial<WorkoutSummary> = {}): WorkoutSummary => ({ session_id: id, sport: 'walk', environment: 'unknown', intent: 'brisk', goal: null, source: { origin: 'health_connect' as never, source_id: 'hc', external_record_id: `x-${id}`, source_revision: 1 }, started_at: startedAt, ended_at: new Date(Date.parse(startedAt) + 1_500_000).toISOString(), elapsed_ms: '1500000', paused_ms: '0', status: 'saved', quality: 'complete' as never, rules_version: 1, review_reasons: [], possible_duplicate_of: null, metrics: { distance: { value_mm: '2400000', method: 'device' }, steps: 3000, active_energy: null, total_energy: null, avg_pace_s_per_km: null, avg_speed_kmh: 5.76, step_length_mm: null }, pb_eligible: false, extras: {}, revision: 1, imported_at: startedAt, updated_at: startedAt, ...o });
const entry = (meta: SessionMeta, status: OutboxEntry['status']): OutboxEntry => ({ meta, op: 'upload', status, attempt: 0, nextAttemptAt: null, lastError: null, revision: 1 });

test('日曆日依 session 時區：台北 09/18 07:10 開跑（UTC 09/17 23:10）歸 09/18；伺服器紀錄缺時區 → 裝置時區；[from,to) 月份範圍含前後一天緩衝', () => {
  const utc = Date.UTC(2026, 8, 17, 23, 10);
  expect(calendarDay(utc, 'Asia/Taipei')).toBe('2026-09-18');
  expect(calendarDay(utc, 'UTC')).toBe('2026-09-17');
  expect(calendarDay(utc, 'Not/AZone')).toMatch(/^2026-09-1[78]$/);
  expect(monthRangeUtc('2026-09')).toEqual({ from: '2026-08-31T00:00:00.000Z', to: '2026-10-02T00:00:00.000Z' });
  expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  const grid = calendarGrid('2026-09'); // 2026-09-01 是週二 → 前置 1 格
  expect(grid[0]).toBeNull();
  expect(grid[1]).toBe('2026-09-01');
  expect(grid.length % 7).toBe(0);
  expect(grid.filter(Boolean)).toHaveLength(30);
});

test('合併去重：已同步的本機紀錄與伺服器同一筆只留一列（本機為詳情、伺服器審查結果覆蓋）；純本機／純伺服器各自保留；invalid／deleted 不列；佇列狀態映射', () => {
  const l17 = local('l17', Date.UTC(2026, 8, 17, 1));
  const l18 = local('l18', Date.UTC(2026, 8, 18, 1), { syncedSessionId: 'srv-18' });
  const l19 = local('l19', Date.UTC(2026, 8, 19, 1), { deletedAt: 1, syncedSessionId: 'srv-19' });
  const items = mergeActivity([l17, l18, l19], [remote('srv-18', '2026-09-18T01:00:00Z', { sport: 'run', intent: 'run', status: 'needs_review', review_reasons: ['gps_gap'], pb_eligible: false }), remote('srv-19', '2026-09-19T01:00:00Z'), remote('srv-x', '2026-09-20T01:00:00Z'), remote('srv-bad', '2026-09-21T01:00:00Z', { status: 'invalid' })], [entry(l17, 'blocked')]);
  expect(items.map((it) => [it.id, it.localId, it.status])).toEqual([
    ['l17', 'l17', 'sync_failed'],
    ['srv-18', 'l18', 'needs_review'],
    ['srv-19', 'l19', 'delete_pending'],
    ['srv-x', null, 'server_only'],
  ]);
  expect(items[1]).toMatchObject({ needsReview: true, reviewReasons: ['gps_gap'], distanceMm: 5_000_000, source: 'device_gps', shoe: null });
  expect(items[3]).toMatchObject({ source: 'imported', sport: 'walk', intent: 'brisk', distanceMm: 2_400_000, steps: 3000, avgSpeedKmh: 5.76 });
  const r = itemFromRemote(remote('srv-e', '2026-09-22T01:00:00Z', { extras: { recorded_time_zone: 'Asia/Tokyo', shoe: { level: 3, shoeId: 'wild-guardians-v1:3' }, splits: [{ distanceMm: 1_000_000, durationMs: 300_000, paceSPerKm: 300, isPartial: false }] } }));
  expect(r).toMatchObject({ timeZone: 'Asia/Tokyo', shoe: { level: 3 }, splits: [{ distanceMm: 1_000_000 }] });
});

test('篩選（模式／來源／狀態／日）、穩定排序（預設由舊到新）、月總覽只計有效且去重（待審／排除另列）', () => {
  const l17 = local('l17', Date.UTC(2026, 8, 17, 1));
  const l18 = local('l18', Date.UTC(2026, 8, 18, 1), { status: 'needs_review', sport: 'walk', intent: 'casual' });
  const items = mergeActivity([l18, l17], [remote('srv-x', '2026-09-20T01:00:00Z'), remote('srv-oct', '2026-10-01T01:00:00Z')], []);
  expect(sortActivity(items, 'asc').map((it) => it.id)).toEqual(['l17', 'l18', 'srv-x', 'srv-oct']);
  expect(sortActivity(items, 'desc').map((it) => it.id)).toEqual(['srv-oct', 'srv-x', 'l18', 'l17']);
  expect(filterActivity(items, { mode: 'run' }).map((it) => it.id)).toEqual(['l18', 'l17'].filter((id) => id === 'l17'));
  expect(filterActivity(items, { mode: 'brisk' }).map((it) => it.id)).toEqual(['srv-x', 'srv-oct']);
  expect(filterActivity(items, { mode: 'walk' }).map((it) => it.id)).toEqual(['l18']);
  expect(filterActivity(items, { source: 'imported' }).map((it) => it.id)).toEqual(['srv-x', 'srv-oct']);
  expect(filterActivity(items, { status: 'local' }).map((it) => it.id)).toEqual(['l18', 'l17']);
  expect(filterActivity(items, { status: 'review' }).map((it) => it.id)).toEqual(['l18']);
  expect(filterActivity(items, { day: '2026-09-17' }).map((it) => it.id)).toEqual(['l17']);
  const s = monthSummary(items, '2026-09');
  expect(s).toMatchObject({ count: 2, distanceMm: 7_400_000, elapsedMs: 3_300_000, excluded: 1 });
  expect(Object.keys(s.byDay).sort()).toEqual(['2026-09-17', '2026-09-18', '2026-09-20']);
  expect(monthSummary(items, '2026-10').count).toBe(1);
});
