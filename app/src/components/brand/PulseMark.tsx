import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { useReduceMotion } from '@/hooks/useReduceMotion';
import { color, glowStyle } from '@/theme';

import { BrandMark } from './BrandMark';

type Props = { size?: number; active?: boolean };

/**
 * 8.3 Loading 動效：1.6 秒 ease-in-out、96%–104% 呼吸縮放與 12% glow 變化。
 * Reduce Motion 時停用縮放，改用靜態 logo。
 */
export function PulseMark({ size = 72, active = true }: Props) {
  const reduceMotion = useReduceMotion();
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion || !active) {
      t.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(t, { toValue: 0, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [t, reduceMotion, active]);

  const scale = t.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.04] });
  const glowOpacity = t.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1] });

  return (
    <View style={{ width: size, height: size }}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.glow, glowStyle('medium', color.mint), { opacity: glowOpacity, borderRadius: size / 2 }]} />
      <Animated.View style={{ transform: [{ scale }] }}>
        <BrandMark size={size} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  glow: { backgroundColor: 'transparent' },
});
