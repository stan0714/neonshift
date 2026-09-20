import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';

import { LayerArt, type TraceLayer } from '@/components/RouteTrace';
import type { RawPoint } from '@/domain/gps/engine';
import { buildTrace } from '@/domain/gps/trace';
import { workoutRecorder } from '@/services/workouts/WorkoutRecorder';
import { color, radius } from '@/theme';

/** 本機路線點快取（只在記憶體；讀一次即可，session 結束後點不再變動） */
const cache = new Map<string, RawPoint[]>();
const inflight = new Map<string, Promise<RawPoint[]>>();
export function useRoutePoints(localId: string | null): RawPoint[] | null {
  const [pts, setPts] = useState<RawPoint[] | null>(localId ? cache.get(localId) ?? null : []);
  useEffect(() => {
    if (!localId) { setPts([]); return; }
    const hit = cache.get(localId);
    if (hit) { setPts(hit); return; }
    let alive = true;
    let p = inflight.get(localId);
    if (!p) {
      p = workoutRecorder.localStore().readPoints(localId).catch(() => [] as RawPoint[]).then((r) => { cache.set(localId, r); inflight.delete(localId); return r; });
      inflight.set(localId, p);
    }
    void p.then((r) => { if (alive) setPts(r); });
    return () => { alive = false; };
  }, [localId]);
  return pts;
}
export const __resetRouteThumbCache = () => { cache.clear(); inflight.clear(); };

/**
 * 路線縮圖（PG-LINK-06；Style 23.17）：最近活動卡左側 72dp 方塊，底圖與摘要頁同一套（跟隨跑鞋棲地，PG-LINK-07），
 * 折線由本機點畫、不上傳；伺服器摘要／室內／無點 → 只有底圖。
 */
export function RouteThumb({ points, layer, size = 72, testID = 'route-thumb' }: { points: RawPoint[] | null; layer: TraceLayer; size?: number; testID?: string }) {
  const trace = points && points.length ? buildTrace(points, { width: size, height: size, padding: 8 }) : null;
  return (
    <View style={[styles.box, { width: size, height: size }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID={`${testID}-${trace && trace.pointCount > 0 ? 'route' : 'blank'}`}>
      <Svg width={size} height={size}>
        <LayerArt layer={layer} width={size} height={size} />
        {trace && trace.pointCount > 0 ? (
          <>
            {trace.segments.map((seg, i) => <Polyline key={i} points={seg.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} fill="none" stroke={color.mint} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)}
            {trace.end ? <Circle cx={trace.end.x} cy={trace.end.y} r={2.5} fill={color.magenta} /> : null}
          </>
        ) : null}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({ box: { borderRadius: radius.m, overflow: 'hidden', borderWidth: 1, borderColor: color.borderSubtle, backgroundColor: color.surface } });
