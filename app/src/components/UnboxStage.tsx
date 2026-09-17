import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { useReduceMotion } from '@/hooks/useReduceMotion';

/**
 * 成長盲盒拆盒時間軸（Style 25.2）。單一 Animated.Value 0→1 走完 `total`，各層以正規化時間切相位：
 *   0–0.29  蓄力：盒子浮現、微幅呼吸、光環自外向內收攏
 *   0.29–0.5 搖晃：越晃越大、盒縫漏光漸亮（輕震兩次）
 *   0.5–0.57 爆開：盒子脹大消散、白光一閃、粒子與光環外擴（重震）
 *   0.5–0.75 揭曉：鞋子從盒中放大進場、光束升起
 *   0.75–1   定格：光束慢轉，鞋子交回 ShoeHero 自行擺動（展示）
 */
export const UNBOX_TIMELINE = { total: 5600, shakeStart: 1600, shakeMid: 2200, burst: 2800, revealed: 3400 } as const;

const T = (ms: number) => ms / UNBOX_TIMELINE.total;
const SHAKE_FRAMES = 12;

type Props = {
  /** 目標鞋階主色（光環、盒子、粒子） */
  accent: string;
  /** 舞台高度；鞋子由外層依寬度決定尺寸 */
  height: number;
  /** 拆盒結束（revealed）時通知外層，讓文字內容進場、鞋子開始擺動 */
  onRevealed?: () => void;
  /** 鞋子後方的背景層（物種背影剪影）：爆開後浮現、微微上升 */
  backdrop?: ReactNode;
  children: ReactNode;
};

