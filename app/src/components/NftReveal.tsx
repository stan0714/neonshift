import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useEffect } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { GuardianMilestone } from './GuardianMilestone';
import { Button } from './Button';
import { ShoeHero } from './ShoeHero';
import { RewardStage } from './RewardStage';
import { CollectorPlate, type EditionState } from './CollectorPlate';
import { SeasonalBadge } from './SeasonalBadge';
import { WildlifeSilhouette } from './WildlifeSilhouette';
import { SHOE_PROGRESSION } from '@/config/shoeProgression';
import { useCollectibleStore } from '@/state/collectibleStore';
import { COLLECTIBLES, collectibleName } from '@/domain/collectibles';
import { useNftRevealStore } from '@/state/nftRevealStore';
import { useLevelRevealStore } from '@/state/levelRevealStore';
import { useT, type TKey } from '@/i18n';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { Text } from '@/theme';
export function NftReveal() {
  const { t } = useT();
  const reduced = useReduceMotion();
  const insets = useSafeAreaInsets();
  const reward = useNftRevealStore(s => s.queue[0]);
  const dismiss = useNftRevealStore(s => s.dismiss);
  const levelPending = useLevelRevealStore(s => s.pending);
  const visible = Boolean(reward && !levelPending);
  useEffect(() => { if (visible) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); }, [visible, reward?.id]);
  const editionRow = useCollectibleStore(s => (reward?.collectible ? s.editions[reward.collectible] : undefined));
  const editionLoading = useCollectibleStore(s => (reward?.collectible ? s.editionLoading[reward.collectible] : false));
  if (!reward || !visible) return null;
  const item = COLLECTIBLES.find(c => c.kind === reward.collectible);
  // 節日章（PG-SEASON-04）：翻面後要是這一屆的徽章本體，名稱用本地化的屆名＋年份，
  // 不用鏈上 metadata 的 name（那是整個系列共用的 "NeonShift Seasonal Footprints"，
  // 對剛拿到的人來說看不出是哪一屆）。查不到譯名就退回 theme_id，不顯示空字串。
  const seasonal = reward.seasonal;
  const seasonalNameKey = seasonal ? (`season.name.${seasonal.themeId}` as TKey) : null;
  const seasonalName = seasonal && seasonalNameKey
    ? (t(seasonalNameKey) === seasonalNameKey ? seasonal.themeId : t(seasonalNameKey))
    : null;
  const shoeLevel = item?.shoeLevel && item.shoeLevel > 1 ? item.shoeLevel : null;
  const edition: EditionState = editionRow ? editionRow : editionLoading || editionRow === undefined ? 'loading' : 'unavailable';
  const title = seasonal ? `${seasonalName} · ${seasonal.year}` : item ? collectibleName(t, item) : reward.title ?? t('reveal.nftTitle');
  const distance = reward.milestone ? ({ first_5k: '5', first_10k: '10', first_half: '21.0975', first_marathon: '42.195', first_finish: null } as const)[reward.milestone] : null;
  return <Modal transparent visible animationType={reduced ? "none" : "fade"} onRequestClose={dismiss} statusBarTranslucent>
    <ScrollView style={s.scrim} contentContainerStyle={[s.content, { paddingTop: Math.max(32, insets.top + 16), paddingBottom: Math.max(32, insets.bottom + 16) }]} accessibilityViewIsModal testID="nft-reveal">
      <Text variant="label" style={s.gold}>{t(seasonal ? 'reveal.seasonalEyebrow' : 'reveal.nftEyebrow')}</Text>
      <RewardStage key={reward.id} mode={reward.milestone ? "milestone" : "nft"}>
        <Text variant="caption" style={s.gold}>NEONSHIFT · NFT</Text>
        {shoeLevel ? <View style={s.backdrop}><WildlifeSilhouette level={shoeLevel} color={SHOE_PROGRESSION.stages[shoeLevel - 1].tint} size={200} opacity={0.12} /></View> : null}
        {seasonal ? <View style={s.badge}><SeasonalBadge themeId={seasonal.themeId} year={seasonal.year} state="earned" size={148} testID="nft-reveal-seasonal" /></View> : item?.shoeLevel ? <ShoeHero level={item.shoeLevel} size={180} active={false} badge={false} /> : <View style={s.medal}>{reward.milestone ? <View style={s.distance} testID="milestone-distance"><Feather name="flag" size={28} color="#FFD781" />{distance ? <><Text variant="heading1" numeric style={s.gold}>{distance}</Text><Text variant="label" style={s.gold}>km</Text></> : null}</View> : <Feather name={item?.icon ?? 'award'} size={84} color="#FFD781" />}</View>}
        <Text variant="label" style={s.title}>{title}</Text>
      </RewardStage>
      <Text variant="heading2" style={s.title}>{t(seasonal ? 'reveal.seasonalTitle' : 'reveal.nftTitle')}</Text>
      <Text variant="bodySmall" tone="secondary" style={s.body}>{t(seasonal ? 'reveal.seasonalBody' : 'reveal.nftBody')}</Text>
      {shoeLevel ? <View style={s.plate}><CollectorPlate level={shoeLevel} edition={edition} compact /></View> : null}
      {item?.shoeLevel && item.shoeLevel > 1 ? <Text variant="caption" tone="muted" style={s.body}>{t('wild.cosmetic')}</Text> : null}
      <Button label={t('reveal.collect')} onPress={dismiss} style={s.button} testID="nft-reveal-ok" />
      {shoeLevel ? <GuardianMilestone key={reward.id} level={shoeLevel} autoCheck /> : null}
    </ScrollView>
  </Modal>;
}
const s = StyleSheet.create({ distance: { alignItems: 'center', gap: 6 }, backdrop: { position: 'absolute', top: 10 }, plate: { alignSelf: 'stretch', marginTop: 16 }, scrim: { flex: 1, backgroundColor: '#070A16F5' }, content: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 28, paddingVertical: 60 }, gold: { color: '#FFD781', letterSpacing: 2 }, title: { textAlign: 'center' }, medal: { padding: 28 }, badge: { paddingVertical: 4 }, body: { textAlign: 'center', marginTop: 12 }, button: { alignSelf: 'stretch', marginTop: 28 } });
