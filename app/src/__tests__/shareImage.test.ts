/**
 * 分享圖卡版面（docs/social-share §9.1）。重點不是好看，是「關掉的欄位絕不出現」
 * 與「路線預設不出現、出現時不含座標」這兩條隱私承諾可以被測出來。
 */
import type { RawPoint } from '@/domain/gps/engine';
import { SHARE_CARD_DEFAULT, type ShareCardFields, type ShareCardInput } from '@/domain/review';
import { SHARE_ROUTE, shareRouteShape } from '@/domain/gps/shareRoute';
import { achievementShareLayout, ACHIEVEMENT_SHARE_DEFAULT, routeShapeOf, type AchievementShareFields, type AchievementShareInput, sharePublishable, shareUrl, workoutShareLayout } from '@/domain/shareImage';
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
const layoutOf = (fields: Partial<ShareCardFields> = {}, extra: { route?: ReturnType<typeof routeShapeOf>; status?: 'local' | 'needs_review' | 'synced' } = {}) =>
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

  test('真實狀態如實呈現：未同步標尚未驗證、待審標待審查、同步成功也只說裝置記錄', () => {
    expect(layoutOf().lines[0]).toBe(t('share.card.status.local'));
    expect(layoutOf({}, { status: 'needs_review' }).lines[0]).toBe(t('share.card.status.needs_review'));
    expect(layoutOf({}, { status: 'synced' }).lines[0]).toBe(t('share.card.status.synced'));
    // 任何狀態都不得出現官方認證字樣
    for (const st of ['local', 'needs_review', 'synced'] as const) {
      expect(layoutOf({}, { status: st }).lines.join('|')).not.toMatch(/verified by|official|certified|organizer/i);
    }
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
    const shape = routeShapeOf(line(301, 10)); // 3 km：裁掉兩端各 200 m 後還剩 2.6 km
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

/**
 * PG-SHARE-09 的五道門檻（docs/social-share §9.1「路線第二階段的發布門檻」）。
 * 每一條都要能被測出來——這些規則的目的是「圖不能對回地點」，不是「圖好看」。
 */
describe('路線形狀（PG-SHARE-09）', () => {
  /** 東向直線 3 km：裁掉兩端各 200 m 後剩 2.6 km */
  const straight3k = () => line(301, 10);

  test('門檻 1：按距離裁兩端，不是刪固定點數', () => {
    const r = shareRouteShape(straight3k())!;
    expect(r.keptM).toBe(3000 - SHARE_ROUTE.trimM * 2);
    // 每點 10 m：261 個點剩下來（含兩端邊界點）
    expect(r.segments[0]!.length).toBe(261);
  });

  test('門檻 5：長度不足就沒有形狀，不會為了出圖調小保護距離', () => {
    expect(shareRouteShape(line(101, 10))).toBeNull(); // 1 km：裁完只剩 600 m
    expect(shareRouteShape(line(140, 10))).toBeNull(); // 1.39 km：差 10 m 也不給
    expect(shareRouteShape(line(141, 10))).not.toBeNull(); // 1.4 km：剛好 2×200 ＋ 1000
    expect(routeShapeOf(line(41, 10))).toBeNull();
  });

  test('門檻 2：折返經過起終點保護區的中段一併移除，形狀因此斷開', () => {
    // 東行 3 km 後折返，在 1.5 km 附近結束：**去程**經過終點附近的那一段也要消失。
    // 去程與回程刻意錯開 5 m，兩條腿沒有任何一點重合——這樣 zoneM: 0 的對照組才真的只有一段。
    const out = Array.from({ length: 151 }, (_, i) => pt(i, 10 + i * 20));
    const back = Array.from({ length: 75 }, (_, i) => pt(151 + i, 2985 - i * 20));
    const course = [...out, ...back];
    const withZone = shareRouteShape(course)!;
    // 去程在終點（1.5 km）附近被切掉 → 去程斷成兩段
    expect(withZone.segments.length).toBe(2);
    // 關掉保護區就只有一段——證明斷開是這條規則造成的，不是缺口或裁切
    expect(shareRouteShape(course, { zoneM: 0 })!.segments.length).toBe(1);
    expect(withZone.keptM).toBeLessThan(shareRouteShape(course, { zoneM: 0 })!.keptM);
  });

  test('門檻 3：缺口（> 5 s）與裁掉的區段都不用直線補起來', () => {
    const pts = straight3k().map((p) => (p.seq > 150 ? { ...p, monotonicMs: p.monotonicMs + 60_000 } : p));
    expect(shareRouteShape(pts)!.segments.length).toBe(2);
  });

  test('門檻 3：剩不到 minSegPoints 點的段整段丟掉，不硬畫兩點一條線', () => {
    // 每點 800 m：裁完只剩 3 點
    expect(shareRouteShape(line(5, 800))).toBeNull();
    expect(SHARE_ROUTE.minSegPoints).toBeGreaterThan(2);
  });

  test('門檻 4：正規化只看留下來的點（裁掉的頭尾不影響比例與位置）', () => {
    const all = shareRouteShape(straight3k())!.segments.flat();
    const xs = all.map((p) => p.x);
    // 留下來的點自己撐滿 0–1；若 bbox 還含被裁掉的段，兩端就到不了 0 與 1
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(1);
    for (const p of all) {
      expect(p.y).toBe(0.5); // 直線置中
      expect(Object.keys(p).sort()).toEqual(['x', 'y']); // 沒有 lat／lon／時間搭車混進來
    }
  });

  test('精度超過引擎門檻的點不進形狀（離譜的點會把 bbox 撐大）', () => {
    const pts = straight3k();
    const withWild = [...pts, { ...pt(999, 50_000), accuracyM: 400 }];
    expect(shareRouteShape(withWild)!.segments.flat()).toEqual(shareRouteShape(pts)!.segments.flat());
  });

  test('版面資料只拿得到形狀，拿不到剩餘長度（圖卡不需要也不該知道）', () => {
    const shape = routeShapeOf(straight3k())!;
    expect(Object.keys(shape)).toEqual(['segments']);
  });
});

describe('成就收藏卡（B）', () => {
  const base: AchievementShareInput = { category: 'first_5k', title: 'First 5K', series: t('share.card.series'), detail: null, achievedAt: new Date('2026-09-24T22:10:00Z'), verification: 'device', edition: 'No. 12' };
  const mk = (o: Partial<AchievementShareInput> = {}, f: Partial<AchievementShareFields> = {}) =>
    achievementShareLayout({ ...base, ...o }, { ...ACHIEVEMENT_SHARE_DEFAULT, ...f }, { t: tr, labels: { tagline: labels.tagline, site: labels.site, notice: t('share.card.net.devnet') } });

  test('鏈上資產必標所屬網路；devnet 資產標 DEVNET 且說明無金錢價值', () => {
    expect(mk().notice).toMatch(/DEVNET/);
    expect(mk().notice).toMatch(/No monetary value/);
    expect(sharePublishable(mk())).toBe(true);
  });

  test('缺環境標示一律不可發布', () => {
    expect(sharePublishable({ ...mk(), notice: null })).toBe(false);
  });

  test('精確值預設不出現（NFT 已公開也不自動勾選）；本次分享另外勾選才進圖', () => {
    expect(mk({ detail: '5.50 km · 38:12' }).lines.join('|')).not.toMatch(/5\.50/);
    expect(mk({ detail: '5.50 km · 38:12' }, { detail: true }).lines.join('|')).toMatch(/5\.50 km/);
  });

  test('日期預設關閉；勾選後只到月份，不含日', () => {
    expect(mk().lines.join('|')).not.toMatch(/2026/);
    expect(mk({}, { date: true }).lines).toContain('2026-09');
    expect(mk({}, { date: true }).lines.join('|')).not.toMatch(/-24/);
  });

  test('驗證方式如實呈現，不因分享而升格', () => {
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