export function UnboxStage({ accent, height, onRevealed, backdrop, children }: Props) {
  const reduced = useReduceMotion();
  const p = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    p.setValue(reduced ? 1 : 0);
    if (reduced) {
      onRevealed?.();
      return;
    }
    const animation = Animated.timing(p, { toValue: 1, duration: UNBOX_TIMELINE.total, easing: Easing.linear, useNativeDriver: true });
    animation.start();
    const timer = setTimeout(() => onRevealed?.(), UNBOX_TIMELINE.revealed);
    return () => {
      animation.stop();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, p]);

  const at = (inputRange: number[], outputRange: number[]) => p.interpolate({ inputRange, outputRange, extrapolate: 'clamp' });
  const burst = T(UNBOX_TIMELINE.burst);
  const shakeStart = T(UNBOX_TIMELINE.shakeStart);
  const revealed = T(UNBOX_TIMELINE.revealed);

  // 搖晃：從 shakeStart 到 burst 之間 12 幀左右交替，幅度由 3° 漸增到 12°
  const shakeIn: number[] = [0, shakeStart];
  const shakeOut: string[] = ['0deg', '0deg'];
  for (let i = 1; i <= SHAKE_FRAMES; i += 1) {
    const f = i / SHAKE_FRAMES;
    shakeIn.push(shakeStart + (burst - shakeStart) * f);
    shakeOut.push(i === SHAKE_FRAMES ? '0deg' : `${(i % 2 ? -1 : 1) * (3 + 9 * f)}deg`);
  }
  shakeIn.push(1);
  shakeOut.push('0deg');

  const stageStyle = { height };
  if (reduced) {
    return (
      <View style={[s.stage, stageStyle]} testID="unbox-stage">
        <View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {[0, 1, 2].map((i) => <View key={i} style={[s.ring, { borderColor: accent, opacity: 0.18, transform: [{ scale: 1 + i * 0.18 }] }]} />)}
        </View>
        {backdrop ? <View style={s.backdrop}>{backdrop}</View> : null}
        <View style={s.face}>{children}</View>
      </View>
    );
  }

  return (
    <View style={[s.stage, stageStyle]} testID="unbox-stage">
      <View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {/* 背景光暈：三層同心圓模擬徑向衰減（expo-linear-gradient 無徑向）；蓄力時暗、爆開後亮起並常駐 */}
        {[520, 380, 240].map((d, i) => (
          <Animated.View key={d} style={[s.glow, { width: d, height: d, borderRadius: d / 2, marginTop: -d / 2, marginLeft: -d / 2, backgroundColor: accent, opacity: at([0, shakeStart, burst, burst + 0.06, 1], [0.02, 0.04, 0.05, 0.14, 0.08].map((v) => v * (1 + i * 0.5))) }]} />
        ))}
        {/* 光束：爆開後從底座升起並慢轉 */}
        {[-28, 0, 28].map((deg, i) => (
          <Animated.View
            key={deg}
            style={[s.beam, { opacity: at([0, burst, burst + 0.08, 1], [0, 0, 0.55 - i * 0.12, 0.35]), transform: [
              { translateY: at([burst, burst + 0.12], [120, 0]) },
              { rotate: p.interpolate({ inputRange: [burst, 1], outputRange: [`${deg}deg`, `${deg + (i - 1) * 10}deg`], extrapolate: 'clamp' }) },
              { scaleY: at([burst, burst + 0.15], [0.2, 1]) },
            ] }]}
          >
            <LinearGradient colors={[`${accent}00`, `${accent}66`, `${accent}00`]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
          </Animated.View>
        ))}
        {/* 光環：蓄力自外向內收攏，爆開後外擴淡出 */}
        {[0, 1, 2].map((i) => (
          <Animated.View
            key={i}
            style={[s.ring, { borderColor: accent, opacity: at([0, shakeStart, burst, burst + 0.15, 1], [0, 0.35, 0.45, 0.6, 0.14]), transform: [
              { scale: at([0, shakeStart, burst, burst + 0.2], [1.9 + i * 0.2, 1.05 + i * 0.1, 0.95 + i * 0.1, 1.35 + i * 0.22]) },
              { rotate: `${i * 30}deg` },
            ] }]}
          />
        ))}
        {/* 粒子：爆開時自盒心射出 */}
        {Array.from({ length: 32 }, (_, i) => {
          const angle = (i * Math.PI) / 16;
          const reach = 150 + (i % 3) * 40;
          return (
            <Animated.View
              key={i}
              style={[s.spark, { backgroundColor: accent, opacity: at([0, burst, burst + 0.05, burst + 0.3], [0, 0, 1, 0]), transform: [
                { translateX: at([burst, burst + 0.3], [Math.cos(angle) * 30, Math.cos(angle) * reach]) },
                { translateY: at([burst, burst + 0.3], [Math.sin(angle) * 30, Math.sin(angle) * reach - 30]) },
                { rotate: `${i * 37}deg` },
                { scale: at([burst, burst + 0.3], [1.4, 0.6]) },
              ] }]}
            />
          );
        })}
        {/* 白光一閃：圓形自盒心擴散，避免看起來像矩形 */}
        <Animated.View style={[s.flash, { opacity: at([0, burst, burst + 0.03, burst + 0.1], [0, 0, 0.9, 0]), transform: [{ scale: at([burst, burst + 0.1], [0.3, 1.6]) }] }]} />
      </View>

      {/* 背影剪影：爆開後從盒心浮現、放大並緩緩上升，停在鞋子後方 */}
      {backdrop ? (
        <Animated.View pointerEvents="none" style={[s.backdrop, { opacity: at([0, burst, burst + 0.25], [0, 0, 1]), transform: [
          { scale: at([burst, burst + 0.3], [0.6, 1]) },
          { translateY: at([burst, 1], [30, -12]) },
        ] }]}>
          {backdrop}
        </Animated.View>
      ) : null}

      {/* 盒子：浮現 → 呼吸 → 搖晃（漏光） → 爆開消散 */}
      <Animated.View
        pointerEvents="none"
        testID="reward-stage-box"
        style={[s.box, { borderColor: accent, opacity: at([0, 0.05, burst, burst + 0.06], [0, 1, 1, 0]), transform: [
          { scale: at([0, 0.06, 0.18, shakeStart, burst, burst + 0.07], [0.6, 1, 1.03, 1, 1.1, 2.4]) },
          { rotate: p.interpolate({ inputRange: shakeIn, outputRange: shakeOut, extrapolate: 'clamp' }) },
        ] }]}
      >
        <Feather name="package" size={120} color={accent} />
        {/* 盒縫漏光：搖晃期間漸亮 */}
        {(['top', 'bottom', 'left', 'right'] as const).map((edge) => (
          <Animated.View key={edge} style={[s.leak, s[`leak_${edge}`], { backgroundColor: accent, opacity: at([shakeStart, burst], [0, 1]) }]} />
        ))}
      </Animated.View>

      {/* 鞋子：從盒心放大進場 */}
      <Animated.View
        style={[s.face, { opacity: at([0, burst, burst + 0.08], [0, 0, 1]), transform: [
          { scale: at([burst, revealed, revealed + 0.1], [0.45, 1.06, 1]) },
          { translateY: at([burst, revealed], [36, 0]) },
        ] }]}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  stage: { width: '100%', alignItems: 'center', justifyContent: 'center', overflow: 'visible' },
  glow: { position: 'absolute', left: '50%', top: '50%' },
  beam: { position: 'absolute', width: 90, height: 460, left: '50%', marginLeft: -45, top: '50%', marginTop: -300 },
  ring: { position: 'absolute', width: 260, height: 260, borderRadius: 130, borderWidth: 1, left: '50%', top: '50%', marginLeft: -130, marginTop: -130 },
  spark: { position: 'absolute', left: '50%', top: '50%', width: 4, height: 12, borderRadius: 2 },
  flash: { position: 'absolute', width: 360, height: 360, borderRadius: 180, left: '50%', top: '50%', marginLeft: -180, marginTop: -180, backgroundColor: '#FFFFFF' },
  box: { position: 'absolute', width: 200, height: 200, borderRadius: 32, borderWidth: 2, backgroundColor: '#171A32', alignItems: 'center', justifyContent: 'center' },
  leak: { position: 'absolute', borderRadius: 2 },
  leak_top: { top: -2, left: 40, right: 40, height: 3 },
  leak_bottom: { bottom: -2, left: 40, right: 40, height: 3 },
  leak_left: { left: -2, top: 40, bottom: 40, width: 3 },
  leak_right: { right: -2, top: 40, bottom: 40, width: 3 },
  backdrop: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  face: { alignItems: 'center', justifyContent: 'center' },
});
