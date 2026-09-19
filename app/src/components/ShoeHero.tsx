import { useEffect, useId, useRef, useState } from 'react';
import { Animated, AppState, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';

import { WildlifeShoePattern } from './WildlifeShoePattern';
import { useT, type TKey } from '@/i18n';
import { shoeVariant } from '@/config/shoeCollection';
import { useWalletStore } from '@/state/walletStore';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { SHOE_PROGRESSION, type ShoeLevel } from '@/config/shoeProgression';
import { color, space, Text } from '@/theme';

export type ShoeDetail = 'heel' | 'upper' | 'sole';
const DETAIL_VIEWBOX: Record<ShoeDetail, string> = { heel: '22 62 82 84', upper: '61 92 163 51', sole: '29 130 195 33' };

export type ShoeHeroProps = { detail?: ShoeDetail; owner?: string | null; level?: ShoeLevel; size?: number; active?: boolean; /** 右上角 `LV. n` 標籤；縮圖（收藏格）可關閉 */ badge?: boolean };

/** Gentle planar motion keeps the SVG shoe rigid and its proportions unchanged. */
export function ShoeHero({ level = 1, size = 260, active = true, badge = true, owner, detail }: ShoeHeroProps) {
  const { t } = useT();
  const viewBox = detail ? DETAIL_VIEWBOX[detail] : '0 0 260 208';
  const wallet = useWalletStore(s => s.session?.publicKey.toString() ?? null);
  const variant = shoeVariant(owner === undefined ? wallet : owner, level);
  const reduceMotion = useReduceMotion();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const phase = useRef(new Animated.Value(0)).current;
  const turn = useRef(new Animated.Value(0)).current;
  const id = useId().replace(/:/g, '');
  const stage = SHOE_PROGRESSION.stages[level - 1];
  const tint = stage.tint;
  const paint = (name: string) => `url(#${id}-${name})`;

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    phase.setValue(0);
    turn.setValue(0);
    if (reduceMotion || !foreground || !active || detail) return;
    const timing = (toValue: number) => Animated.timing(phase, {
      toValue, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true, isInteraction: false,
    });
    const loop = Animated.loop(Animated.sequence([timing(1), timing(0)]));
    const rotateTo = (toValue: number, duration: number) => Animated.timing(turn, {
      toValue, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true, isInteraction: false,
    });
    // Begin and end face-on, so stopping motion restores a neutral presentation.
    const rotation = Animated.loop(Animated.sequence([
      rotateTo(1, 1800), rotateTo(-1, 3600), rotateTo(0, 1800),
    ]));
    loop.start();
    rotation.start();
    return () => {
      loop.stop();
      rotation.stop();
    };
  }, [phase, turn, reduceMotion, foreground, active, detail]);

  return (
    <View style={{ width: size, maxWidth: '100%', height: size * 0.8 }} accessible accessibilityRole="image" accessibilityLabel={detail ? t('wild.detailLabel', { name: t(`col.stage.${level}` as TKey), part: t(`wild.part.${detail}` as TKey) }) : t(`col.stage.${level}` as TKey)} pointerEvents="none">
      <Svg width="100%" height="100%" viewBox={viewBox} style={[StyleSheet.absoluteFill, detail && styles.hidden]}>
        <Defs>
          <RadialGradient id={`${id}-halo`}>
            <Stop offset="0" stopColor={tint} stopOpacity={0.13} />
            <Stop offset="1" stopColor={tint} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Ellipse cx="130" cy="108" rx="120" ry="88" fill={paint('halo')} />
        <Ellipse cx="130" cy="173" rx="111" ry="23" fill={color.surface} fillOpacity={0.6} stroke={tint} strokeOpacity={0.16} />
        <Ellipse cx="130" cy="173" rx="96" ry="17" fill="none" stroke={tint} strokeOpacity={0.3} strokeDasharray="3 9" />
        <Ellipse cx="130" cy="173" rx="78" ry="11" fill="none" stroke={tint} strokeOpacity={0.14} />
        <Path d="M22 169 H35 M225 169 H238 M130 148 V153 M130 191 V196" stroke={tint} strokeOpacity={0.5} strokeWidth={1.5} />
        <Path d="M31 48 V38 H44 M216 38 H229 V48" stroke={color.borderSubtle} fill="none" />
      </Svg>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: detail ? 0 : phase.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0.28] }), transform: [{ scaleX: phase.interpolate({ inputRange: [0, 1], outputRange: [1, 0.85] }) }] }]}>
        <Svg width="100%" height="100%" viewBox={viewBox}>
          <Ellipse cx="133" cy="172" rx="66" ry="7" fill={tint} fillOpacity={0.2} />
          <Path d="M33 181 C65 200 194 200 226 179" fill="none" stroke={tint} strokeOpacity={0.65} strokeWidth={1.3} />
        </Svg>
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, { transform: [
        { translateY: phase.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.026] }) },
        { rotateZ: turn.interpolate({ inputRange: [-1, 0, 1], outputRange: ['-2deg', '0deg', '2deg'] }) },
      ] }]}>
        <Svg width="100%" height="100%" viewBox={viewBox}>
          <Defs>
            <LinearGradient id={`${id}-upper`} x1="0%" y1="0%" x2="80%" y2="100%">
              <Stop offset="0" stopColor={color.textMuted} />
              <Stop offset="0.36" stopColor={stage.material} />
              <Stop offset="1" stopColor={color.surface} />
            </LinearGradient>
            <LinearGradient id={`${id}-sole`} x1="0%" y1="0%" x2="0%" y2="100%">
              <Stop offset="0" stopColor={color.textSecondary} />
              <Stop offset="0.35" stopColor={color.borderSubtle} />
              <Stop offset="1" stopColor={color.surface} />
            </LinearGradient>
            <LinearGradient id={`${id}-energy`} x1="0%" y1="0%" x2="100%" y2="0%">
              <Stop offset="0" stopColor={stage.accent} />
              <Stop offset="0.55" stopColor={tint} />
              <Stop offset="1" stopColor={stage.accent} />
            </LinearGradient>
          </Defs>
          {/* Outsole, sculpted midsole and recessed tread. */}
          <Path d="M29 127 Q21 138 35 148 Q110 166 207 148 Q236 143 234 130 L224 119 Z" fill={color.canvas} stroke={color.borderSubtle} strokeWidth={1.5} />
          <Path d="M28 118 Q65 125 125 129 Q181 133 219 116 L234 127 Q241 136 218 141 Q127 163 35 139 Q23 135 28 118 Z" fill={paint('sole')} stroke={color.textMuted} strokeOpacity={0.6} />
          <Path d="M36 138 Q119 158 216 140" fill="none" stroke={tint} strokeOpacity={0.45} />
          {[46, 63, 80, 97, 151, 168, 185, 202].map((x) => <Path key={x} d={`M${x} 143 l-3 5`} stroke={color.canvas} strokeWidth={3} strokeLinecap="round" />)}
          {/* Heel collar, layered upper and toe bumper. */}
          <Path d="M30 121 L34 73 Q36 62 48 66 L63 81 Q76 87 87 67 L101 51 Q112 47 120 61 L139 84 Q159 101 192 104 Q217 105 228 119 Q232 124 216 130 Q157 147 91 135 L39 128 Z" fill={paint('upper')} stroke={color.textMuted} strokeWidth={1.2} />
          <Path d="M38 72 Q47 72 57 86 Q73 98 93 67 L102 59 Q103 77 89 91 Q69 111 43 90 Z" fill={color.canvas} stroke={color.borderSubtle} strokeWidth={2} />
          <Path d="M40 83 L40 118 L64 124 L68 101" fill={color.elevated} stroke={color.textMuted} strokeOpacity={0.45} />
          <Path d="M102 62 L123 87 L149 105 L131 117 L86 97 Z" fill={color.elevated} stroke={color.borderSubtle} />
          <Path d="M153 107 Q184 106 202 112 Q216 118 219 123" fill="none" stroke={color.textSecondary} strokeOpacity={0.48} />
          <Path d="M170 117 Q193 114 216 124 L214 130 Q190 139 168 138" fill={color.surface} fillOpacity={0.6} stroke={color.borderSubtle} />
          {/* Lace eyelets and cross-lacing. */}
          {[0, 1, 2, 3].map((n) => <G key={n}>
            <Circle cx={95 + n * 9} cy={78 + n * 7} r={2.3} fill={color.canvas} stroke={tint} strokeOpacity={0.5} />
            <Path d={`M${94 + n * 9} ${78 + n * 7} l19 -2 l-12 10`} fill="none" stroke={color.textSecondary} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
          </G>)}
          {/* Mesh perforations stay within the side panel. */}
          {[0, 1, 2].map((row) => [0, 1, 2, 3, 4].map((col) => <Circle key={`${row}-${col}`} cx={73 + col * 8 + row * 3} cy={109 + row * 6} r={0.8} fill={color.textSecondary} fillOpacity={0.4} />))}
          {/* Stage geometry stays distinct even without color or animation. */}
          {level >= 2 ? <Path d="M32 90 L44 99 L49 122 L36 120 Z" fill={stage.material} stroke={tint} strokeWidth={1.2} /> : null}
          {level >= 3 ? <G>
            <Path d="M70 103 L84 97 L91 127 L81 126 Z M108 113 L117 112 L122 134 L112 132 Z M167 115 L175 117 L169 135 L160 137 Z" fill={stage.material} stroke={tint} strokeOpacity={0.75} />
            <Path d="M102 143 L113 150 L143 149 L157 142" stroke={color.canvas} strokeWidth={3} fill="none" />
          </G> : null}
          {level >= 4 ? <G>
            <Path d="M32 108 Q24 85 34 76 Q44 79 48 98 L47 119 Z" fill={stage.material} stroke={tint} strokeWidth={1.2} />
            <Path d="M49 139 Q68 144 89 145 L84 151 L52 147 Z" fill={color.canvas} stroke={tint} />
            <Path d="M56 142 L79 146" stroke={tint} strokeWidth={2} />
          </G> : null}
          {level === 5 ? <G>
            <Path d="M174 108 L193 108 L215 120 L199 120 Z M69 101 L78 89 L86 96 L83 106 Z" fill={color.textSecondary} stroke={color.textPrimary} strokeOpacity={0.7} />
            <Path d="M61 151 L88 155 L86 160 L60 156 Z M154 154 L178 151 L177 157 L153 160 Z" fill={stage.material} stroke={tint} />
            <Path d="M93 155 H145" stroke={stage.accent} strokeDasharray="3 4" />
          </G> : null}
          <WildlifeShoePattern level={level} variant={variant} tint={tint} />
          {/* N / forward-shift panel and restrained luminous piping. */}
          <Path d="M125 124 L136 103 L144 105 L150 117 L157 106 L166 109 L153 130 L145 128 L139 116 L133 126 Z" fill={paint('energy')} />
          <Path d="M36 125 Q104 148 214 131" fill="none" stroke={tint} strokeOpacity={0.12} strokeWidth={7} />
          <Path d="M36 125 Q104 148 214 131" fill="none" stroke={paint('energy')} strokeWidth={2} strokeLinecap="round" />
          <Path d="M36 78 L34 103" stroke={tint} strokeWidth={2} strokeLinecap="round" />
          {level >= 2 ? <Path d="M48 132 Q110 147 196 136" stroke={tint} strokeWidth={1} fill="none" /> : null}
          {level >= 3 ? <Path d="M176 111 L183 119 M186 113 L193 121" stroke={tint} strokeWidth={1.5} /> : null}
          {level >= 4 ? <Circle cx="47" cy="110" r="4" fill={tint} fillOpacity={0.7} /> : null}
          {level === 5 ? <Path d="M51 100 L57 95 L63 102" stroke={color.mint} fill="none" strokeWidth={2} /> : null}
        </Svg>
      </Animated.View>
      {badge && !detail ? (
        <View style={styles.badge}>
          <View style={[styles.dot, { backgroundColor: tint }]} />
          <Text variant="label" tone="secondary" uppercase>LV. {level}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: { opacity: 0 },
  badge: { position: 'absolute', right: space.s, top: space.xs, flexDirection: 'row', alignItems: 'center', gap: space.xs },
  dot: { width: 4, height: 4, borderRadius: 2 },
});
