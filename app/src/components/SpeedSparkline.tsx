import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';

import { useT } from '@/i18n';
import { color, radius, space, Text } from '@/theme';

/**
 * 速度／配速 sparkline（Style 23.6）：最近 5 分鐘的 5 秒窗速度；跑步以配速呈現（越上面越快）、走路以 km/h。
 * 純 SVG、無動畫；樣本 < 3 顯示說明。
 */
export function SpeedSparkline({ samples, sport, accent, height = 72, testID = 'speed-sparkline' }: { samples: { monotonicMs: number; speedMs: number }[]; sport: 'run' | 'walk'; accent: string; height?: number; testID?: string }) {
  const { t } = useT();
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));
  const pts = samples.filter((s) => s.speedMs > 0.2);
  const values = pts.map((s) => (sport === 'run' ? 1000 / s.speedMs : s.speedMs * 3.6)); // 跑：秒／公里；走：km/h
  const ok = width > 0 && values.length >= 3;
  let path = '';
  let lo = 0;
  let hi = 0;
  if (ok) {
    lo = Math.min(...values);
    hi = Math.max(...values);
    const span = Math.max(hi - lo, sport === 'run' ? 30 : 1);
    const t0 = pts[0]!.monotonicMs;
    const t1 = pts[pts.length - 1]!.monotonicMs;
    const dt = Math.max(1, t1 - t0);
    path = values
      .map((v, i) => {
        const x = space.xs + ((pts[i]!.monotonicMs - t0) / dt) * (width - space.xs * 2);
        // 跑步：配速越小越快 → 放上面；走路：速度越大越上面
        const norm = sport === 'run' ? (v - lo) / span : 1 - (v - lo) / span;
        const y = space.xs + norm * (height - space.xs * 2);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }
  const fmt = (v: number) => (sport === 'run' ? `${Math.floor(v / 60)}:${String(Math.round(v % 60)).padStart(2, '0')}` : v.toFixed(1));
  return (
    <View style={[styles.box, { height }]} onLayout={onLayout} accessible accessibilityRole="image" accessibilityLabel={ok ? t('rec.spark.a11y', { hi: fmt(sport === 'run' ? lo : hi), lo: fmt(sport === 'run' ? hi : lo) }) : t('rec.spark.empty')} testID={testID}>
      {ok ? (
        <>
          <Svg width={width} height={height}>
            <Line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke={color.borderSubtle} strokeOpacity={0.6} />
            <Path d={path} fill="none" stroke={accent} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          </Svg>
          <Text variant="caption" tone="secondary" numeric style={styles.hi}>{fmt(sport === 'run' ? lo : hi)}</Text>
          <Text variant="caption" tone="muted" numeric style={styles.lo}>{fmt(sport === 'run' ? hi : lo)}</Text>
        </>
      ) : (
        <Text variant="caption" tone="muted" style={styles.empty}>{width > 0 ? t('rec.spark.empty') : ''}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: '100%', borderRadius: radius.m, backgroundColor: color.surface, borderWidth: 1, borderColor: color.borderSubtle, overflow: 'hidden', justifyContent: 'center' },
  hi: { position: 'absolute', right: space.xs, top: 2 },
  lo: { position: 'absolute', right: space.xs, bottom: 2 },
  empty: { textAlign: 'center', paddingHorizontal: space.m },
});
