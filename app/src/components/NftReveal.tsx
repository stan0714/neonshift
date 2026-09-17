import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useEffect } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { Button } from './Button';
import { ShoeHero } from './ShoeHero';
import { RewardStage } from './RewardStage';
import { COLLECTIBLES, collectibleName } from '@/domain/collectibles';
import { useNftRevealStore } from '@/state/nftRevealStore';
import { useLevelRevealStore } from '@/state/levelRevealStore';
import { useT } from '@/i18n';
import { Text } from '@/theme';
export function NftReveal() {
  const { t } = useT();
  const reward = useNftRevealStore(s => s.queue[0]);
  const dismiss = useNftRevealStore(s => s.dismiss);
  const levelPending = useLevelRevealStore(s => s.pending);
  const visible = Boolean(reward && !levelPending);
  useEffect(() => { if (visible) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); }, [visible, reward?.id]);
  if (!reward || !visible) return null;
  const item = COLLECTIBLES.find(c => c.kind === reward.collectible);
  const title = item ? collectibleName(t, item) : reward.title ?? t('reveal.nftTitle');
  return <Modal transparent visible animationType="fade" onRequestClose={dismiss} statusBarTranslucent>
    <ScrollView style={s.scrim} contentContainerStyle={s.content} accessibilityViewIsModal testID="nft-reveal">
      <Text variant="label" style={s.gold}>{t('reveal.nftEyebrow')}</Text>
      <RewardStage key={reward.id} mode="nft">
        <Text variant="caption" style={s.gold}>NEONSHIFT · NFT</Text>
        {item?.shoeLevel ? <ShoeHero level={item.shoeLevel} size={180} active={false} badge={false} /> : <View style={s.medal}><Feather name={item?.icon ?? 'award'} size={84} color="#FFD781" /></View>}
        <Text variant="label" style={s.title}>{title}</Text>
      </RewardStage>
      <Text variant="heading2" style={s.title}>{t('reveal.nftTitle')}</Text>
      <Text variant="bodySmall" tone="secondary" style={s.body}>{t('reveal.nftBody')}</Text>
      {item?.shoeLevel && item.shoeLevel > 1 ? <Text variant="caption" tone="muted" style={s.body}>{t('wild.cosmetic')}</Text> : null}
      <Button label={t('reveal.collect')} onPress={dismiss} style={s.button} testID="nft-reveal-ok" />
    </ScrollView>
  </Modal>;
}
const s = StyleSheet.create({ scrim: { flex: 1, backgroundColor: '#070A16F5' }, content: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 28, paddingVertical: 60 }, gold: { color: '#FFD781', letterSpacing: 2 }, title: { textAlign: 'center' }, medal: { padding: 28 }, body: { textAlign: 'center', marginTop: 12 }, button: { alignSelf: 'stretch', marginTop: 28 } });
