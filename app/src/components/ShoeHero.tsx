import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, Stop } from 'react-native-svg';

import { useReduceMotion } from '@/hooks/useReduceMotion';
import { color, space, Text } from '@/theme';

type Props = { level?: 1 | 2 | 3 | 4 | 5; size?: number };

// 16.2：各階主色；首版以向量 placeholder 呈現，正式 WebP／Lottie 資產由 PG-A-17 接入
const LEVEL_TINT: Record<NonNullable<Props['level']>, string> = {
  1: color.cyan,
  2: color.cyan,
  3: color.violet,
  4: color.magenta,
  5: color.mint,
};

/**
 * 7.4 Shoe Hero：跑鞋置中、圓形能量平台；平台 2.4 秒低強度循環，Reduce Motion 時靜態。
 * 資產載入失敗或未提供時仍顯示品牌 placeholder，不留空白。
 */
export function ShoeHero({ level = 1, size = 220 }: Props) {
  const reduceMotion = useReduceMotion();
  const spin = useRef(new Animated.Value(0)).current;
  const tint = LEVEL_TINT[level];

  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 2400, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [spin, reduceMotion]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={{ width: size, height: size * 0.8 }} accessible accessibilityRole="image" accessibilityLabel={`Level ${level} shoe`}>
      {/* 能量平台 */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.center, { transform: [{ rotate }] }]}>
        <Svg width={size} height={size * 0.8} viewBox="0 0 220 176">
          <Ellipse cx="110" cy="140" rx="92" ry="22" stroke={tint} strokeOpacity={0.35} strokeWidth={1.5} fill="none" strokeDasharray="18 10" />
          <Ellipse cx="110" cy="140" rx="70" ry="16" stroke={tint} strokeOpacity={0.2} strokeWidth={1} fill="none" />
        </Svg>
      </Animated.View>
      {/* 跑鞋 placeholder（3/4 視角剪影） */}
      <View style={[StyleSheet.absoluteFill, styles.center]}>
        <Svg width={size * 0.7} height={size * 0.45} viewBox="0 0 154 99">
          <Defs>
            <LinearGradient id="shoe" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={color.elevated} />
              <Stop offset="1" stopColor={color.surface} />
            </LinearGradient>
          </Defs>
          <Path
            d="M12 70 C 20 40, 60 30, 80 22 C 92 18, 100 26, 112 30 C 126 36, 142 44, 150 58 L 150 70 C 150 76, 144 80, 138 80 L 20 80 C 14 80, 10 76, 12 70 Z"
            fill="url(#shoe)"
            stroke={color.borderSubtle}
            strokeWidth={1.5}
          />
          {/* 光條：Lv1 單線 */}
          <Path d="M22 66 C 60 60, 100 56, 146 62" stroke={tint} strokeWidth={2.5} strokeLinecap="round" fill="none" />
          {level >= 2 ? <Path d="M28 74 C 60 70, 100 68, 144 72" stroke={tint} strokeWidth={1.5} strokeLinecap="round" fill="none" strokeOpacity={0.7} /> : null}
          <Circle cx="98" cy="46" r="4" fill={tint} />
        </Svg>
      </View>
      <View style={styles.badge}>
        <Text variant="label" tone="violet" uppercase>
          LV. {level}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', right: 0, top: space.xs },
});
