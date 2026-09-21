import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, AppState, Easing, StyleSheet, View } from 'react-native';
import { useReduceMotion } from '@/hooks/useReduceMotion';

/** A finite ceremony: charge, reveal, then settle. All moving layers use the native driver. */
export function RewardStage({ mode, children }: { mode: 'nft' | 'up' | 'down' | 'task' | 'milestone'; children: ReactNode }) {
  const reduced = useReduceMotion();
  const p = useRef(new Animated.Value(0)).current;
  const down = mode === 'down';
  const accent = down ? '#A3AECD' : (mode === 'nft' || mode === 'milestone') ? '#FFD781' : '#68FFD2';
  const completed = useRef(false);
  useEffect(() => {
    if (reduced || completed.current || AppState.currentState === 'background' || AppState.currentState === 'inactive') {
      completed.current = true;
      p.setValue(1);
      return;
    }
    p.setValue(0);
    const animation = Animated.timing(p, { toValue: 1, duration: mode === 'task' ? 850 : down ? 1200 : 2200, easing: Easing.linear, useNativeDriver: true, isInteraction: false });
    animation.start(({ finished }) => { if (finished) completed.current = true; });
    const sub = AppState.addEventListener('change', state => {
      if (state !== 'active') { completed.current = true; animation.stop(); p.setValue(1); }
    });
    return () => { animation.stop(); sub.remove(); };
  }, [mode, reduced, p, down]);
  const interpolate = (outputRange: number[], inputRange = [0, 1]) => p.interpolate({ inputRange, outputRange });
  return <View style={[s.stage, mode === 'task' && { height: 110 }]} testID={`reward-stage-${mode}`}>
    <View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {(mode === 'task' ? [0] : [0, 1, 2]).map(i => <Animated.View key={i} style={[s.ring, mode === 'task' && { width: 76, height: 76, borderRadius: 38, top: 17, marginLeft: -38 }, { borderColor: accent, opacity: reduced ? 0.2 : interpolate([0, 0.65, 0.16], [0, 0.45, 1]), transform: [{ scale: reduced ? 1 + i * 0.16 : interpolate(down ? [1.5 + i * 0.15, 0.65 + i * 0.15] : [0.3, 1 + i * 0.16]) }, { rotate: `${i * 30}deg` }] }]} />)}
      {!reduced && Array.from({ length: mode === 'task' ? 0 : 16 }, (_, i) => {
        const angle = i * Math.PI / 8;
        return <Animated.View key={i} style={[s.spark, { backgroundColor: accent, opacity: interpolate([0, 0, 1, 0], [0, 0.3, 0.55, 1]), transform: [{ translateX: interpolate([Math.cos(angle) * 35, Math.cos(angle) * 150]) }, { translateY: interpolate(down ? [Math.sin(angle) * 100 - 60, Math.sin(angle) * 60 + 125] : [Math.sin(angle) * 35, Math.sin(angle) * 150 - 20]) }, { rotate: `${i * 37}deg` }] }]} />;
      })}
    </View>
    {mode === 'nft' && !reduced ? <Animated.View style={[s.back, { borderColor: accent, opacity: interpolate([1, 1, 0, 0], [0, 0.39, 0.4, 1]), transform: [{ perspective: 900 }, { rotateY: p.interpolate({ inputRange: [0, 0.4, 1], outputRange: ['0deg', '90deg', '90deg'] }) }] }]}><Feather name="hexagon" size={88} color={accent} /><View style={s.backSeal}><Feather name="star" size={30} color={accent} /></View></Animated.View> : null}
    <Animated.View style={[s.face, mode === 'task' && { width: 90, height: 90 }, mode === 'nft' && { borderColor: accent, borderWidth: 1, backgroundColor: '#12172C' }, { opacity: reduced ? 1 : interpolate([0, 0, 1, 1], [0, 0.39, 0.58, 1]), transform: [{ perspective: 900 }, { rotateY: mode === 'nft' && !reduced ? p.interpolate({ inputRange: [0, 0.4, 0.72, 1], outputRange: ['-90deg', '-90deg', '0deg', '0deg'] }) : '0deg' }, { scale: reduced ? 1 : interpolate(down ? [1.12, 1] : [0.7, 1.08, 1], down ? [0, 1] : [0, 0.75, 1]) }, { translateY: reduced ? 0 : interpolate(down ? [-35, 0] : [30, 0]) }] }]}>
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
  back: { position: 'absolute', width: 218, height: 266, borderRadius: 22, borderWidth: 2, backgroundColor: '#171A32', alignItems: 'center', justifyContent: 'center' },
  backSeal: { position: 'absolute' },
  shine: { position: 'absolute', top: -50, bottom: -50, width: 75 },
});
