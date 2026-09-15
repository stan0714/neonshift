/** PG-U-03：模式篩選（走路＋健走合看）、週回顧（本地週一界、同日多筆算一天、不含 deleted）、同類比較（不足 3 筆不比、正＝更快）、分享文字（預設無日期／配速、永不含錢包／座標）。 */
import { compareSameCategory, dateKey, localWeekStart, matchesMode, shareText, weeklyReview } from '@/domain/review';
import type { WorkoutSummary } from '@/services/api/ApiClient';

const w = (o: Partial<WorkoutSummary> & { started_at: string }): WorkoutSummary => ({ session_id: `s-${o.started_at}`, sport: 'run', environment: 'outdoor', source: { origin: 'gps', source_id: 'app', external_record_id: 'x', source_revision: 1 }, ended_at: o.started_at, elapsed_ms: '1500000', paused_ms: '0', status: 'saved', quality: 'complete', rules_version: 1, review_reasons: [], possible_duplicate_of: null, metrics: { distance: { value_mm: '5000000', method: 'gps' }, steps: null, active_energy: null, total_energy: null, avg_pace_s_per_km: 300, avg_speed_kmh: 12, step_length_mm: null }, pb_eligible: true, extras: {}, revision: 1, imported_at: '', updated_at: '', ...o });

test('matchesMode：walking 含走路與健走；running 只跑步', () => {
  expect(matchesMode({ sport: 'walk' }, 'walking')).toBe(true);
  expect(matchesMode({ sport: 'run' }, 'walking')).toBe(false);
  expect(matchesMode({ sport: 'walk' }, 'all')).toBe(true);
});

test('localWeekStart：週一 00:00 本地；週日歸前一週', () => {
  expect(dateKey(localWeekStart(new Date(2026, 8, 14, 15)))).toBe('2026-09-14'); // 週一
  expect(dateKey(localWeekStart(new Date(2026, 8, 20, 9)))).toBe('2026-09-14'); // 週日 → 同週
  expect(dateKey(localWeekStart(new Date(2026, 8, 21, 0, 30)))).toBe('2026-09-21');
});

test('weeklyReview：同日兩筆算一個活躍日；deleted 不計；依週降冪；走路篩選', () => {
  const items = [
    w({ started_at: new Date(2026, 8, 14, 7).toISOString() }),
    w({ started_at: new Date(2026, 8, 14, 18).toISOString(), sport: 'walk', metrics: { distance: { value_mm: '2000000', method: 'gps' }, steps: null, active_energy: null, total_energy: null, avg_pace_s_per_km: null, avg_speed_kmh: 5, step_length_mm: null } }),
    w({ started_at: new Date(2026, 8, 16, 7).toISOString(), status: 'deleted' }),
    w({ started_at: new Date(2026, 8, 8, 7).toISOString() }),
  ];
  const r = weeklyReview(items);
  expect(r.map((x) => [x.weekStart, x.sessions, x.activeDays, x.distanceMm.toString(), x.byMode])).toEqual([
    ['2026-09-14', 2, 1, '7000000', { walking: 1, running: 1 }],
    ['2026-09-07', 1, 1, '5000000', { walking: 0, running: 1 }],
  ]);
  expect(weeklyReview(items, 'walking')).toHaveLength(1);
});

test('compareSameCategory：不足 3 筆 → null；只比同 sport／環境／來源等級；配速差正＝更快', () => {
  const target = w({ started_at: '2026-09-20T00:00:00Z', session_id: 't', metrics: { distance: { value_mm: '6000000', method: 'gps' }, steps: null, active_energy: null, total_energy: null, avg_pace_s_per_km: 270, avg_speed_kmh: 13.3, step_length_mm: null } });
  const peers = [w({ started_at: '2026-09-01T00:00:00Z' }), w({ started_at: '2026-09-02T00:00:00Z' })];
  expect(compareSameCategory(target, [target, ...peers])).toBeNull();
  const c = compareSameCategory(target, [target, ...peers, w({ started_at: '2026-09-03T00:00:00Z' }), w({ started_at: '2026-09-04T00:00:00Z', environment: 'indoor' }), w({ started_at: '2026-09-05T00:00:00Z', sport: 'walk' }), w({ started_at: '2026-09-06T00:00:00Z', source: { origin: 'organizer', source_id: 'e', external_record_id: 'r', source_revision: 1 } })])!;
  expect([c.count, c.avgPaceSPerKm, c.avgDistanceMm.toString(), c.paceDeltaPct, c.distanceDeltaPct]).toEqual([3, 300, '5000000', 10, 20]);
});

test('shareText：預設不含日期／配速；勾選後加入；含模式標籤與 #NeonShift；不含錢包或座標', () => {
  const t = w({ started_at: '2026-09-20T06:30:00Z', intent: 'run' });
  expect(shareText(t, { date: false, pace: false, mode: true }, { mode: 'Run', app: 'NeonShift' })).toBe('Run · 5.00 km · 25:00 · #NeonShift');
  const full = shareText(t, { date: true, pace: true, mode: false }, { mode: 'Run', app: 'NeonShift' });
  expect(full).toMatch(/^5\.00 km · 25:00 · 5:00 \/km · 2026-09-\d{2} · #NeonShift$/);
  expect(full).not.toMatch(/06:30|lat|lon/);
});
