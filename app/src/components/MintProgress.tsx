import { Feather } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Animated, AppState, StyleSheet, View } from 'react-native';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { useT } from '@/i18n';
import { color, radius, space, Text } from '@/theme';

export type MintPhase = 'server' | 'approved' | 'wallet' | 'confirming';
const phases: MintPhase[] = ['server', 'approved', 'wallet', 'confirming'];
const icons = ['shield', 'check-circle', 'credit-card', 'upload-cloud'] as const;
/** No simulated percentages: each transition comes from the API or wallet response. */
export function MintProgress({ phase }: { phase: MintPhase | null }) {
  const { t } = useT();
  const reduce = useReduceMotion();
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.4, duration: 650, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: true }),
    ]));
    const update = () => {
      animation.stop(); pulse.setValue(1);
      if (phase && phase !== 'approved' && !reduce && AppState.currentState === 'active') animation.start();
    };
    update();
    const sub = AppState.addEventListener('change', update);
    return () => { animation.stop(); sub.remove(); };
  }, [phase, reduce, pulse]);
  if (!phase) return null;
  const index = phases.indexOf(phase);
  return <View style={styles.card} accessibilityLiveRegion="polite" testID={`mint-progress-${phase}`}>
    <View style={styles.steps}>{phases.map((step, i) => <Animated.View key={step} style={[styles.step, { opacity: i === index ? pulse : i < index ? 1 : 0.3 }]}><Feather name={i < index ? 'check' : icons[i]} size={22} color={i <= index ? color.mint : color.textMuted} /></Animated.View>)}</View>
    <Text variant="title">{t(`mint.flow.${phase}`)}</Text>
    <Text variant="bodySmall" tone="secondary">{t(`mint.flow.${phase}.body`)}</Text>
  </View>;
}
const styles = StyleSheet.create({ card: { padding: space.m, gap: space.s, marginVertical: space.s, backgroundColor: color.elevated, borderRadius: radius.m }, steps: { flexDirection: 'row', gap: space.s }, step: { flex: 1, alignItems: 'center', padding: space.s, borderBottomWidth: 2, borderColor: color.mint } });
