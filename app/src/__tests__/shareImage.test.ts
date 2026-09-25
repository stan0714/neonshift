/**
 * 分享圖卡版面（docs/social-share §9.1）。重點不是好看，是「關掉的欄位絕不出現」
 * 與「路線預設不出現、出現時不含座標」這兩條隱私承諾可以被測出來。
 */
import type { RawPoint } from '@/domain/gps/engine';
import { SHARE_CARD_DEFAULT, type ShareCardFields, type ShareCardInput } from '@/domain/review';
import { trimEnds } from '@/domain/gps/trace';
import { achievementShareLayout, routeShapeOf, type AchievementShareInput, SHARE_ROUTE_TRIM_M, sharePublishable, shareUrl, workoutShareLayout } from '@/domain/shareImage';
import { t, useLocaleStore } from '@/i18n';

beforeEach(() => useLocaleStore.setState({ setting: 'en', locale: 'en' }));

const tr = (k: string, p?: Record<string, string | number>) => t(k as never, p);
const labels = { mode: 'Run', tagline: 'Walk or run to grow your shoes.', site: 'neonshift.cc' };
const workout: ShareCardInput = {
  sport: 'run',
  intent: 'run',
  startedAt: new Date('2026-09-24T22:10:00Z'),
  elapsedMs: 2_292_000,
  movingMs: 2_280_000,
  distanceMm: 5_500_000,
  avgPaceSPerKm: 417,
  avgSpeedKmh: 8.6,
  maxSpeed5sKmh: 11.2,
  splits: [
    { index: 1, paceSPerKm: 408, isPartial: false },
    { index: 2, paceSPerKm: 415, isPartial: false },
    { index: 3, paceSPerKm: 422, isPartial: false },
    { index: 4, paceSPerKm: 419, isPartial: false },
    { index: 5, paceSPerKm: 421, isPartial: false },
    { index: 6, paceSPerKm: null, isPartial: true },
  ],
  lapCount: 0,
  goal: { kind: 'distance', target: 5_000_000 },
  goalMet: true,
  qualityAccepted: 1204,
  qualityRejected: 37,
  autoPausedMs: 0,
};
const layoutOf = (fields: Partial<ShareCardFields> = {}, extra: { route?: ReturnType<typeof routeShapeOf> } = {}) =>
  workoutShareLayout(workout, { ...SHARE_CARD_DEFAULT, ...fields }, { t: tr, labels, ...extra });

const M_PER_DEG_LAT = 111_195;
const pt = (seq: number, metresEast: number): RawPoint => ({ seq, monotonicMs: seq * 1000, utcMs: seq * 1000, lat: 25, lon: 121.5 + metresEast / (M_PER_DEG_LAT * Math.cos((25 * Math.PI) / 180)), accuracyM: 5 });
/** 直線東向 line(n, step)：n 個點、每點相隔 step 公尺 */
const line = (n: number, step: number) => Array.from({ length: n }, (_, i) => pt(i, i * step));

