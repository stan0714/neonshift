import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import type { HabitatSceneKind } from '@/domain/appearance';
import { color } from '@/theme';

/**
 * 跑鞋連動棲地背景（PG-LINK-01，Style 23.13）：靜態紋理鋪在頁首／留白，內容卡片維持不透明深色底。
 * 森林（Lv.2 亞洲象）深綠低對比林冠；海洋（Lv.3 玳瑁）深藍稀疏水波與珊瑚輪廓；密林（Lv.4 老虎）琥珀細線暗林影；雪林（Lv.5 遠東豹）冷紫雪林與星點。
 * 沒有動畫（跟隨減少動態也一樣）；SVG 內嵌不會載入失敗；底部漸層回到 canvas，文字對比不受影響。
 */
export const HABITAT_SCENE_HEIGHT = 360;

export function HabitatScene({ kind, height = HABITAT_SCENE_HEIGHT }: { kind: HabitatSceneKind; height?: number }) {
  return (
    <View pointerEvents="none" style={[styles.root, { height }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID={`habitat-scene-${kind}`}>
      <Svg width="100%" height="100%" viewBox="0 0 400 360" preserveAspectRatio="xMidYMin slice">
        <Defs>
          <LinearGradient id="hs-fade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color.canvas} stopOpacity={0} />
            <Stop offset="0.55" stopColor={color.canvas} stopOpacity={0.15} />
            <Stop offset="1" stopColor={color.canvas} stopOpacity={1} />
          </LinearGradient>
          <LinearGradient id="hs-tint" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={TINT[kind]} stopOpacity={0.55} />
            <Stop offset="1" stopColor={TINT[kind]} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="400" height="360" fill="url(#hs-tint)" />
        {kind === 'forest' ? <Forest /> : kind === 'ocean' ? <Ocean /> : kind === 'jungle' ? <Jungle /> : <Snow />}
        <Rect x="0" y="0" width="400" height="360" fill="url(#hs-fade)" />
      </Svg>
    </View>
  );
}

const TINT: Record<HabitatSceneKind, string> = { forest: '#0E3A2A', ocean: '#0B2A5C', jungle: '#3A2A0E', snow: '#2A2050' };

/** 森林：三層林冠剪影（圓弧樹冠），越近越深 */
function Forest() {
  const canopy = (y: number, fill: string, seed: number) => {
    let d = `M0 ${y + 40}`;
    for (let x = 0; x <= 400; x += 40) {
      const r = 26 + ((x / 40 + seed) % 3) * 8;
      d += ` Q${x + 20} ${y - r} ${x + 40} ${y + 40}`;
    }
    return <Path d={`${d} L400 360 L0 360 Z`} fill={fill} />;
  };
  return (
    <G>
      {canopy(170, '#123F2F', 0)}
      {canopy(230, '#0D2F23', 1)}
      {canopy(290, '#081F17', 2)}
      <G stroke="#1B5A43" strokeWidth={1} opacity={0.5}>
        <Path d="M60 360 V300 M180 360 V310 M300 360 V296 M350 360 V318" />
      </G>
    </G>
  );
}

/** 海洋：稀疏水波線與珊瑚輪廓 */
function Ocean() {
  const wave = (y: number, o: number) => <Path key={y} d={`M-20 ${y} q30 -10 60 0 t60 0 t60 0 t60 0 t60 0 t60 0 t60 0`} fill="none" stroke="#3B7BD6" strokeWidth={1} opacity={o} />;
  return (
    <G>
      {wave(70, 0.35)}{wave(110, 0.25)}{wave(150, 0.18)}{wave(190, 0.12)}
      <G fill="none" stroke="#5E4BB8" strokeWidth={1.2} opacity={0.4}>
        <Path d="M40 360 V330 Q40 305 60 300 M40 335 Q25 325 28 310 M60 300 Q80 292 78 275 M60 300 Q52 285 58 272" />
        <Path d="M340 360 V325 Q345 300 330 292 M340 330 Q360 320 362 300 M330 292 Q315 285 318 270" />
        <Path d="M200 360 V340 Q205 325 190 320 M200 345 Q215 340 218 325" />
      </G>
      <Ellipse cx="120" cy="352" rx="70" ry="8" fill="#123A6B" opacity={0.5} />
      <Ellipse cx="300" cy="356" rx="90" ry="9" fill="#0E2E58" opacity={0.6} />
    </G>
  );
}

/** 密林：琥珀細線（光束）與暗色葉影 */
function Jungle() {
  const leaf = (x: number, y: number, r: number, fill: string) => <Path key={`${x}-${y}`} d={`M${x} ${y} q${r} -${r * 0.6} ${r * 2} 0 q-${r} ${r * 0.6} -${r * 2} 0 Z`} fill={fill} />;
  return (
    <G>
      <G stroke="#B8842E" strokeWidth={0.8} opacity={0.35}>
        <Path d="M90 0 L60 360 M150 0 L135 360 M260 0 L290 360 M330 0 L372 360" />
      </G>
      {leaf(-10, 250, 40, '#2A1F0A')}{leaf(50, 290, 50, '#1F1707')}{leaf(150, 270, 45, '#2A1F0A')}{leaf(230, 300, 55, '#1F1707')}{leaf(320, 260, 48, '#2A1F0A')}{leaf(360, 310, 40, '#1F1707')}
      <Path d="M0 320 Q100 290 200 320 T400 320 L400 360 L0 360 Z" fill="#150F05" />
    </G>
  );
}

/** 雪林：冷紫夜空星點與針葉樹剪影 */
function Snow() {
  const pine = (x: number, h: number, fill: string) => <Path key={`${x}-${h}`} d={`M${x} 360 L${x} ${360 - h} L${x - h * 0.22} ${360 - h * 0.55} L${x - h * 0.1} ${360 - h * 0.55} L${x - h * 0.32} ${360 - h * 0.2} L${x + h * 0.32} ${360 - h * 0.2} L${x + h * 0.1} ${360 - h * 0.55} L${x + h * 0.22} ${360 - h * 0.55} Z`} fill={fill} />;
  const stars = [[30, 40], [90, 20], [140, 70], [210, 35], [260, 90], [320, 25], [370, 60], [180, 120], [60, 110], [300, 130]];
  return (
    <G>
      {stars.map(([x, y], i) => <Circle key={i} cx={x} cy={y} r={i % 3 === 0 ? 1.6 : 1} fill="#C9C2FF" opacity={0.6} />)}
      {pine(40, 120, '#1E1840')}{pine(110, 90, '#171233')}{pine(180, 140, '#1E1840')}{pine(250, 100, '#171233')}{pine(320, 130, '#1E1840')}{pine(385, 95, '#171233')}
      <Path d="M0 340 Q100 320 200 338 T400 336 L400 360 L0 360 Z" fill="#2B2757" opacity={0.6} />
    </G>
  );
}

const styles = StyleSheet.create({ root: { position: 'absolute', top: 0, left: 0, right: 0 } });
