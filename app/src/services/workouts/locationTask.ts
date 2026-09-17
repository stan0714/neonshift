import type { LocationObject } from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import type { RawPoint } from '@/domain/gps/engine';

/**
 * 背景定位任務（PG-R-03）：expo-location 以前景服務（可見通知）推送定位；此任務只把原始點交給 recorder 的 sink。
 * 任務定義必須在 App 啟動時載入（index.ts import），不能定義在元件內。
 */
/** 也是前景通知的頻道 id（expo-location）。v2：舊 id 的頻道在已安裝裝置上是 IMPORTANCE_LOW（靜音區、無狀態列圖示），同 id 重建會沿用舊設定，故換新 id */
export const WORKOUT_LOCATION_TASK = 'neonshift-workout-location-v3';

type Sink = (points: RawPoint[]) => void;
let sink: Sink | null = null;
let seq = 0;
let lastTs = 0;

export function setLocationSink(next: Sink | null) {
  sink = next;
}
/** 新 session 開始時重設序號 */
export function resetLocationSeq(startSeq = 0) {
  seq = startSeq;
  lastTs = 0;
}

export function toRawPoints(locations: LocationObject[]): RawPoint[] {
  const out: RawPoint[] = [];
  for (const l of locations) {
    const ts = l.timestamp;
    if (!Number.isFinite(ts) || ts === lastTs) continue; // 同一 timestamp 的重送不重播
    lastTs = ts;
    out.push({ seq: seq++, monotonicMs: ts, utcMs: ts, lat: l.coords.latitude, lon: l.coords.longitude, accuracyM: l.coords.accuracy ?? Number.POSITIVE_INFINITY, speedMs: l.coords.speed ?? null, mocked: l.mocked === true });
  }
  return out;
}

TaskManager.defineTask(WORKOUT_LOCATION_TASK, async ({ data, error }) => {
  if (error || !data) return;
  const { locations } = data as { locations: LocationObject[] };
  const pts = toRawPoints(locations);
  if (pts.length && sink) sink(pts);
});
