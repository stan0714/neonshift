import * as Haptics from 'expo-haptics';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Animated, Linking, Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { CollectorPlate, type EditionState } from '@/components/CollectorPlate';
import { WildlifeSilhouette } from '@/components/WildlifeSilhouette';
import { ShoeStory } from '@/components/ShoeStory';
import { ShoeHero } from '@/components/ShoeHero';
import { APP_CONFIG } from '@/config/app';
import { DEFAULT_SHOE_SERIES, wildlifeOf } from '@/config/shoeCollection';
import { shoeId } from '@/domain/appearance';
import { useAppearanceStore } from '@/state/appearanceStore';
import { SHOE_PROGRESSION, type ShoeLevel } from '@/config/shoeProgression';
import { stageDetail, stageName } from '@/domain/collectibles';
import { RewardStage } from './RewardStage';
import { UnboxStage } from './UnboxStage';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { useCollectibleStore } from '@/state/collectibleStore';
import { useDashboardStore } from '@/state/dashboardStore';
import { useWalletStore } from '@/state/walletStore';
import { useLevelRevealStore } from '@/state/levelRevealStore';
import { motion, space, Text } from '@/theme';
import { useT } from '@/i18n';

export type RevealCeremonyProps = {
  from: ShoeLevel;
  to: ShoeLevel;
  /** 打卡交易 explorer 連結（示意模式沒有） */
  explorer?: string | null;
  /**
   * 示意模式（Style 25.2）：從跑鞋詳情或 Demo 圖鑑「試拆盲盒」開啟。帶 DEMO 標籤、用系列展示樣式而非錢包細節款、
   * 不改等級也不寫入已看過的等級；可重播，只用來檢視／錄製揭曉特效。
   */
  preview?: boolean;
  onClose: () => void;
};

/** 鞋子尺寸：吃滿寬度（左右各留 24），上限 360 */
const heroSize = (width: number) => Math.min(width - space.l * 2, 360);

/**
 * 升階／降階揭曉本體；`EvolutionReveal` 依鏈上等級觸發，示意模式由畫面自行掛載。
 * 升階（Lv.2–5 皆為荒野守護）走全螢幕拆盒：舞台佔上半、文字在揭曉後才進場，鞋子揭曉後交回 ShoeHero 擺動展示。
 */
