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
export const WORKOUT_FEEDBACK_MS = 1400;

/** Finite decorative motion. No timing, persistence, navigation or input ownership. */
export function WorkoutActionArt({ mode, action, children }: { mode: WorkoutMode; action: WorkoutAction; children?: ReactNode }) {
  const reduced = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const { accent, icon } = profileOf(mode);
  const paused = action === 'pause';
  const finished = action === 'finish';
  useEffect(() => {
    progress.setValue(reduced ? 1 : 0);
    if (reduced) return;
    const animation = Animated.timing(progress, { toValue: 1, duration: action === 'start' ? 750 : 1000, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [progress, reduced, action, mode]);
  const value = (from: number, to: number) => reduced ? to : progress.interpolate({ inputRange: [0, 1], outputRange: [from, to] });
  return <View style={styles.art} testID={`workout-art-${mode}-${action}`}>
    <View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {mode === 'walk' ? [0, 1, 2].map(i => <Animated.View key={i} style={[styles.ring, { borderColor: accent, opacity: 0.22 + i * 0.08, transform: [{ scale: value(paused ? 1.3 : 0.45, (paused ? 0.7 : 1) + i * 0.13) }] }]} />) : null}
      {mode === 'walk' ? [0, 1, 2, 3].map(i => <Animated.View key={`step${i}`} style={[styles.step, { backgroundColor: accent, left: 54 + i * 34, top: 177 + (i % 2) * 13, opacity: value(0, 0.5), transform: [{ translateY: value(paused ? -12 : 20, 0) }, { rotate: '-25deg' }] }]} />) : null}
      {mode === 'brisk' ? [0, 1, 2].map(i => <Animated.View key={i} style={[styles.chevron, { left: 24 + i * 68, borderColor: accent, opacity: value(0.1, paused ? 0.25 : 0.6), transform: [{ translateX: value(paused ? 24 : -32, 0) }, { rotate: '-45deg' }, { scale: value(paused ? 1.2 : 0.65, 1) }] }]} />) : null}
      {mode === 'run' ? Array.from({ length: 8 }, (_, i) => <Animated.View key={i} style={[styles.speed, { top: 32 + i * 26, left: i % 2 ? 150 : 8, width: 38 + (i % 3) * 15, backgroundColor: accent, opacity: value(0.8, paused ? 0.15 : 0.45), transform: [{ translateX: value(paused ? 0 : -90, paused ? -16 : 12) }, { scaleX: value(paused ? 1.6 : 0.3, paused ? 0.4 : 1) }, { rotate: '-18deg' }] }]} />) : null}
      {finished ? Array.from({ length: 10 }, (_, i) => {
        const a = i * Math.PI / 5;
        return <Animated.View key={`spark${i}`} style={[styles.spark, { backgroundColor: accent, opacity: value(0, 0.7), transform: [{ translateX: value(0, Math.cos(a) * 110) }, { translateY: value(0, Math.sin(a) * 110) }, { rotate: `${i * 36}deg` }] }]} />;
      }) : null}
    </View>
    <Animated.View style={[styles.seal, { borderColor: accent, backgroundColor: `${accent}15`, transform: [{ scale: value(paused ? 1.12 : 0.75, 1) }, { translateY: value(finished ? 20 : 0, 0) }] }]}>
      {children ?? <Feather name={finished ? 'award' : paused ? 'pause' : icon} size={64} color={accent} />}
    </Animated.View>
  </View>;
}

/** Non-blocking, self-dismissed feedback, mounted only for an actual action. */
export function WorkoutActionFeedback({ mode, action }: { mode: WorkoutMode; action: WorkoutAction }) {
  const { t } = useT();
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), WORKOUT_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [mode, action]);
  if (!visible) return null;
  return <View pointerEvents="none" style={styles.feedback} testID={`workout-feedback-${action}`}>
    <WorkoutActionArt mode={mode} action={action} />
    <Text variant="heading2" style={styles.title} accessibilityLiveRegion="polite">{t(`rec.motion.${mode}.${action === 'resume' ? 'start' : action}` as TKey)}</Text>
    {action === 'finish' ? <Text variant="bodySmall" tone="secondary" style={styles.title}>{t('rec.motion.saved')}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
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
