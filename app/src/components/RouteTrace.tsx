import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Defs, G, Line, Polygon, Polyline, RadialGradient, Rect, Stop } from 'react-native-svg';

import { HabitatArt } from '@/components/HabitatScene';
import { HABITAT_SCENES, type HabitatSceneKind } from '@/domain/appearance';
import type { RawPoint } from '@/domain/gps/engine';
import { buildTrace, scaleBarMeters } from '@/domain/gps/trace';
import { useT } from '@/i18n';
import { color, radius, space, Text } from '@/theme';

/** 軌跡底圖圖層（Style 23.5）：不揭露真實位置的趣味圖層；`geo`（真實地圖）待地圖供應商定案，UI 以「尚未啟用」呈現 */
export type TraceLayer = 'grid' | 'mars' | 'chain' | 'space' | HabitatSceneKind;
export const TRACE_LAYERS: readonly TraceLayer[] = ['grid', 'mars', 'chain', 'space'];
/** 棲地底圖（PG-LINK-07）：與跑鞋場景同一組畫，曾取得該鞋階才可選 */
export const HABITAT_LAYERS: readonly HabitatSceneKind[] = HABITAT_SCENES;

/** 決定性偽隨機（同一畫布同一圖層每次一樣，不用 Math.random 以免重繪跳動） */
const prng = (seed: number) => () => { seed = (seed * 1_664_525 + 1_013_904_223) % 4_294_967_296; return seed / 4_294_967_296; };

/** 圖層本體：純 SVG 程序繪製，無網路、無座標依賴（只用畫布尺寸）。火星／太空的色票是圖層專屬美術色（同 ShoeHero 各階 tint），不是 UI token；折線與起終點仍用 token */
export function LayerArt({ layer, width, height }: { layer: TraceLayer; width: number; height: number }) {
  const rnd = prng(width * 31 + height * 17 + layer.length);
  if ((HABITAT_LAYERS as readonly string[]).includes(layer)) return <HabitatArt kind={layer as HabitatSceneKind} width={width} height={height} />;
  if (layer === 'mars') {
    const craters = Array.from({ length: 14 }, () => ({ x: rnd() * width, y: rnd() * height, r: 6 + rnd() * 26 }));
    return (
      <G>
        <Defs>
          <RadialGradient id="mars-sky" cx="50%" cy="20%" r="80%">
            <Stop offset="0" stopColor="#3B1A12" />
            <Stop offset="1" stopColor="#140806" />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill="url(#mars-sky)" />
        {craters.map((c, i) => (
          <G key={i}>
            <Circle cx={c.x} cy={c.y} r={c.r} fill="#2A100B" stroke="#5A2A1D" strokeWidth={1.5} />
            <Circle cx={c.x - c.r * 0.25} cy={c.y - c.r * 0.25} r={c.r * 0.55} fill="#3A1810" />
          </G>
        ))}
        <Circle cx={width * 0.85} cy={height * 0.18} r={10} fill="#E9D4B0" opacity={0.8} />
      </G>
    );
  }
  if (layer === 'chain') {
    const cell = 34;
    const cols = Math.ceil(width / cell) + 1;
    const rows = Math.ceil(height / cell) + 1;
    const nodes: { x: number; y: number }[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) nodes.push({ x: c * cell + (r % 2) * (cell / 2), y: r * cell * 0.87 });
    const hex = (x: number, y: number, r: number) => Array.from({ length: 6 }, (_, i) => `${(x + r * Math.cos((Math.PI / 3) * i + Math.PI / 6)).toFixed(1)},${(y + r * Math.sin((Math.PI / 3) * i + Math.PI / 6)).toFixed(1)}`).join(' ');
    return (
      <G>
        <Rect x={0} y={0} width={width} height={height} fill="#070B1A" />
        {nodes.map((n, i) => (
          <Polygon key={i} points={hex(n.x, n.y, cell / 2 - 3)} fill="none" stroke={color.violet} strokeOpacity={0.18} />
        ))}
        {nodes.filter((_, i) => i % 7 === 0).map((n, i) => (
          <Circle key={`n${i}`} cx={n.x} cy={n.y} r={3} fill={color.cyan} opacity={0.5} />
        ))}
        {nodes.filter((_, i) => i % 11 === 0).map((n, i) => {
          const m = nodes[(i * 13 + 5) % nodes.length]!;
          return <Line key={`l${i}`} x1={n.x} y1={n.y} x2={m.x} y2={m.y} stroke={color.cyan} strokeOpacity={0.15} />;
        })}
      </G>
    );
  }
  if (layer === 'space') {
    const stars = Array.from({ length: 90 }, () => ({ x: rnd() * width, y: rnd() * height, r: 0.6 + rnd() * 1.6, o: 0.3 + rnd() * 0.7 }));
    return (
      <G>
        <Defs>
          <RadialGradient id="space-neb" cx="70%" cy="30%" r="70%">
            <Stop offset="0" stopColor="#2A1D5C" stopOpacity={0.9} />
            <Stop offset="1" stopColor="#03050F" stopOpacity={1} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill="url(#space-neb)" />
        {stars.map((st, i) => (
          <Circle key={i} cx={st.x} cy={st.y} r={st.r} fill="#FFFFFF" opacity={st.o} />
        ))}
        <Circle cx={width * 0.2} cy={height * 0.75} r={22} fill="#1B2A6B" stroke="#5B7CFF" strokeOpacity={0.5} />
        <Line x1={width * 0.2 - 34} y1={height * 0.75 + 6} x2={width * 0.2 + 34} y2={height * 0.75 - 6} stroke="#8FA4FF" strokeOpacity={0.6} strokeWidth={2} />
      </G>
    );
  }
  return (
    <G>
      <Rect x={0} y={0} width={width} height={height} fill={color.surface} />
      {[0.25, 0.5, 0.75].map((f) => (
        <Line key={`h${f}`} x1={0} y1={height * f} x2={width} y2={height * f} stroke={color.borderSubtle} strokeOpacity={0.5} />
      ))}
      {[0.25, 0.5, 0.75].map((f) => (
        <Line key={`v${f}`} x1={width * f} y1={0} x2={width * f} y2={height} stroke={color.borderSubtle} strokeOpacity={0.5} />
      ))}
    </G>
  );
}

/**
 * 軌跡預覽（Style 23.3／23.5）：深色畫布上的折線＋可選趣味底圖（格線／火星／區塊鏈／太空；皆不含地理資訊）。
 * 真實地圖底圖待供應商定案；本機路線永不上傳。mint 起點、magenta 終點、缺口處折線斷開、左下角比例尺。無可用點時顯示說明而非空白。
 */
export function RouteTrace({ points, height = 220, layer = 'grid', testID = 'route-trace' }: { points: RawPoint[]; height?: number; layer?: TraceLayer; testID?: string }) {
  const { t } = useT();
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));
  const trace = width > 0 ? buildTrace(points, { width, height }) : null;
  const bar = trace ? scaleBarMeters(trace.metersPerPx) : null;
  return (
    <View style={[styles.box, { height }]} onLayout={onLayout} accessible accessibilityRole="image" accessibilityLabel={trace && trace.pointCount > 0 ? t('trace.a11y', { n: trace.pointCount, gaps: Math.max(0, trace.segments.length - 1) }) : t('trace.empty')} testID={testID}>
      {trace && trace.pointCount > 0 ? (
        <Svg width={width} height={height} testID={`${testID}-layer-${layer}`}>
          <LayerArt layer={layer} width={width} height={height} />
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