export function RevealCeremony({ from, to, explorer = null, preview = false, onClose }: RevealCeremonyProps) {
  const { t } = useT();
  const reduced = useReduceMotion();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const up = to > from;
  const unbox = up && Boolean(wildlifeOf(to));
  const [take, setTake] = useState(0);
  const [revealed, setRevealed] = useState(!unbox);
  const content = useRef(new Animated.Value(unbox ? 0 : 1)).current;
  const accent = SHOE_PROGRESSION.stages[to - 1].tint;
  const size = heroSize(width);

  // NFT 編號：示意 → 示意編號；真實揭曉 → 已領取則查鏈上領取順序，未領取則提示到裝備領取
  const wallet = useWalletStore((s) => s.session?.publicKey ?? null);
  const claimed = useCollectibleStore((s) => s.claimed.has(to));
  const editionRow = useCollectibleStore((s) => s.editions[to]);
  const editionLoading = useCollectibleStore((s) => s.editionLoading[to]);
  useEffect(() => {
    if (!preview && claimed && wallet) void useCollectibleStore.getState().loadEdition(wallet, to);
  }, [preview, claimed, wallet, to]);
  const edition: EditionState = preview ? 'preview' : !claimed ? 'unclaimed' : editionRow ? editionRow : editionLoading || editionRow === undefined ? 'loading' : 'unavailable';
  const selectedShoeId = useAppearanceStore((s) => s.selectedShoeId);
  const selectShoe = useAppearanceStore((s) => s.selectShoe);
  const offerUse = selectedShoeId !== null && selectedShoeId !== shoeId(DEFAULT_SHOE_SERIES, to);

  // 在子舞台通知立即揭曉前重設；避免背景／減少動態的結果被父層覆蓋。
  useLayoutEffect(() => {
    const immediate = !unbox || reduced;
    setRevealed(immediate);
    content.setValue(immediate ? 1 : 0);
    void Haptics.notificationAsync(up ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning)?.catch(() => {});
    // Reduced-motion changes settle the current ceremony below; they do not replay it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [up, unbox, from, to, take, content]);

  useEffect(() => {
    if (reduced) { setRevealed(true); content.stopAnimation(); content.setValue(1); }
  }, [reduced, content]);

  const onRevealed = () => {
    setRevealed(true);
    Animated.timing(content, { toValue: 1, duration: reduced ? 0 : motion.slow, useNativeDriver: true }).start();
  };

  const hero = <View style={unbox ? { marginTop: size * 0.12 } : null}><ShoeHero level={to} size={size} active={revealed && !reduced} badge={false} owner={preview ? null : undefined} /></View>;

  return (
    <Modal visible transparent animationType={reduced ? "none" : "fade"} onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel={t('common.dismiss')} testID="reveal-scrim" />
      {/* Modal 為 edge-to-edge：外層先讓出安全區（contentContainer 的 margin 在 Android 不計入可捲範圍） */}
      <View style={{ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom }} pointerEvents="box-none">
        <ScrollView contentContainerStyle={styles.content} accessibilityViewIsModal testID="evolution-reveal">
          <View style={styles.header}>
            {preview ? (
              <View style={styles.previewRow} testID="reveal-preview">
                <Chip label={t('common.demo')} kind="level" />
                <Text variant="label" tone="secondary">{t('reveal.previewEyebrow')}</Text>
              </View>
            ) : null}
            <Text variant="label" tone="mint" uppercase>
              {t(up ? 'common.gearEvolved' : 'reveal.downTitle')}
            </Text>
            <Text variant="label" tone="muted" style={styles.levels}>Lv.{from} → Lv.{to}</Text>
          </View>

          {/* 舞台比鞋子高出一截，讓剪影的頭／耳露在鞋子上方；剪影往上偏移、鞋子置中偏下 */}
          {unbox ? (
            <UnboxStage key={`${from}-${to}-${take}`} accent={accent} height={size * 0.8 + space.xxl * 2 + size * 0.16} onRevealed={onRevealed} backdrop={<View style={{ marginTop: -size * 0.12 }}><WildlifeSilhouette level={to} color={accent} size={size * 0.96} opacity={0.4} /></View>}>
              {hero}
            </UnboxStage>
          ) : (
            <RewardStage key={`${from}-${to}`} mode={up ? 'up' : 'down'}>
              {hero}
            </RewardStage>
          )}

          <Animated.View style={[styles.body, { opacity: content, transform: [{ translateY: content.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }]} testID="reveal-content" pointerEvents={revealed ? "auto" : "none"} accessibilityElementsHidden={!revealed} importantForAccessibility={revealed ? "auto" : "no-hide-descendants"}>
            <Text variant="heading1" style={styles.center}>
              {t('common.lvDot', { n: to })} · {stageName(t, to)}
            </Text>
            <Text variant="body" tone="secondary" style={[styles.center, styles.bodyText]}>
              {preview ? t('reveal.previewBody', { level: to }) : up ? t('reveal.body', { detail: stageDetail(t, to), level: to }) : t('reveal.downBody')}
            </Text>
            {unbox ? <View style={styles.plate}><CollectorPlate level={to} edition={edition} /></View> : null}
            {/* PG-LINK-01：有明確外觀選擇時，新鞋不強制覆蓋——提供「立即使用／稍後」 */}
            {!preview && up && offerUse ? (
              <Button label={t('gear.offer.useNow')} onPress={() => { void selectShoe(to); onClose(); }} style={styles.btn} testID="reveal-use-now" />
            ) : null}
            <Button label={t(preview ? 'common.close' : up ? (offerUse ? 'gear.offer.later' : 'common.nice') : 'common.dismiss')} onPress={onClose} variant={!preview && up && offerUse ? 'secondary' : 'primary'} style={styles.btn} testID="reveal-ok" />
            {preview && unbox ? (
              <Button label={t('reveal.replay')} variant="secondary" onPress={() => setTake((n) => n + 1)} style={styles.replay} testID="reveal-replay" />
            ) : null}
            {up && revealed ? <ShoeStory level={to} preview={preview} /> : null}
            {explorer ? (
              <Pressable onPress={() => void Linking.openURL(explorer)} accessibilityRole="link" style={styles.link} testID="reveal-tx">
                <Text variant="bodySmall" tone="cyan">
                  {t('common.viewTransaction')}
                </Text>
              </Pressable>
            ) : null}
          </Animated.View>
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
  scrim: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: '#070A16F8' },
  content: { flexGrow: 1, paddingHorizontal: space.l, paddingTop: space.l, paddingBottom: space.xl },
  header: { alignItems: 'center', gap: space.xs },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: space.s, marginBottom: space.xs },
  levels: { letterSpacing: 2 },
  body: { alignItems: 'center', marginTop: space.m },
  center: { textAlign: 'center' },
  bodyText: { marginTop: space.s },
  plate: { alignSelf: 'stretch', marginTop: space.m },
  btn: { alignSelf: 'stretch', marginTop: space.l },
  replay: { alignSelf: 'stretch', marginTop: space.s },
  link: { marginTop: space.s, minHeight: 48, justifyContent: 'center' },
});
