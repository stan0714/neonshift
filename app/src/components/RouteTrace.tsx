import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Polyline, Rect } from 'react-native-svg';

import type { RawPoint } from '@/domain/gps/engine';
import { buildTrace, scaleBarMeters } from '@/domain/gps/trace';
import { useT } from '@/i18n';
import { color, radius, space, Text } from '@/theme';

/**
 * 軌跡預覽（Style 23.3）：深色畫布上的折線，不含底圖（地圖供應商未定；本機路線永不上傳）。
 * mint 起點、magenta 終點、缺口處折線斷開、左下角比例尺。無可用點時顯示說明而非空白。
 */
export function RouteTrace({ points, height = 220, testID = 'route-trace' }: { points: RawPoint[]; height?: number; testID?: string }) {
  const { t } = useT();
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));
  const trace = width > 0 ? buildTrace(points, { width, height }) : null;
  const bar = trace ? scaleBarMeters(trace.metersPerPx) : null;
  return (
    <View style={[styles.box, { height }]} onLayout={onLayout} accessible accessibilityRole="image" accessibilityLabel={trace && trace.pointCount > 0 ? t('trace.a11y', { n: trace.pointCount, gaps: Math.max(0, trace.segments.length - 1) }) : t('trace.empty')} testID={testID}>
      {trace && trace.pointCount > 0 ? (
        <Svg width={width} height={height}>
          <Rect x={0} y={0} width={width} height={height} fill={color.surface} />
          {[0.25, 0.5, 0.75].map((f) => (
            <Line key={`h${f}`} x1={0} y1={height * f} x2={width} y2={height * f} stroke={color.borderSubtle} strokeOpacity={0.5} />
          ))}
          {[0.25, 0.5, 0.75].map((f) => (
            <Line key={`v${f}`} x1={width * f} y1={0} x2={width * f} y2={height} stroke={color.borderSubtle} strokeOpacity={0.5} />
          ))}
          {trace.segments.map((seg, i) => (
            <Polyline key={i} points={seg.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} fill="none" stroke={color.mint} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {trace.start ? <Circle cx={trace.start.x} cy={trace.start.y} r={6} fill={color.mint} stroke={color.canvas} strokeWidth={2} /> : null}
          {trace.end ? <Circle cx={trace.end.x} cy={trace.end.y} r={6} fill={color.magenta} stroke={color.canvas} strokeWidth={2} /> : null}
          {bar && trace.metersPerPx ? (
            <>
              <Line x1={space.s} y1={height - space.s} x2={space.s + bar / trace.metersPerPx} y2={height - space.s} stroke={color.textSecondary} strokeWidth={2} />
              <Line x1={space.s} y1={height - space.s - 4} x2={space.s} y2={height - space.s + 4} stroke={color.textSecondary} strokeWidth={2} />
              <Line x1={space.s + bar / trace.metersPerPx} y1={height - space.s - 4} x2={space.s + bar / trace.metersPerPx} y2={height - space.s + 4} stroke={color.textSecondary} strokeWidth={2} />
            </>
          ) : null}
        </Svg>
      ) : (
        <View style={styles.empty}>
          <Text variant="bodySmall" tone="muted" style={styles.center}>
            {width > 0 ? t('trace.empty') : ''}
          </Text>
        </View>
      )}
      {bar ? (
        <Text variant="caption" tone="secondary" numeric style={styles.scaleLabel} testID={`${testID}-scale`}>
          {bar >= 1000 ? `${bar / 1000} km` : `${bar} m`}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: '100%', borderRadius: radius.m, overflow: 'hidden', backgroundColor: color.surface, borderWidth: 1, borderColor: color.borderSubtle },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.m },
  center: { textAlign: 'center' },
  scaleLabel: { position: 'absolute', left: space.s, bottom: space.s + 6 },
});
