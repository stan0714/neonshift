import * as Haptics from 'expo-haptics';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Linking, Modal, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/Button';
import { ShoeHero } from '@/components/ShoeHero';
import { APP_CONFIG } from '@/config/app';
import { SHOE_PROGRESSION } from '@/config/shoeProgression';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { useDashboardStore } from '@/state/dashboardStore';
import { useLevelRevealStore } from '@/state/levelRevealStore';
import { color, motion, radius, space, Text } from '@/theme';

/**
 * 進化 reveal（PG-A-17，Style 12／15／16.2）：舊鞋淡出、新鞋放大進場，motion.celebration 只播一次，
 * success haptic 一次；Reduce Motion 時直接顯示新鞋。掛在 tabs 層，觀察 dashboardStore.profile.shoeLevel。
 */
export function EvolutionReveal() {
  const level = useDashboardStore((s) => s.profile?.shoeLevel ?? null);
  const reveal = useLevelRevealStore();
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (level) void reveal.observe(level as 1 | 2 | 3 | 4 | 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level]);

  useEffect(() => {
    if (!reveal.pending) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    progress.setValue(reduceMotion ? 1 : 0);
    if (reduceMotion) return;
    Animated.timing(progress, { toValue: 1, duration: motion.celebration, easing: Easing.bezier(...motion.easing), useNativeDriver: true }).start();
  }, [reveal.pending, reduceMotion, progress]);

  const p = reveal.pending;
  if (!p) return null;
  const stage = SHOE_PROGRESSION.stages[p.to - 1];
  const explorer = reveal.lastTxSignature ? `https://explorer.solana.com/tx/${reveal.lastTxSignature}?cluster=${APP_CONFIG.cluster}` : null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => void reveal.acknowledge()} statusBarTranslucent>
      <Pressable style={styles.scrim} onPress={() => void reveal.acknowledge()} accessibilityLabel="Dismiss" testID="reveal-scrim" />
      <View style={styles.card} accessibilityViewIsModal testID="evolution-reveal">
        <Text variant="label" tone="mint" uppercase>
          Gear evolved
        </Text>
        <View style={styles.stage}>
          <Animated.View style={[StyleSheet.absoluteFill, styles.center, { opacity: progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0, 0] }), transform: [{ scale: progress.interpolate({ inputRange: [0, 0.5], outputRange: [1, 0.85], extrapolate: 'clamp' }) }] }]}>
          <ShoeHero level={p.from} size={220} active={false} badge={false} />
          </Animated.View>
          <Animated.View style={[styles.center, { opacity: progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0, 1] }), transform: [{ scale: progress.interpolate({ inputRange: [0.5, 1], outputRange: [0.8, 1], extrapolate: 'clamp' }) }] }]}>
            <ShoeHero level={p.to} size={220} badge={false} />
          </Animated.View>
        </View>
        <Text variant="heading2" style={styles.title}>
          Lv.{p.to} · {stage.name}
        </Text>
        <Text variant="bodySmall" tone="secondary" style={styles.body}>
          {stage.detail}. Your multiplier follows your level — no fees, nothing to burn. Claim the Lv.{p.to} collectible in Gear.
        </Text>
        <Button label="Nice" onPress={() => void reveal.acknowledge()} style={styles.btn} testID="reveal-ok" />
        {explorer ? (
          <Pressable onPress={() => void Linking.openURL(explorer)} accessibilityRole="link" style={styles.link} testID="reveal-tx">
            <Text variant="bodySmall" tone="cyan">
              View transaction
            </Text>
          </Pressable>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: color.scrim },
  card: { position: 'absolute', left: space.l, right: space.l, top: '18%', backgroundColor: color.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: color.borderActive, padding: space.l, alignItems: 'center' },
  stage: { width: 220, height: 176, marginTop: space.s },
  center: { alignItems: 'center', justifyContent: 'center' },
  title: { marginTop: space.s },
  body: { marginTop: space.xs, textAlign: 'center' },
  btn: { alignSelf: 'stretch', marginTop: space.m },
  link: { marginTop: space.s, minHeight: 48, justifyContent: 'center' },
});
