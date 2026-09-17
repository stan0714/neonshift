import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { useReduceMotion } from '@/hooks/useReduceMotion';

/**
 * A finite ceremony: charge, reveal, then settle. All moving layers use the native driver.
 * `box`（成長盲盒，Lv.2+ 升階）：前 40% 盒子搖晃、脹大後爆開消失，鞋子接著從盒中放大進場；Reduce Motion 直接顯示鞋子。
 */
export function RewardStage({ mode, children, box = false }: { mode: 'nft' | 'up' | 'down'; children: ReactNode; box?: boolean }) {
  const reduced = useReduceMotion();
  const p = useRef(new Animated.Value(0)).current;
  const down = mode === 'down';
  const accent = down ? '#A3AECD' : mode === 'nft' ? '#FFD781' : '#68FFD2';
  useEffect(() => {
    p.setValue(reduced ? 1 : 0);
    if (reduced) return;
    const animation = Animated.timing(p, { toValue: 1, duration: down ? 1800 : 2800, easing: Easing.inOut(Easing.cubic), useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [mode, reduced, p, down]);
  const interpolate = (outputRange: number[], inputRange = [0, 1]) => p.interpolate({ inputRange, outputRange });
  return <View style={s.stage} testID={`reward-stage-${mode}`}>
    <View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {[0, 1, 2].map(i => <Animated.View key={i} style={[s.ring, { borderColor: accent, opacity: reduced ? 0.2 : interpolate([0, 0.65, 0.16], [0, 0.45, 1]), transform: [{ scale: reduced ? 1 + i * 0.16 : interpolate(down ? [1.5 + i * 0.15, 0.65 + i * 0.15] : [0.3, 1 + i * 0.16]) }, { rotate: `${i * 30}deg` }] }]} />)}
      {!reduced && Array.from({ length: 24 }, (_, i) => {
        const angle = i * Math.PI / 12;
        return <Animated.View key={i} style={[s.spark, { backgroundColor: accent, opacity: interpolate([0, 0, 1, 0], [0, 0.3, 0.55, 1]), transform: [{ translateX: interpolate([Math.cos(angle) * 35, Math.cos(angle) * 150]) }, { translateY: interpolate(down ? [Math.sin(angle) * 100 - 60, Math.sin(angle) * 60 + 125] : [Math.sin(angle) * 35, Math.sin(angle) * 150 - 20]) }, { rotate: `${i * 37}deg` }] }]} />;
      })}
    </View>
    {mode === 'nft' && !reduced ? <Animated.View style={[s.back, { borderColor: accent, opacity: interpolate([1, 1, 0, 0], [0, 0.39, 0.4, 1]), transform: [{ perspective: 900 }, { rotateY: p.interpolate({ inputRange: [0, 0.4, 1], outputRange: ['0deg', '90deg', '90deg'] }) }] }]}><Feather name="hexagon" size={88} color={accent} /><View style={s.backSeal}><Feather name="star" size={30} color={accent} /></View></Animated.View> : null}
    {box && mode === 'up' && !reduced ? (
      <Animated.View pointerEvents="none" testID="reward-stage-box" style={[s.box, { borderColor: accent, opacity: interpolate([1, 1, 1, 0], [0, 0.3, 0.42, 0.5]), transform: [
        { scale: interpolate([0.85, 1, 1.06, 1.9], [0, 0.3, 0.42, 0.5]) },
        { rotate: p.interpolate({ inputRange: [0, 0.08, 0.14, 0.2, 0.26, 0.32, 0.38, 0.42, 1], outputRange: ['0deg', '-5deg', '5deg', '-8deg', '8deg', '-11deg', '11deg', '0deg', '0deg'] }) },
      ] }]}>
        <Feather name="package" size={96} color={accent} />
      </Animated.View>
    ) : null}
    <Animated.View style={[s.face, mode === 'nft' && { borderColor: accent, borderWidth: 1, backgroundColor: '#12172C' }, { opacity: reduced ? 1 : interpolate([0, 0, 1, 1], [0, 0.39, 0.58, 1]), transform: [{ perspective: 900 }, { rotateY: mode === 'nft' && !reduced ? p.interpolate({ inputRange: [0, 0.4, 0.72, 1], outputRange: ['-90deg', '-90deg', '0deg', '0deg'] }) : '0deg' }, { scale: reduced ? 1 : interpolate(down ? [1.12, 1] : [0.7, 1.08, 1], down ? [0, 1] : [0, 0.75, 1]) }, { translateY: reduced ? 0 : interpolate(down ? [-35, 0] : [30, 0]) }] }]}>
      <LinearGradient colors={down ? ['#32395155', '#11182700'] : [`${accent}33`, '#8D64FF22', '#11182700']} style={StyleSheet.absoluteFill} />
      {children}
      {mode === 'nft' && !reduced ? <Animated.View pointerEvents="none" style={[s.shine, { opacity: interpolate([0, 0, 0.7, 0], [0, 0.6, 0.78, 1]), transform: [{ translateX: interpolate([-220, 280]) }, { rotate: '24deg' }] }]}><LinearGradient colors={['#FFFFFF00', '#FFFFFF99', '#FFFFFF00']} style={StyleSheet.absoluteFill} /></Animated.View> : null}
    </Animated.View>
  </View>;
}
const s = StyleSheet.create({
  stage: { height: 310, width: '100%', alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 220, height: 220, borderRadius: 110, borderWidth: 1, top: 45, left: '50%', marginLeft: -110 },
  spark: { position: 'absolute', left: '50%', top: '50%', width: 3, height: 10, borderRadius: 2 },
  face: { width: 218, height: 266, borderRadius: 22, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', padding: 12 },
  box: { position: 'absolute', width: 168, height: 168, borderRadius: 28, borderWidth: 2, backgroundColor: '#171A32', alignItems: 'center', justifyContent: 'center' },
  back: { position: 'absolute', width: 218, height: 266, borderRadius: 22, borderWidth: 2, backgroundColor: '#171A32', alignItems: 'center', justifyContent: 'center' },
  backSeal: { position: 'absolute' },
  shine: { position: 'absolute', top: -50, bottom: -50, width: 75 },
});
