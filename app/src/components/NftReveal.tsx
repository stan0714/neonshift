import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useEffect } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { GuardianMilestone } from './GuardianMilestone';
import { Button } from './Button';
import { ShoeHero } from './ShoeHero';
import { RewardStage } from './RewardStage';
import { CollectorPlate, type EditionState } from './CollectorPlate';
import { WildlifeSilhouette } from './WildlifeSilhouette';
import { SHOE_PROGRESSION } from '@/config/shoeProgression';
import { useCollectibleStore } from '@/state/collectibleStore';
import { COLLECTIBLES, collectibleName } from '@/domain/collectibles';
import { useNftRevealStore } from '@/state/nftRevealStore';
import { useLevelRevealStore } from '@/state/levelRevealStore';
import { useT } from '@/i18n';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { Text } from '@/theme';
export function NftReveal() {
  const { t } = useT();
  const reduced = useReduceMotion();
  const reward = useNftRevealStore(s => s.queue[0]);
  const dismiss = useNftRevealStore(s => s.dismiss);
  const levelPending = useLevelRevealStore(s => s.pending);
  const visible = Boolean(reward && !levelPending);
  useEffect(() => { if (visible) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); }, [visible, reward?.id]);
  const editionRow = useCollectibleStore(s => (reward?.collectible ? s.editions[reward.collectible] : undefined));
  const editionLoading = useCollectibleStore(s => (reward?.collectible ? s.editionLoading[reward.collectible] : false));
  if (!reward || !visible) return null;
  const item = COLLECTIBLES.find(c => c.kind === reward.collectible);
  const shoeLevel = item?.shoeLevel && item.shoeLevel > 1 ? item.shoeLevel : null;
  const edition: EditionState = editionRow ? editionRow : editionLoading || editionRow === undefined ? 'loading' : 'unavailable';
  const title = item ? collectibleName(t, item) : reward.title ?? t('reveal.nftTitle');
  const distance = reward.milestone ? ({ first_5k: '5', first_10k: '10', first_half: '21.0975', first_marathon: '42.195', first_finish: null } as const)[reward.milestone] : null;
  return <Modal transparent visible animationType={reduced ? "none" : "fade"} onRequestClose={dismiss} statusBarTranslucent>
    <ScrollView style={s.scrim} contentContainerStyle={s.content} accessibilityViewIsModal testID="nft-reveal">
      <Text variant="label" style={s.gold}>{t('reveal.nftEyebrow')}</Text>
      <RewardStage key={reward.id} mode={reward.milestone ? "milestone" : "nft"}>
        <Text variant="caption" style={s.gold}>NEONSHIFT · NFT</Text>
        {shoeLevel ? <View style={s.backdrop}><WildlifeSilhouette level={shoeLevel} color={SHOE_PROGRESSION.stages[shoeLevel - 1].tint} size={200} opacity={0.12} /></View> : null}
        {item?.shoeLevel ? <ShoeHero level={item.shoeLevel} size={180} active={false} badge={false} /> : <View style={s.medal}>{reward.milestone ? <View style={s.distance} testID="milestone-distance"><Feather name="flag" size={28} color="#FFD781" />{distance ? <><Text variant="heading1" numeric style={s.gold}>{distance}</Text><Text variant="label" style={s.gold}>km</Text></> : null}</View> : <Feather name={item?.icon ?? 'award'} size={84} color="#FFD781" />}</View>}
        <Text variant="label" style={s.title}>{title}</Text>
      </RewardStage>
      <Text variant="heading2" style={s.title}>{t('reveal.nftTitle')}</Text>
      <Text variant="bodySmall" tone="secondary" style={s.body}>{t('reveal.nftBody')}</Text>
      {shoeLevel ? <View style={s.plate}><CollectorPlate level={shoeLevel} edition={edition} compact /></View> : null}
      {item?.shoeLevel && item.shoeLevel > 1 ? <Text variant="caption" tone="muted" style={s.body}>{t('wild.cosmetic')}</Text> : null}
      {shoeLevel ? <GuardianMilestone key={reward.id} level={shoeLevel} autoCheck /> : null}
      <Button label={t('reveal.collect')} onPress={dismiss} style={s.button} testID="nft-reveal-ok" />
    </ScrollView>
  </Modal>;
}
const s = StyleSheet.create({ distance: { alignItems: 'center', gap: 6 }, backdrop: { position: 'absolute', top: 10 }, plate: { alignSelf: 'stretch', marginTop: 16 }, scrim: { flex: 1, backgroundColor: '#070A16F5' }, content: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 28, paddingVertical: 60 }, gold: { color: '#FFD781', letterSpacing: 2 }, title: { textAlign: 'center' }, medal: { padding: 28 }, body: { textAlign: 'center', marginTop: 12 }, button: { alignSelf: 'stretch', marginTop: 28 } });
