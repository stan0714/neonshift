import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, AppState, Easing, Pressable, StyleSheet, View } from 'react-native';

import { useReduceMotion } from '@/hooks/useReduceMotion';
import { useT } from '@/i18n';
import { color, radius, space, Text } from '@/theme';

/** One finite ceremony; silhouette gets its own beat before the shoe arrives. */
export const UNBOX_TIMELINE = { total: 5200, shakeStart: 1100, shakeMid: 1800, burst: 2400, revealed: 3500 } as const;
const T = (ms: number) => ms / UNBOX_TIMELINE.total;

type Props = {
  accent: string;
  height: number;
  onRevealed?: () => void;
  backdrop?: ReactNode;
  children: ReactNode;
};

export function UnboxStage({ accent, height, onRevealed, backdrop, children }: Props) {
  const reduced = useReduceMotion();
  const { t } = useT();
  const p = useRef(new Animated.Value(0)).current;
  const [settled, setSettled] = useState(false);
  const notified = useRef(false);
  const callback = useRef(onRevealed);
  callback.current = onRevealed;
  const settle = useRef<() => void>(() => {});

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    let animation: Animated.CompositeAnimation | undefined;
    const notify = () => {
      if (notified.current) return;
      notified.current = true;
      callback.current?.();
    };
    const finish = () => {
      timers.forEach(clearTimeout);
      animation?.stop();
      p.setValue(1);
      setSettled(true);
      notify();
    };
    settle.current = finish;
    // Returning from background or changing accessibility settings must never replay a box.
    if (reduced || notified.current || (AppState.currentState === 'background' || AppState.currentState === 'inactive')) {
      finish();
      return;
    }
    p.setValue(0);
    animation = Animated.timing(p, { toValue: 1, duration: UNBOX_TIMELINE.total, easing: Easing.linear, useNativeDriver: true, isInteraction: false });
    animation.start();
    for (const [ms, style] of [
      [UNBOX_TIMELINE.shakeStart, Haptics.ImpactFeedbackStyle.Light],
      [UNBOX_TIMELINE.shakeMid, Haptics.ImpactFeedbackStyle.Medium],
      [UNBOX_TIMELINE.burst, Haptics.ImpactFeedbackStyle.Heavy],
    ] as const) timers.push(setTimeout(() => { void Haptics.impactAsync(style)?.catch(() => {}); }, ms));
    timers.push(setTimeout(notify, UNBOX_TIMELINE.revealed));
    timers.push(setTimeout(finish, UNBOX_TIMELINE.total));
    const sub = AppState.addEventListener('change', state => { if (state === 'background' || state === 'inactive') finish(); });
    return () => {
      timers.forEach(clearTimeout);
      animation?.stop();
      sub.remove();
    };
  }, [reduced, p]);

  const still = reduced || settled;
  const at = (inputRange: number[], outputRange: number[]) => p.interpolate({ inputRange, outputRange, extrapolate: 'clamp' });
  const burst = T(UNBOX_TIMELINE.burst);
  const shake = T(UNBOX_TIMELINE.shakeStart);
  const reveal = T(UNBOX_TIMELINE.revealed);
  const shakeIn = [0, shake];
  const shakeOut = ['0deg', '0deg'];
  for (let i = 1; i <= 10; i++) {
    shakeIn.push(shake + (burst - shake) * i / 10);
    shakeOut.push(i === 10 ? '0deg' : `${(i % 2 ? -1 : 1) * (2 + i * 0.65)}deg`);
  }
  shakeIn.push(1); shakeOut.push('0deg');

  return <View style={[s.stage, { height }]} testID="unbox-stage">
    <View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {/* Game-like summoning dial; no repeated white-screen flashes. */}
      {[0, 1, 2].map(i => <Animated.View key={i} style={[s.ring, {
        borderColor: accent, borderStyle: i === 1 ? 'dashed' : 'solid',
        opacity: still ? 0.18 : at([0, shake, burst, reveal, 1], [0, 0.22, 0.5, 0.32, 0.18]),
        transform: [{ scale: still ? 1 + i * 0.17 : at([0, burst, reveal, 1], [1.6 + i * 0.2, 0.75 + i * 0.1, 1.3 + i * 0.17, 1 + i * 0.17]) },
          { rotate: still ? '0deg' : p.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${i % 2 ? -65 : 65}deg`] }) }],
      }]} />)}
      {!still ? Array.from({ length: 20 }, (_, i) => {
        const angle = i * Math.PI / 10;
        const reach = Math.min(height * 0.42, 170) + (i % 3) * 10;
        return <Animated.View key={i} style={[s.spark, { backgroundColor: i % 3 ? accent : color.warning,
          opacity: at([0, burst, burst + 0.04, 0.92], [0, 0, 0.9, 0]),
          transform: [{ translateX: at([burst, 0.92], [Math.cos(angle) * 20, Math.cos(angle) * reach]) },
            { translateY: at([burst, 0.92], [Math.sin(angle) * 20, Math.sin(angle) * reach - 20]) },
            { rotate: `${i * 41}deg` }, { scale: at([burst, 0.92], [1.5, 0.35]) }],
        }]} />;
      }) : null}
      {!still ? <Animated.View style={[s.burst, { borderColor: accent, opacity: at([burst, burst + 0.08, reveal], [0, 0.75, 0]), transform: [{ scale: at([burst, reveal], [0.2, 1.65]) }] }]} /> : null}
    </View>

    {/* Species silhouette leads the shoe by 600 ms, then settles behind it. */}
    {backdrop ? <Animated.View pointerEvents="none" style={[s.backdrop, {
      opacity: still ? 0.55 : at([0, shake, burst - 0.04, burst, burst + 0.09, reveal, 1], [0, 0.14, 0.22, 0.22, 1, 0.72, 0.55]),
      transform: [{ scale: still ? 1 : at([0, burst, burst + 0.1, 1], [0.72, 0.8, 1.08, 1]) },
        { translateY: still ? -10 : at([burst, 1], [12, -10]) }],
    }]}>{backdrop}</Animated.View> : null}

    {!still ? <Animated.View pointerEvents="none" testID="reward-stage-box" style={[s.crate, {
      opacity: at([0, 0.07, burst + 0.08, burst + 0.17], [0, 1, 1, 0]),
      transform: [{ scale: at([0, 0.1, burst, burst + 0.17], [0.65, 1, 1.07, 0.8]) },
        { translateY: at([burst, burst + 0.17], [0, 55]) },
        { rotate: p.interpolate({ inputRange: shakeIn, outputRange: shakeOut, extrapolate: 'clamp' }) }],
    }]}>
      <LinearGradient colors={[color.elevated, color.surface]} style={[s.boxBody, { borderColor: accent }]}>
        <View style={[s.boxBand, { backgroundColor: accent }]} />
        <View style={[s.seal, { borderColor: accent }]}><Feather name="shield" size={42} color={accent} /><Feather name="zap" size={18} color={color.warning} style={s.sealBolt} /></View>
        <Text variant="label" style={s.brand} tone="secondary">NEONSHIFT</Text>
      </LinearGradient>
      {/* A separate lid opens instead of the whole square merely fading away. */}
      <Animated.View testID="unbox-lid" style={[s.lid, { borderColor: accent, transform: [
        { translateY: at([burst, burst + 0.14], [0, -115]) },
        { translateX: at([burst, burst + 0.14], [0, 35]) },
        { rotate: p.interpolate({ inputRange: [burst, burst + 0.14], outputRange: ['0deg', '24deg'], extrapolate: 'clamp' }) },
      ] }]}><View style={[s.lidSeam, { backgroundColor: accent }]} /></Animated.View>
      <Animated.View style={[s.seamGlow, { backgroundColor: accent, opacity: at([shake, burst], [0.1, 0.9]), transform: [{ scaleX: at([shake, burst], [0.3, 1]) }] }]} />
    </Animated.View> : null}

    <Animated.View style={[s.face, {
      opacity: still ? 1 : at([0, burst + 0.1, reveal], [0, 0, 1]),
      transform: [{ scale: still ? 1 : at([burst + 0.1, reveal, reveal + 0.1], [0.5, 1.06, 1]) },
        { translateY: still ? 0 : at([burst + 0.1, reveal], [48, 0]) }],
    }]}>{children}</Animated.View>

    <View style={s.hud} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {still ? <Text variant="label" style={{ color: accent }}>{t('reveal.unbox.ready')}</Text> : <>
        {(['charge', 'awaken', 'ready'] as const).map((phase, i) => <Animated.View key={phase} style={[s.phase, { opacity: i === 0 ? at([0, shake, burst - 0.05, burst], [1, 1, 1, 0]) : i === 1 ? at([burst - 0.04, burst + 0.03, reveal - 0.04, reveal], [0, 1, 1, 0]) : at([reveal - 0.02, reveal + 0.06], [0, 1]) }]}><Text variant="label" style={{ color: accent }}>{t(`reveal.unbox.${phase}`)}</Text></Animated.View>)}
      </>}
    </View>
    {!still ? <Pressable onPress={() => settle.current()} accessibilityRole="button" accessibilityLabel={t('reveal.unbox.skip')} style={s.skip} testID="unbox-skip"><Text variant="caption" tone="secondary">{t('reveal.unbox.skip')}</Text><Feather name="chevrons-right" size={16} color={color.textSecondary} /></Pressable> : null}
  </View>;
}

const s = StyleSheet.create({
  stage: { width: '100%', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  ring: { position: 'absolute', width: 240, height: 240, borderRadius: 120, borderWidth: 1, left: '50%', top: '50%', marginLeft: -120, marginTop: -120 },
  burst: { position: 'absolute', width: 240, height: 240, borderRadius: 120, borderWidth: 5, left: '50%', top: '50%', marginLeft: -120, marginTop: -120 },
  spark: { position: 'absolute', left: '50%', top: '50%', width: 5, height: 12, borderRadius: 2 },
  crate: { position: 'absolute', width: 180, height: 158 },
  boxBody: { position: 'absolute', left: 4, right: 4, top: 30, bottom: 0, borderRadius: radius.m, borderWidth: 2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  boxBand: { position: 'absolute', width: 22, top: 0, bottom: 0, opacity: 0.12 },
  seal: { width: 70, height: 70, borderWidth: 1, borderRadius: radius.l, alignItems: 'center', justifyContent: 'center', backgroundColor: color.surface },
  sealBolt: { position: 'absolute' },
  brand: { marginTop: space.xs, letterSpacing: 2 },
  lid: { position: 'absolute', left: -4, right: -4, top: 7, height: 36, borderWidth: 2, borderRadius: radius.s, backgroundColor: color.elevated },
  lidSeam: { position: 'absolute', left: 26, right: 26, top: 9, height: 2, opacity: 0.55 },
  seamGlow: { position: 'absolute', top: 42, left: 2, right: 2, height: 3 },
  backdrop: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  face: { alignItems: 'center', justifyContent: 'center' },
  hud: { position: 'absolute', bottom: 38, left: 0, right: 0, height: 24, alignItems: 'center' },
  phase: { position: 'absolute', alignItems: 'center' },
  skip: { position: 'absolute', bottom: 0, minHeight: 44, paddingHorizontal: space.m, flexDirection: 'row', gap: space.xxs, alignItems: 'center', justifyContent: 'center' },
});
