import type { RawPoint } from '@/domain/gps/engine';
import { GPS_QUALITY } from '@/domain/gps/thresholds';

/**
 * 分享用的路線形狀（PG-SHARE-09；docs/social-share §5.2 與 §9.1 的「路線第二階段發布門檻」）。
 *
 * 這個模組只做一件事：把本機的原始定位點，變成一組**不能對回地點**的相對形狀。
 * §9.1 列的五條門檻各自對應下面一段程式，而不是靠「裁掉前後幾個點」帶過：
 *
 *   1. **按距離裁，不按點數裁。** 慢走與快跑的每點間距差好幾倍，刪固定點數等於刪不定長度。
 *   2. **全程再次進入起終點保護區的點一併移除。** 折返、繞圈、住家附近起跑的路線，
 *      中段會再次經過出發點——只裁頭尾的話，家門口還是會留在圖的中間。
 *   3. **裁掉的區段不補連線。** 被移除的點會把折線切斷；GPS 缺口也切斷。
 *      用直線把缺口接起來等於畫一條沒跑過的路，而且那條線會指向被裁掉的起點。
 *   4. **裁完後才正規化。** 比例與位置只看留下來的點，否則畫面上的留白會透露被裁掉多長。
 *   5. **長度不夠就不給形狀，不調小保護距離來湊。** 一段 300 m 的軌跡配上街道圖很容易對回去。
 *
 * 這裡的公尺數是**本專案的取值，不是匿名保證**（§9.1 最後一句）：折返與繞圈案例、
 * 以及「足夠剩餘長度」的實際效果仍待實機驗收；驗收前 App 不露出這個開關。
 */
export const SHARE_ROUTE = {
  /** 起點與終點各裁掉的距離（§9.1 建議先評估兩端各 200 m） */
  trimM: 200,
  /** 起終點保護區半徑：**全程**任何再次靠近到這個距離內的點都移除 */
  zoneM: 200,
  /** 裁切後仍需的有效長度；不足就不給形狀 */
  minKeptM: 1000,
  /** 一段至少要這麼多點才畫得出形狀；不足的段整段丟掉，不硬畫兩點一條線 */
  minSegPoints: 4,
  /** 連續兩點超過這個間隔視為 GPS 缺口，折線斷開 */
  maxGapMs: 5000,
} as const;

/** 覆寫用的型別：把 `as const` 的字面值放寬成 number，測試與未來的調校才能傳別的值 */
export type ShareRouteConfig = { -readonly [K in keyof typeof SHARE_ROUTE]: number };
export type ShareRouteSegment = { x: number; y: number }[];
/** `keptM` 只供本機判斷與測試，**不進圖卡版面**（§4.6：來源資訊不寫進圖檔） */
export type ShareRouteResult = { segments: ShareRouteSegment[]; keptM: number };

const R_M = 6_371_008.8;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

export function shareRouteShape(points: RawPoint[], opts: Partial<ShareRouteConfig> = {}): ShareRouteResult | null {
  const c = { ...SHARE_ROUTE, ...opts };
  // 精度門檻與引擎的接受條件一致：離譜的點會把形狀拉歪，也會把 bbox 撐大
  const usable = points
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && p.accuracyM <= GPS_QUALITY.acceptMaxAccuracyM)
    .sort((a, b) => a.seq - b.seq);
  if (usable.length < 2) return null;

  const lat0 = usable.reduce((a, p) => a + p.lat, 0) / usable.length;
  const cos = Math.cos((lat0 * Math.PI) / 180);
  const m = usable.map((p) => ({ x: ((p.lon * Math.PI) / 180) * R_M * cos, y: -((p.lat * Math.PI) / 180) * R_M }));

  const cum = [0];
  for (let i = 1; i < m.length; i++) cum.push(cum[i - 1]! + dist(m[i - 1]!, m[i]!));
  const total = cum[cum.length - 1]!;
  // 門檻 1／5：兩端各裁 trimM 之後還要剩 minKeptM，否則直接沒有形狀
  if (total < c.trimM * 2 + c.minKeptM) return null;

  const origin = m[0]!;
  const finish = m[m.length - 1]!;
  // 門檻 1／2：距離裁切 ＋ 全程避開起終點保護區
  const keep = m.map((q, i) => cum[i]! >= c.trimM && cum[i]! <= total - c.trimM && dist(q, origin) > c.zoneM && dist(q, finish) > c.zoneM);

  // 門檻 3：被移除的點與 GPS 缺口都切斷折線，不補連線
  const groups: number[][] = [];
  let cur: number[] = [];
  const flush = () => { if (cur.length) groups.push(cur); cur = []; };
  for (let i = 0; i < m.length; i++) {
    if (!keep[i]) { flush(); continue; }
    const prev = cur[cur.length - 1];
    if (prev !== undefined && usable[i]!.monotonicMs - usable[prev]!.monotonicMs > c.maxGapMs) flush();
    cur.push(i);
  }
  flush();

  const segs = groups.filter((g) => g.length >= c.minSegPoints);
  if (segs.length === 0) return null;
  const keptM = segs.reduce((sum, g) => sum + g.reduce((s, idx, k) => (k === 0 ? s : s + dist(m[g[k - 1]!]!, m[idx]!)), 0), 0);
  // 折返路線把中段也裁掉後，剩下的可能又不足——這裡再擋一次，不是重複檢查
  if (keptM < c.minKeptM) return null;

  // 門檻 4：正規化只看留下來的點，等比置中在 0–1 單位方框
  const kept = segs.flat().map((i) => m[i]!);
  const xs = kept.map((q) => q.x);
  const ys = kept.map((q) => q.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY, 1e-6);
  const offX = (span - (Math.max(...xs) - minX)) / 2;
  const offY = (span - (Math.max(...ys) - minY)) / 2;
  const segments = segs.map((g) => g.map((i) => ({ x: round3((m[i]!.x - minX + offX) / span), y: round3((m[i]!.y - minY + offY) / span) })));
  return { segments, keptM: Math.round(keptM) };
}