describe('運動成績卡（A）', () => {
  test('主數字是距離，只有一個；產品線索與站名一定在', () => {
    const l = layoutOf();
    expect(l.hero).toEqual({ value: '5.50', unit: 'km' });
    expect(l.tagline).toBe(labels.tagline);
    expect(l.site).toBe('neonshift.cc');
    expect(sharePublishable(l)).toBe(true);
  });

  test('關掉配速 → 圖上沒有任何配速或速度', () => {
    const l = layoutOf({ pace: false });
    expect(l.lines.join('|')).not.toMatch(/\/km|km\/h/);
    expect(layoutOf({ pace: true }).lines.join('|')).toMatch(/\/km/);
  });

  test('關掉分段 → 沒有任何小塊；開啟時 partial 不列、最多 8 格', () => {
    expect(layoutOf({ splits: false }).chips).toEqual([]);
    const chips = layoutOf({ splits: true }).chips;
    expect(chips).toEqual(['1k 6:48', '2k 6:55', '3k 7:02', '4k 6:59', '5k 7:01']);
    expect(chips.length).toBeLessThanOrEqual(8);
  });

  test('關掉目標與品質 → 不出現達標與收點數', () => {
    const l = layoutOf({ goal: false, quality: false });
    expect(l.lines.join('|')).not.toMatch(/Goal|kept|rejected/);
    expect(layoutOf({ goal: true, quality: true }).lines.join('|')).toMatch(/Goal 5 km/);
  });

  test('日期預設關閉；勾選後只到月份，不含日與精確開始時間', () => {
    expect(layoutOf().notice).toBeNull();
    expect(layoutOf({ date: true }).notice).toBe('2026-09');
    expect(layoutOf({ date: true }).notice).not.toMatch(/22:10|-24/);
  });

  test('關掉模式 → 標籤退回一般字樣，不洩漏是跑還是走', () => {
    expect(layoutOf({ mode: true }).label).toBe('Run');
    expect(layoutOf({ mode: false }).label).toBe(t('share.workout'));
  });

  test('路線預設不出現（型別上也拿不到座標）', () => {
    expect(layoutOf().route).toBeNull();
    const shape = routeShapeOf(line(101, 10));
    const l = layoutOf({}, { route: shape });
    expect(l.route).not.toBeNull();
    const all = l.route!.segments.flat();
    expect(all.length).toBeGreaterThan(10);
    for (const p of all) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
      expect(Object.keys(p).sort()).toEqual(['x', 'y']); // 沒有 lat／lon／時間搭車混進來
    }
  });
});

describe('路線形狀裁切', () => {
  test('起終點各裁 150 m', () => {
    const kept = trimEnds(line(101, 10), SHARE_ROUTE_TRIM_M);
    expect(kept[0]!.seq).toBe(15);
    expect(kept[kept.length - 1]!.seq).toBe(85);
  });

  test('總長不足 3 倍裁切量 → 不給任何點（寧可沒有形狀）', () => {
    expect(trimEnds(line(41, 10), SHARE_ROUTE_TRIM_M)).toEqual([]);
    expect(routeShapeOf(line(41, 10))).toBeNull();
  });

  test('裁完點數過少 → null', () => {
    expect(routeShapeOf(line(11, 50))).toBeNull(); // 500 m 只剩 4 點
  });

  test('缺口（> 5 s）讓形狀斷成兩段，不用直線把缺口補起來', () => {
    const pts = line(101, 10).map((p) => (p.seq > 50 ? { ...p, monotonicMs: p.monotonicMs + 60_000 } : p));
    expect(routeShapeOf(pts)!.segments.length).toBe(2);
  });
});

describe('成就收藏卡（B）', () => {
  const base: AchievementShareInput = { category: 'first_5k', title: 'First 5K', series: t('share.card.series'), detail: null, achievedAt: new Date('2026-09-24T22:10:00Z'), verification: 'device', edition: 'No. 12' };
  const mk = (o: Partial<AchievementShareInput> = {}) => achievementShareLayout({ ...base, ...o }, { t: tr, labels: { tagline: labels.tagline, site: labels.site, notice: t('share.card.devnet') } });

  test('鏈上資產必標 DEVNET 與測試代幣', () => {
    expect(mk().notice).toMatch(/DEVNET/);
    expect(mk().notice).toMatch(/No monetary value/);
    expect(sharePublishable(mk())).toBe(true);
  });

  test('缺環境標示一律不可發布', () => {
    expect(sharePublishable({ ...mk(), notice: null })).toBe(false);
  });

  test('未同意公開 → 圖上沒有精確值；同意後才出現', () => {
    expect(mk().lines.join('|')).not.toMatch(/5\.50|38:12/);
    expect(mk({ detail: '5.50 km · 38:12' }).lines.join('|')).toMatch(/5\.50 km/);
  });

  test('日期只到月份；驗證方式如實呈現', () => {
    expect(mk().lines).toContain('2026-09');
    expect(mk().lines).toContain(t('share.card.class.device'));
    expect(mk({ verification: 'organizer' }).lines).toContain(t('share.card.class.organizer'));
  });

  test('成就卡不含路線', () => {
    expect(mk().route).toBeNull();
  });
});

test('分享連結帶 kind 與 source，不含個人識別', () => {
  expect(shareUrl('https://neonshift.cc', 'workout', 'summary')).toBe('https://neonshift.cc/s/workout?source=summary');
});
