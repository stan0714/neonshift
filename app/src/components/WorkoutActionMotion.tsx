import Svg, { Circle, Path } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { profileOf } from '@/domain/modes';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { useT, type TKey } from '@/i18n';
import type { WorkoutMode } from '@/state/workoutPrefsStore';
import { color, radius, space, Text } from '@/theme';

/**
 * 三模式動作回饋（Style 23.4）：開始倒數、暫停／繼續、結束時播一次有限長度的模式專屬動畫（走路＝漣漪＋腳步、健走＝箭頭、跑步＝速度線；結束加火花）。
 * 只做裝飾：不擁有計時、持久化、導航或觸控（`pointerEvents="none"`），減少動態時顯示靜態終態；穩定記錄中不循環。
 */
export type WorkoutAction = 'start' | 'pause' | 'resume' | 'finish';
export const WORKOUT_FEEDBACK_MS = 2200;
const MOTION_DURATION = { walk: 1400, brisk: 1100, run: 900 } as const;

/** Three drawn poses, so mode identity survives monochrome and reduced motion. */
function SportFigure({ mode, tint }: { mode: WorkoutMode; tint: string }) {
  const poses = {
    walk: { head: [49, 20], body: 'M47 35 L44 63 M46 42 L30 55 L20 53 M47 41 L60 54 L72 49 M44 63 L31 83 L27 100 M44 63 L58 82 L73 92' },
    brisk: { head: [56, 18], body: 'M54 33 L44 62 M51 39 L32 44 L27 33 M51 40 L64 56 L77 46 M44 62 L23 78 L15 99 M44 62 L60 78 L79 81' },
    run: { head: [65, 19], body: 'M59 34 L43 57 M55 38 L35 38 L27 25 M55 38 L70 52 L83 42 M43 57 L22 68 L9 57 M43 57 L62 68 L56 92 L71 96' },
  }[mode];
  return <Svg width={96} height={110} viewBox="0 0 100 115" testID={`workout-figure-${mode}`}>
    <Circle cx={poses.head[0]} cy={poses.head[1]} r={9} fill={tint} />
    <Path d={poses.body} fill="none" stroke={tint} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>;
}

function FinishEmblem({ mode, tint }: { mode: WorkoutMode; tint: string }) {
  return <Svg width={124} height={124} viewBox="0 0 124 124" testID={`workout-emblem-${mode}`}>
    {mode === 'walk' ? <>
      <Path d="M30 95 Q7 64 31 34 M94 95 Q117 64 93 34" fill="none" stroke={tint} strokeWidth={2} />
      {[0, 1, 2].map(i => <Path key={i} d={`M${24 - i * 2} ${76 - i * 15} q-16 -3 -10 -17 q16 0 10 17 M${100 + i * 2} ${76 - i * 15} q16 -3 10 -17 q-16 0 -10 17`} fill={tint} opacity={0.45 + i * 0.2} />)}
      <Circle cx={62} cy={48} r={14} fill={tint} opacity={0.8} />
      <Path d="M48 94 Q85 78 56 69 Q43 65 49 60" fill="none" stroke={tint} strokeWidth={5} strokeLinecap="round" />
    </> : mode === 'brisk' ? <>
      <Path d="M62 12 L101 34 L101 84 L62 110 L23 84 L23 34 Z" fill="none" stroke={tint} strokeWidth={3} />
      <Path d="M39 55 L62 35 L85 55 M39 77 L62 57 L85 77" fill="none" stroke={tint} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" />
    </> : <>
      <Path d="M29 109 L37 22 M38 24 Q61 8 91 24 L87 66 Q63 50 34 66" fill="none" stroke={tint} strokeWidth={4} strokeLinejoin="round" />
      {[0, 1, 2].map(i => <Path key={i} d={`M${40 + i * 16} 26 l8 0 -2 14 -8 0 Z M${46 + i * 16} 42 l8 0 -2 14 -8 0 Z`} fill={tint} />)}
    </>}
  </Svg>;
}

