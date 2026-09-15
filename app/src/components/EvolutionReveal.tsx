import * as Haptics from 'expo-haptics';
import { useEffect } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet } from 'react-native';

import { Button } from '@/components/Button';
import { ShoeHero } from '@/components/ShoeHero';
import { APP_CONFIG } from '@/config/app';
import { stageDetail, stageName } from '@/domain/collectibles';
import { RewardStage } from './RewardStage';
import { useDashboardStore } from '@/state/dashboardStore';
import { useLevelRevealStore } from '@/state/levelRevealStore';
import { color, radius, space, Text } from '@/theme';
import { useT } from '@/i18n';

/** Observe active gear changes and present a dedicated promotion or demotion ceremony. */
export function EvolutionReveal() {
  const { t } = useT();
  const level = useDashboardStore((s) => s.profile?.coreLevel ?? s.profile?.shoeLevel ?? null);
  const reveal = useLevelRevealStore();

  useEffect(() => {
    if (level) void reveal.observe(level as 1 | 2 | 3 | 4 | 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level]);

  useEffect(() => {
    if (!reveal.pending) return;
    void Haptics.notificationAsync(reveal.pending.to > reveal.pending.from ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning)?.catch(() => {});
  }, [reveal.pending]);

  const p = reveal.pending;
  if (!p) return null;
  const explorer = reveal.lastTxSignature ? `https://explorer.solana.com/tx/${reveal.lastTxSignature}?cluster=${APP_CONFIG.cluster}` : null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => void reveal.acknowledge()} statusBarTranslucent>
      <Pressable style={styles.scrim} onPress={() => void reveal.acknowledge()} accessibilityLabel={t('common.dismiss')} testID="reveal-scrim" />
      <ScrollView contentContainerStyle={styles.card} accessibilityViewIsModal testID="evolution-reveal">
        <Text variant="label" tone="mint" uppercase>
          {t(p.to > p.from ? 'common.gearEvolved' : 'reveal.downTitle')}
        </Text>
        <RewardStage key={`${p.from}-${p.to}`} mode={p.to > p.from ? 'up' : 'down'}>
          <Text variant="label">Lv.{p.from} → Lv.{p.to}</Text>
          <ShoeHero level={p.to} size={200} active={false} badge={false} />
        </RewardStage>
        <Text variant="heading2" style={styles.title}>
          {t('common.lvDot', { n: p.to })} · {stageName(t, p.to)}
        </Text>
        <Text variant="bodySmall" tone="secondary" style={styles.body}>
          {p.to > p.from ? t('reveal.body', { detail: stageDetail(t, p.to), level: p.to }) : t('reveal.downBody')}
        </Text>
        <Button label={t(p.to > p.from ? 'common.nice' : 'common.dismiss')} onPress={() => void reveal.acknowledge()} style={styles.btn} testID="reveal-ok" />
        {explorer ? (
          <Pressable onPress={() => void Linking.openURL(explorer)} accessibilityRole="link" style={styles.link} testID="reveal-tx">
            <Text variant="bodySmall" tone="cyan">
              {t('common.viewTransaction')}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: color.scrim },
  card: { flexGrow: 1, justifyContent: 'center', margin: space.l, backgroundColor: color.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: color.borderActive, padding: space.l, alignItems: 'center' },
  stage: { width: 220, height: 176, marginTop: space.s },
  center: { alignItems: 'center', justifyContent: 'center' },
  title: { marginTop: space.s },
  body: { marginTop: space.xs, textAlign: 'center' },
  btn: { alignSelf: 'stretch', marginTop: space.m },
  link: { marginTop: space.s, minHeight: 48, justifyContent: 'center' },
});
