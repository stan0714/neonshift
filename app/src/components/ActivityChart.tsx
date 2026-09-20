import { useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';

import type { ActivityBucket } from '@/domain/activity';
import { useT, type TKey } from '@/i18n';
import { color, radius, space, Text } from '@/theme';

const CHART_H = 150;
const AXIS_W = 44;

/** 座標軸上限：取 2／4／6／8／10／15／20… 中不小於最大值的「好看」數 */
export function niceMax(maxKm: number): number {
  if (maxKm <= 0) return 2;
  const steps = [2, 4, 6, 8, 10, 15, 20, 30, 40, 50, 80, 100, 150, 200, 300, 500, 1000, 2000, 5000];
  return steps.find((s) => s >= maxKm) ?? Math.ceil(maxKm / 1000) * 1000;
}

/**
 * 期間長條圖（PG-LINK-06，Style 23.17）：每桶一根距離長條、右側 0／½／上限刻度、有紀錄桶的平均虛線；今天的桶標籤加亮。
 * 觸控用透明 Pressable 列覆蓋在 SVG 上（每桶一格，≥ 44dp 高），點一桶只看該桶、再點清除；週／全部標籤全顯示，月只標 1／6／13／20／27／月底。
 */
export function ActivityChart({ buckets, selected, onSelect, avgMm, testID = 'activity-chart' }: { buckets: ActivityBucket[]; selected: string | null; onSelect: (key: string | null) => void; avgMm: number; testID?: string }) {
  const { t } = useT();
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));
  const plotW = Math.max(0, width - AXIS_W);
  const n = Math.max(1, buckets.length);
  const slot = plotW / n;
  const barW = Math.max(3, Math.min(18, slot * 0.55));
  const maxKm = niceMax(Math.max(...buckets.map((b) => b.distanceMm / 1_000_000), avgMm / 1_000_000));
  const yOf = (km: number) => CHART_H - (km / maxKm) * CHART_H;
  const showLabel = (i: number) => {
    if (buckets.length <= 12) return true;
    const last = buckets.length - 1;
    return i === 0 || i === last || [5, 12, 19, 26].includes(i);
  };
  const avgKm = avgMm / 1_000_000;
  return (
    <View style={styles.root} onLayout={onLayout} testID={testID}>
      {width > 0 ? (
        <>
          <Svg width={width} height={CHART_H + 4} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {[0, 0.5, 1].map((f) => (
              <Line key={f} x1={0} y1={yOf(maxKm * f)} x2={plotW} y2={yOf(maxKm * f)} stroke={color.borderSubtle} strokeOpacity={f === 0 ? 1 : 0.5} />
            ))}
            {avgKm > 0 ? <Line x1={0} y1={yOf(avgKm)} x2={plotW} y2={yOf(avgKm)} stroke={color.textMuted} strokeDasharray="4 4" /> : null}
            {buckets.map((b, i) => {
              const km = b.distanceMm / 1_000_000;
              const h = km > 0 ? Math.max(3, CHART_H - yOf(km)) : b.count > 0 ? 3 : 0;
              const on = selected === b.key;
              return h > 0 ? <Rect key={b.key} x={i * slot + (slot - barW) / 2} y={CHART_H - h} width={barW} height={h} rx={barW / 2} fill={on ? color.textPrimary : color.mint} fillOpacity={selected && !on ? 0.45 : 1} /> : null;
            })}
          </Svg>
          <View style={[styles.axis, { left: plotW }]} pointerEvents="none">
            <Text variant="caption" tone="muted" numeric style={styles.axisTop}>{maxKm}</Text>
            <Text variant="caption" tone="muted" numeric style={[styles.axisMid, { top: yOf(maxKm / 2) - 8 }]}>{maxKm / 2}</Text>
            {avgKm > 0 && Math.abs(yOf(avgKm) - yOf(maxKm)) > 14 && Math.abs(yOf(avgKm) - yOf(maxKm / 2)) > 14 ? <Text variant="caption" tone="muted" numeric style={[styles.axisMid, { top: yOf(avgKm) - 8 }]} testID={`${testID}-avg`}>{avgKm.toFixed(1)}</Text> : null}
            <Text variant="caption" tone="muted" numeric style={styles.axisBottom}>0 km</Text>
          </View>
          <View style={[styles.touch, { width: plotW }]}>
            {buckets.map((b) => (
              <Pressable key={b.key} onPress={() => onSelect(selected === b.key ? null : b.key)} accessibilityRole="button" accessibilityState={{ selected: selected === b.key }} accessibilityLabel={`${b.label}: ${(b.distanceMm / 1_000_000).toFixed(1)} km · ${b.count}`} style={styles.touchCell} testID={`activity-bar-${b.key}`} />
            ))}
          </View>
          <View style={[styles.labels, { width: plotW }]} pointerEvents="none">
            {buckets.map((b, i) => (showLabel(i) ? (
              <Text key={b.key} variant="caption" tone={b.isToday ? undefined : 'muted'} numeric numberOfLines={1} style={[styles.label, { left: i * slot + slot / 2 - 20 }, b.isToday && styles.today]}>{buckets.length === 7 ? t(`actv.wd.${b.label}` as TKey) : b.label}</Text>
            ) : null))}
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: '100%', height: CHART_H + 4 + 22 + space.xs, marginTop: space.m },
  axis: { position: 'absolute', top: 0, height: CHART_H + 4, width: AXIS_W, alignItems: 'flex-end', paddingRight: space.xxs },
  axisTop: { position: 'absolute', top: -8, right: space.xxs },
  axisMid: { position: 'absolute', right: space.xxs },
  axisBottom: { position: 'absolute', bottom: -6, right: space.xxs },
  touch: { position: 'absolute', top: 0, left: 0, height: CHART_H + 4, flexDirection: 'row' },
  touchCell: { flex: 1, minHeight: 44, borderRadius: radius.s },
  labels: { height: 18, marginTop: space.xs },
  label: { position: 'absolute', width: 40, textAlign: 'center' },
  today: { fontWeight: '700' },
});
