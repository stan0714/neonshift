import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, Easing, Linking, Modal, ScrollView, Share, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from './Button';
import { ShareImageBlock } from './ShareImageBlock';
import { guardianShareLayout, shareUrl } from '@/domain/shareImage';
import { WildlifeSilhouette } from './WildlifeSilhouette';
import { ShoeHero } from './ShoeHero';
import { APP_CONFIG } from '@/config/app';
import { GUARDIAN_REFERENCES, guardianProgress } from '@/config/guardianMilestones';
import { SHOE_PROGRESSION, type ShoeLevel } from '@/config/shoeProgression';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { useT, type TKey } from '@/i18n';
import { fetchGuardianCount } from '@/services/chain/GuardianCountService';
import { color, radius, space, Text } from '@/theme';

/** Intentional entry; no surprise interruption of an active run or wallet signing. Demo never reads or changes live counts. */
type GuardianProps = { level: ShoeLevel; preview?: boolean; autoCheck?: boolean };
export function GuardianMilestone(props: GuardianProps) {
  return <GuardianMilestoneContent key={`${props.level}-${!!props.preview}`} {...props} />;
}
function GuardianMilestoneContent({ level, preview = false, autoCheck = false }: GuardianProps) {
  const { t } = useT();
  const [count, setCount] = useState<{ level: ShoeLevel; total: number; checkedAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const request = useRef(0);
  useEffect(() => () => { request.current += 1; }, [level, preview]);
  const ref = GUARDIAN_REFERENCES[level];
  const total = preview && ref ? ref.threshold + 1 : count?.level === level ? count.total : null;
  const progress = guardianProgress(level, total);
  const unlocked = progress.status === 'unlocked';
  const title = t(`col.stage.${level}` as TKey);
  const load = useCallback(async () => {
    const id = ++request.current;
    setBusy(true); setFailed(false);
    try {
      const result = await fetchGuardianCount(level);
      if (request.current === id) setCount({ ...result, level });
    } catch {
      if (request.current === id) { setCount(null); setFailed(true); }
    } finally {
      if (request.current === id) setBusy(false);
    }
  }, [level]);
  useEffect(() => { if (autoCheck && !preview && ref) void load(); }, [autoCheck, preview, ref, load]);
  const share = async () => {
    try {
      // No wallet, health values or referral identifier is put in a public share.
      await Share.share({ message: `${t('guardian.shareText', { name: title })}\n${APP_CONFIG.siteUrl}` });
    } catch { Alert.alert(t('guardian.shareError')); }
  };
  if (level === 1) return null;
  return <View style={styles.card} testID={`guardian-${level}`}>
    <Text variant="label" tone="mint">{t('guardian.eyebrow')}</Text>
    <Text variant="title">{t(unlocked ? 'guardian.unlocked' : 'guardian.title')}</Text>
    <Text variant="bodySmall" tone="secondary">{t('guardian.intro')}</Text>
    {!ref ? <Text variant="bodySmall" tone="secondary">{t('guardian.noReference')}</Text> : <>
      <Text variant="bodySmall">{t(`guardian.reference.${ref.qualifier}` as TKey, { n: ref.threshold.toLocaleString() })}</Text>
      <Text variant="caption" tone="muted">{ref.estimateYear ? t('guardian.year', { year: ref.estimateYear }) : t('guardian.yearUnknown')} · {t('guardian.reviewed', { date: ref.reviewedAt })}</Text>
      <Text variant="caption" tone="secondary">{t('guardian.snapshot')}</Text>
      {total !== null ? <>
        <Text variant="heading2" numeric>{t('guardian.count', { n: total.toLocaleString() })}</Text>
        <Text variant="caption" tone="warning">{preview ? t('guardian.demo') : t('guardian.network', { network: APP_CONFIG.cluster })}</Text>
        <View accessibilityRole="progressbar" accessibilityLabel={t('guardian.title')} accessibilityValue={{ min: 0, max: ref.threshold + 1, now: Math.min(total, ref.threshold + 1) }} style={styles.track}><View style={[styles.fill, { width: `${progress.ratio * 100}%` }]} /></View>
        {!unlocked ? <Text variant="bodySmall">{t('guardian.remaining', { n: progress.remaining ?? 0 })}</Text> : null}
        {!preview && count ? <Text variant="caption" tone="muted">{t('guardian.updated', { date: new Date(count.checkedAt).toLocaleString() })}</Text> : null}
      </> : null}
      {failed ? <Text variant="bodySmall" tone="warning" accessibilityLiveRegion="polite">{t('guardian.error')}</Text> : null}
      {!preview ? <Button label={t(total === null ? 'guardian.check' : 'guardian.refresh')} variant="secondary" onPress={() => void load()} loading={busy} disabled={busy} testID="guardian-check" /> : null}
      {unlocked ? <Button label={t(preview ? 'guardian.preview' : 'guardian.enter')} onPress={() => setVisible(true)} testID="guardian-enter" /> : null}
      <Button label={t('guardian.source')} variant="secondary" onPress={() => void Linking.openURL(ref.source).catch(() => Alert.alert(t('wild.sourceError')))} />
    </>}
    <Text variant="caption" tone="muted">{t('guardian.countNote')}</Text>
    <Text variant="caption" tone="muted">{t('guardian.impactNote')}</Text>
    <Button label={t('guardian.invite')} variant="secondary" onPress={() => void share()} testID="guardian-share" />
    {/* PG-SHARE-06 卡型 E：故事卡只有物種、一句依據與共同進度，不含任何個人數據 */}
    {ref ? <Button label={t('share.card.image')} variant="secondary" onPress={() => setShareOpen((o) => !o)} accessibilityState={{ expanded: shareOpen }} testID="guardian-share-image" /> : null}
    {shareOpen && ref ? (
      <ShareImageBlock
        layout={guardianShareLayout(
          { speciesName: title, storyLine: t(`guardian.reference.${ref.qualifier}` as TKey, { n: ref.threshold.toLocaleString() }), progressLabel: total !== null ? t('guardian.count', { n: total.toLocaleString() }) : null, level },
          { t: (k, p) => t(k as TKey, p), labels: { tagline: t('share.card.tagline'), site: 'neonshift.cc' }, qr: shareUrl(APP_CONFIG.siteUrl, 'guardian', 'guardian') },
        )}
        caption={`${t('guardian.shareText', { name: title })}\n${shareUrl(APP_CONFIG.siteUrl, 'guardian', 'guardian')}`}
        prefix="guardian-share-card"
      />
    ) : null}
    {visible && unlocked ? <GuardianScene level={level} preview={preview} total={total!} onClose={() => setVisible(false)} onShare={() => void share()} /> : null}
  </View>;
}

function GuardianScene({ level, preview, total, onClose, onShare }: { level: ShoeLevel; preview: boolean; total: number; onClose: () => void; onShare: () => void }) {
  const { t } = useT();
  const reduce = useReduceMotion();
  const insets = useSafeAreaInsets();
  const light = useRef(new Animated.Value(1)).current;
  const tint = SHOE_PROGRESSION.stages[level - 1].tint;
  useEffect(() => {
    if (reduce) { light.setValue(1); return; }
    light.setValue(0);
    const animation = Animated.timing(light, { toValue: 1, duration: 1800, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [light, reduce]);
  return <Modal visible transparent animationType={reduce ? 'none' : 'fade'} onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
    <View style={[styles.scene, { paddingTop: Math.max(insets.top, space.l), paddingBottom: Math.max(insets.bottom, space.m) }]} accessibilityViewIsModal testID="guardian-scene">
      <ScrollView contentContainerStyle={styles.sceneContent}>
        <Text variant="label" tone="mint">{t(preview ? 'guardian.demo' : 'guardian.network', { network: APP_CONFIG.cluster })}</Text>
        <Text variant="heading2" style={styles.center}>{t('guardian.sceneTitle')}</Text>
        <Animated.View style={[styles.habitat, { opacity: light }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Svg width="100%" height="100%" viewBox="0 0 280 200" style={StyleSheet.absoluteFill}>
            <Path d={level === 3 ? 'M10 150 Q60 100 120 150 T270 145 M10 170 Q80 130 140 175 T270 160' : 'M12 180 L50 70 L78 120 L111 35 L147 110 L185 52 L230 135 L267 80'} fill="none" stroke={tint} strokeOpacity={0.5} strokeWidth={1.5} />
            {Array.from({ length: 24 }, (_, i) => <Circle key={i} cx={18 + (i * 37) % 250} cy={15 + (i * 53) % 170} r={i % 3 === 0 ? 2.5 : 1.3} fill={tint} opacity={0.45 + (i % 3) * 0.2} />)}
          </Svg>
          <WildlifeSilhouette level={level} color={tint} size={190} opacity={0.8} />
        </Animated.View>
        <Text variant="caption" tone="muted">{t('guardian.symbolic')}</Text>
        <Text variant="body" style={styles.center}>{t('guardian.sceneBody', { name: t(`col.stage.${level}` as TKey), n: total.toLocaleString() })}</Text>
        <ShoeHero level={level} owner={null} size={200} active={false} badge={false} />
        <Text variant="bodySmall" tone="secondary" style={styles.center}>{t('guardian.sceneInvitation')}</Text>
        <Text variant="caption" tone="muted" style={styles.center}>{t('guardian.impactNote')}</Text>
      </ScrollView>
      <View style={styles.actions}>
        <Button label={t('guardian.invite')} onPress={onShare} testID="guardian-scene-share" />
        <Button label={t('common.close')} variant="secondary" onPress={onClose} testID="guardian-scene-close" />
      </View>
    </View>
  </Modal>;
}
const styles = StyleSheet.create({
  card: { alignSelf: 'stretch', marginTop: space.m, padding: space.m, gap: space.s, borderRadius: radius.l, borderWidth: 1, borderColor: color.borderSubtle, backgroundColor: color.elevated },
  track: { height: 5, backgroundColor: color.borderSubtle, borderRadius: radius.s, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: color.mint },
  scene: { flex: 1, backgroundColor: color.canvas },
  sceneContent: { alignItems: 'center', padding: space.l, gap: space.m },
  habitat: { width: 280, maxWidth: '100%', height: 200, alignItems: 'center', justifyContent: 'center' },
  center: { textAlign: 'center' },
  actions: { paddingHorizontal: space.l, gap: space.s },
});