/** Finite decorative motion. No timing, persistence, navigation or input ownership. */
export function WorkoutActionArt({ mode, action, children }: { mode: WorkoutMode; action: WorkoutAction; children?: ReactNode }) {
  const reduced = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const { accent } = profileOf(mode);
  const paused = action === 'pause';
  const finished = action === 'finish';
  useEffect(() => {
    progress.setValue(reduced ? 1 : 0);
    if (reduced) return;
    const animation = Animated.timing(progress, { toValue: 1, duration: action === 'start' ? 750 : paused ? 650 : MOTION_DURATION[mode], easing: Easing.out(Easing.cubic), useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [progress, reduced, action, mode, paused]);
  const value = (from: number, to: number) => reduced ? to : progress.interpolate({ inputRange: [0, 1], outputRange: [from, to] });
  const phase = (values: number[], ranges = [0, 0.35, 0.75, 1]) => reduced ? values[values.length - 1] : progress.interpolate({ inputRange: ranges, outputRange: values });
  return <View style={styles.art} testID={`workout-art-${mode}-${action}`}>
    <View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={[styles.aura, { opacity: phase([0, 0.35, 0.22, paused ? 0.08 : 0.18]), transform: [{ scale: value(paused ? 1.1 : 0.4, 1) }] }]}>
        <LinearGradient colors={[`${accent}66`, `${accent}00`]} style={StyleSheet.absoluteFill} />
      </Animated.View>
      {mode === 'walk' ? [0, 1, 2].map(i => <Animated.View key={i} style={[styles.ring, { borderColor: accent, opacity: 0.22 + i * 0.08, transform: [{ scale: value(paused ? 1.3 : 0.45, (paused ? 0.7 : 1) + i * 0.13) }] }]} />) : null}
      {mode === 'walk' ? [0, 1, 2, 3].map(i => <Animated.View key={`step${i}`} style={[styles.step, { backgroundColor: accent, left: 54 + i * 34, top: 177 + (i % 2) * 13, opacity: phase([0, 0, 0.7, 0.4], [0, i * 0.12 + 0.05, i * 0.12 + 0.3, 1]), transform: [{ translateY: value(paused ? -12 : 20, 0) }, { rotate: '-25deg' }] }]} />) : null}
      {mode === 'brisk' ? [0, 1, 2].map(i => <Animated.View key={i} style={[styles.chevron, { left: 24 + i * 68, borderColor: accent, opacity: value(0.1, paused ? 0.25 : 0.6), transform: [{ translateX: value(paused ? 24 : -32, 0) }, { rotate: '-45deg' }, { scale: value(paused ? 1.2 : 0.65, 1) }] }]} />) : null}
      {mode === 'run' ? Array.from({ length: 8 }, (_, i) => <Animated.View key={i} style={[styles.speed, { top: 32 + i * 26, left: i % 2 ? 150 : 8, width: 38 + (i % 3) * 15, backgroundColor: accent, opacity: value(0.8, paused ? 0.15 : 0.45), transform: [{ translateX: value(paused ? 0 : -90, paused ? -16 : 12) }, { scaleX: value(paused ? 1.6 : 0.3, paused ? 0.4 : 1) }, { rotate: '-18deg' }] }]} />) : null}
      {finished && !reduced ? Array.from({ length: 10 }, (_, i) => {
        const a = i * Math.PI / 5;
        return <Animated.View key={`spark${i}`} style={[styles.spark, { backgroundColor: accent, opacity: phase([0, 0.8, 0.5, 0]), transform: [{ translateX: value(0, Math.cos(a) * 110) }, { translateY: value(0, Math.sin(a) * 110) }, { rotate: `${i * 36}deg` }] }]} />;
      }) : null}
    </View>
    <Animated.View style={[styles.seal, { borderColor: accent, backgroundColor: `${accent}15`, transform: [{ scale: value(paused ? 1.12 : 0.75, 1) }, { translateY: value(finished ? 20 : 0, 0) }] }]}>
      <LinearGradient colors={[`${accent}20`, `${accent}00`]} style={[StyleSheet.absoluteFill, { borderRadius: 75 }]} />
      {children ?? (finished ? <Animated.View style={{ opacity: phase([0, 0.3, 1, 1]), transform: [{ scale: phase([0.5, 0.9, 1.06, 1]) }] }}><FinishEmblem mode={mode} tint={accent} /></Animated.View> : <Animated.View style={{ transform: [{ translateX: value(paused ? 10 : -18, 0) }, { translateY: phase([0, mode === 'walk' ? -3 : -9, 0, 0]) }] }}><SportFigure mode={mode} tint={accent} /></Animated.View>)}
      {!children && paused ? <View style={[styles.actionBadge, { backgroundColor: accent }]}><Feather name="pause" size={20} color={color.canvas} /></View> : null}
    </Animated.View>
    {finished && mode === 'run' ? <Animated.View pointerEvents="none" style={[styles.finishTape, { opacity: phase([0, 1, 0.65, 0]), transform: [{ translateY: value(0, 38) }, { scaleX: value(0.4, 1.25) }, { rotate: '-12deg' }] }]}><LinearGradient colors={[`${accent}00`, accent, `${accent}00`]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} /></Animated.View> : null}
  </View>;
}

/** Non-blocking, self-dismissed feedback, mounted only for an actual action. */
export function WorkoutActionFeedback({ mode, action }: { mode: WorkoutMode; action: WorkoutAction }) {
  const { t } = useT();
  const [visible, setVisible] = useState(true);
  const reduced = useReduceMotion();
  const exitOpacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    setVisible(true);
    exitOpacity.setValue(1);
    const fade = Animated.timing(exitOpacity, { toValue: 0, duration: 220, useNativeDriver: true });
    const fadeTimer = setTimeout(() => { if (!reduced) fade.start(); }, WORKOUT_FEEDBACK_MS - 220);
    const timer = setTimeout(() => setVisible(false), WORKOUT_FEEDBACK_MS);
    return () => { clearTimeout(timer); clearTimeout(fadeTimer); fade.stop(); };
  }, [mode, action, reduced, exitOpacity]);
  if (!visible) return null;
  return <Animated.View pointerEvents="none" style={[styles.feedback, { opacity: exitOpacity }]} testID={`workout-feedback-${action}`}>
    <View style={styles.modeTag}><View style={[styles.modeDot, { backgroundColor: profileOf(mode).accent }]} /><Text variant="label" style={{ color: profileOf(mode).accent }}>{t(`wo.mode.${mode}` as TKey)}</Text></View>
    <WorkoutActionArt mode={mode} action={action} />
    <Text variant="heading2" style={styles.title} accessibilityLiveRegion="polite">{t(`rec.motion.${mode}.${action}` as TKey)}</Text>
    {action === 'finish' ? <Text variant="bodySmall" tone="secondary" style={styles.title}>{t('rec.motion.saved')}</Text> : null}
  </Animated.View>;
}

const styles = StyleSheet.create({
  modeTag: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  modeDot: { width: 6, height: 6, borderRadius: 3 },
  aura: { position: 'absolute', width: 230, height: 230, top: 10, left: 10, borderRadius: 115, overflow: 'hidden' },
  actionBadge: { position: 'absolute', right: -2, bottom: 2, width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  finishTape: { position: 'absolute', left: 5, right: 5, top: 150, height: 12 },
  art: { width: 250, height: 250, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 184, height: 184, left: 33, top: 33, borderRadius: 92, borderWidth: 2 },
  step: { position: 'absolute', width: 9, height: 20, borderRadius: 6 },
  chevron: { position: 'absolute', top: 65, width: 78, height: 120, borderRightWidth: 3, borderBottomWidth: 3 },
  speed: { position: 'absolute', height: 3, borderRadius: 3 },
  spark: { position: 'absolute', top: 122, left: 122, width: 5, height: 9, borderRadius: 2 },
  seal: { width: 150, height: 150, borderRadius: 75, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  feedback: { position: 'absolute', zIndex: 20, top: 80, left: space.m, right: space.m, alignItems: 'center', paddingVertical: space.s, paddingHorizontal: space.m, borderRadius: radius.xl, backgroundColor: color.surface, borderWidth: 1, borderColor: color.borderSubtle },
  title: { textAlign: 'center', marginBottom: space.xs },
});
