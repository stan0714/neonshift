import * as Haptics from 'expo-haptics';
import { useEffect } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { ShoeStory } from '@/components/ShoeStory';
import { ShoeHero } from '@/components/ShoeHero';
import { APP_CONFIG } from '@/config/app';
import { wildlifeOf } from '@/config/shoeCollection';
import type { ShoeLevel } from '@/config/shoeProgression';
import { stageDetail, stageName } from '@/domain/collectibles';
import { RewardStage } from './RewardStage';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { useDashboardStore } from '@/state/dashboardStore';
import { useLevelRevealStore } from '@/state/levelRevealStore';
import { color, radius, space, Text } from '@/theme';
import { useT } from '@/i18n';

/** 盒子爆開的時間點（RewardStage `up` 2.8 s × 0.42），此時補一次重擊震動 */
const BOX_BURST_MS = 2800 * 0.42;

export type RevealCeremonyProps = {
  from: ShoeLevel;
  to: ShoeLevel;
  /** 打卡交易 explorer 連結（示意模式沒有） */
  explorer?: string | null;
  /**
   * 示意模式（Style 25.2）：從跑鞋詳情或 Demo 圖鑑「試拆盲盒」開啟。帶 DEMO 標籤、用系列展示樣式而非錢包細節款、
   * 不改等級也不寫入已看過的等級；只用來檢視／錄製揭曉特效。
   */
  preview?: boolean;
  onClose: () => void;
};

/** 升階／降階揭曉本體；`EvolutionReveal` 依鏈上等級觸發，示意模式由畫面自行掛載。 */
export function RevealCeremony({ from, to, explorer = null, preview = false, onClose }: RevealCeremonyProps) {
  const { t } = useT();
  const reduced = useReduceMotion();
  const insets = useSafeAreaInsets();
  const up = to > from;
  const box = up && Boolean(wildlifeOf(to));

  useEffect(() => {
    void Haptics.notificationAsync(up ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning)?.catch(() => {});
    if (!box || reduced) return;
    const timer = setTimeout(() => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)?.catch(() => {}), BOX_BURST_MS);
    return () => clearTimeout(timer);
  }, [up, box, reduced, from, to]);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel={t('common.dismiss')} testID="reveal-scrim" />
      {/* Modal 為 edge-to-edge：外層先讓出安全區（contentContainer 的 margin 在 Android 不計入可捲範圍），否則手勢列壓住 Close */}
      <View style={{ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom }} pointerEvents="box-none">
      <ScrollView contentContainerStyle={styles.card} accessibilityViewIsModal testID="evolution-reveal">
        {preview ? (
          <View style={styles.previewRow} testID="reveal-preview">
            <Chip label={t('common.demo')} kind="level" />
            <Text variant="label" tone="secondary">{t('reveal.previewEyebrow')}</Text>
          </View>
        ) : null}
        <Text variant="label" tone="mint" uppercase>
          {t(up ? 'common.gearEvolved' : 'reveal.downTitle')}
        </Text>
        <RewardStage key={`${from}-${to}`} mode={up ? 'up' : 'down'} box={box}>
          <Text variant="label">Lv.{from} → Lv.{to}</Text>
          <ShoeHero level={to} size={200} active={false} badge={false} owner={preview ? null : undefined} />
        </RewardStage>
        <Text variant="heading2" style={styles.title}>
          {t('common.lvDot', { n: to })} · {stageName(t, to)}
        </Text>
        <Text variant="bodySmall" tone="secondary" style={styles.body}>
          {preview ? t('reveal.previewBody', { level: to }) : up ? t('reveal.body', { detail: stageDetail(t, to), level: to }) : t('reveal.downBody')}
        </Text>
        {up ? <ShoeStory level={to} preview={preview} /> : null}
        <Button label={t(preview ? 'common.close' : up ? 'common.nice' : 'common.dismiss')} onPress={onClose} style={styles.btn} testID="reveal-ok" />
        {explorer ? (
          <Pressable onPress={() => void Linking.openURL(explorer)} accessibilityRole="link" style={styles.link} testID="reveal-tx">
            <Text variant="bodySmall" tone="cyan">
              {t('common.viewTransaction')}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
      </View>
    </Modal>
  );
}

/** Observe active gear changes and present a dedicated promotion or demotion ceremony. */
export function EvolutionReveal() {
  const level = useDashboardStore((s) => s.profile?.coreLevel ?? s.profile?.shoeLevel ?? null);
  const reveal = useLevelRevealStore();

  useEffect(() => {
    if (level) void reveal.observe(level as ShoeLevel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level]);

  const p = reveal.pending;
  if (!p) return null;
  const explorer = reveal.lastTxSignature ? `https://explorer.solana.com/tx/${reveal.lastTxSignature}?cluster=${APP_CONFIG.cluster}` : null;
  return <RevealCeremony from={p.from} to={p.to} explorer={explorer} onClose={() => void reveal.acknowledge()} />;
}

const styles = StyleSheet.create({
  scrim: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: color.scrim },
  card: { flexGrow: 1, justifyContent: 'center', margin: space.l, backgroundColor: color.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: color.borderActive, padding: space.l, alignItems: 'center' },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: space.s, marginBottom: space.s },
  title: { marginTop: space.s },
  body: { marginTop: space.xs, textAlign: 'center' },
  btn: { alignSelf: 'stretch', marginTop: space.m },
  link: { marginTop: space.s, minHeight: 48, justifyContent: 'center' },
});
