import type { RawPoint } from '@/domain/gps/engine';
import { GPS_QUALITY } from '@/domain/gps/thresholds';

/**
 * 軌跡投影（PG-R-10 補；Style 23.3）：把本機加密保存的原始定位點轉成可畫在固定尺寸畫布上的折線。
 * - 只用精度 ≤ maxAccuracyM 的點（與引擎接受條件一致的第一道門檻）；連續兩點相隔 > maxGapMs 視為缺口，折線斷開。
 * - 等距圓柱投影、經度依中心緯度乘 cos 修正；等比縮放置中，四周留 padding。
 * - 純函式、不含任何網路或地圖供應商；輸出只在畫面使用，不會被分享或同步。
 */
export type TraceSegment = { x: number; y: number }[];
export type Trace = {
  segments: TraceSegment[];
  /** 畫布上 100 m 對應的像素（畫比例尺用）；無法計算時 null */
  metersPerPx: number | null;
  start: { x: number; y: number } | null;
  end: { x: number; y: number } | null;
  pointCount: number;
};

const R_M = 6_371_008.8;

export function buildTrace(points: RawPoint[], opts: { width: number; height: number; padding?: number; maxAccuracyM?: number; maxGapMs?: number }): Trace {
  const padding = opts.padding ?? 16;
  const maxAcc = opts.maxAccuracyM ?? GPS_QUALITY.acceptMaxAccuracyM;
  const maxGap = opts.maxGapMs ?? 5000;
  const usable = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && p.accuracyM <= maxAcc).sort((a, b) => a.seq - b.seq);
  if (usable.length === 0) return { segments: [], metersPerPx: null, start: null, end: null, pointCount: 0 };
  const lat0 = usable.reduce((a, p) => a + p.lat, 0) / usable.length;
  const cos = Math.cos((lat0 * Math.PI) / 180);
  const toM = (p: RawPoint) => ({ x: ((p.lon * Math.PI) / 180) * R_M * cos, y: -((p.lat * Math.PI) / 180) * R_M });
  const m = usable.map(toM);
  const minX = Math.min(...m.map((q) => q.x));
  const maxX = Math.max(...m.map((q) => q.x));
  const minY = Math.min(...m.map((q) => q.y));
  const maxY = Math.max(...m.map((q) => q.y));
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const innerW = Math.max(1, opts.width - padding * 2);
  const innerH = Math.max(1, opts.height - padding * 2);
  const scale = Math.min(innerW / spanX, innerH / spanY); // px per m
  const offX = padding + (innerW - spanX * scale) / 2;
  const offY = padding + (innerH - spanY * scale) / 2;
  const project = (q: { x: number; y: number }) => ({ x: offX + (q.x - minX) * scale, y: offY + (q.y - minY) * scale });
  const segments: TraceSegment[] = [];
  let cur: TraceSegment = [];
  for (let i = 0; i < usable.length; i++) {
    const p = usable[i]!;
    const prev = usable[i - 1];
    if (prev && p.monotonicMs - prev.monotonicMs > maxGap && cur.length) {
      segments.push(cur);
      cur = [];
    }
    cur.push(project(m[i]!));
  }
  if (cur.length) segments.push(cur);
  const first = segments[0]?.[0] ?? null;
  const lastSeg = segments[segments.length - 1];
  const last = lastSeg ? lastSeg[lastSeg.length - 1]! : null;
  return { segments, metersPerPx: 1 / scale, start: first, end: last, pointCount: usable.length };
}

/**
 * 分享用：裁去起點與終點各 meters 公尺（社群分享規劃 §5.2）。
 * 路線形狀可能透露常跑地點，最敏感的是出發與結束的位置；中段形狀保留。
 * 總長不足 3×meters 時回空陣列——裁完剩不到一段可辨識的形狀，寧可不給圖。
 */
export function trimEnds(points: RawPoint[], meters: number): RawPoint[] {
  const usable = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon)).sort((a, b) => a.seq - b.seq);
  if (meters <= 0 || usable.length < 2) return meters <= 0 ? usable : [];
  const cos = Math.cos(((usable.reduce((a, p) => a + p.lat, 0) / usable.length) * Math.PI) / 180);
  const cum = [0];
  for (let i = 1; i < usable.length; i++) {
    const a = usable[i - 1]!;
    const b = usable[i]!;
    const dx = (((b.lon - a.lon) * Math.PI) / 180) * R_M * cos;
    const dy = (((b.lat - a.lat) * Math.PI) / 180) * R_M;
    cum.push(cum[i - 1]! + Math.hypot(dx, dy));
  }
  const total = cum[cum.length - 1]!;
  if (total < meters * 3) return [];
  return usable.filter((_, i) => cum[i]! >= meters && cum[i]! <= total - meters);
}

/** 比例尺長度：挑 1／2／5×10^n 公尺中畫在畫布上介於 40～120 px 的一個 */
export function scaleBarMeters(metersPerPx: number | null): number | null {
  if (!metersPerPx || !Number.isFinite(metersPerPx) || metersPerPx <= 0) return null;
  const candidates = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
  for (const c of candidates) {
    const px = c / metersPerPx;
    if (px >= 40 && px <= 120) return c;
  }
  return null;
}
