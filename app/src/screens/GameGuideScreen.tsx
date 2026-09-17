import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { Button, Chip, Screen, Surface } from '@/components';
import { ShoeHero } from '@/components/ShoeHero';
import { useT } from '@/i18n';
import type { RootParamList } from '@/navigation/types';
import { color, radius, space, Text } from '@/theme';

const CHAPTERS = [
  { key: 'daily', icon: 'activity', tint: color.mint },
  { key: 'gear', icon: 'trending-up', tint: color.cyan },
  { key: 'collection', icon: 'award', tint: '#FFD781' },
  { key: 'arena', icon: 'flag', tint: '#BBA1FF' },
] as const;

/** Read-only guide, available before wallet setup and from Profile. */
export function GameGuideScreen() {
  const { t } = useT();
  const navigation = useNavigation();
  const { params } = useRoute<RouteProp<RootParamList, 'GameGuide'>>();
  const onboarding = params?.onboarding === true;
  const start = () => navigation.navigate('Onboarding', { screen: 'WalletConnect' });
  return (
    <Screen scroll testID="game-guide">
      <View style={styles.top}>
        <Chip label={t('guide.eyebrow')} kind="level" />
        <Button label={t(onboarding ? 'guide.skip' : 'common.back')} variant="secondary" onPress={onboarding ? start : () => navigation.goBack()} testID="guide-exit" />
      </View>
      <LinearGradient colors={['#173C38', '#18233D', '#111522']} style={styles.hero}>
        <ShoeHero owner={null} level={2} size={210} active={false} badge={false} />
        <Text variant="heading1" accessibilityRole="header" style={styles.center}>{t('guide.title')}</Text>
        <Text variant="body" tone="secondary" style={styles.lead}>{t('guide.intro')}</Text>
        <View style={styles.loop}>
          {(['move', 'claim', 'grow'] as const).map((key, i) => <View key={key} style={styles.loopItem}>
            <Text variant="label" tone="mint">0{i + 1}</Text>
            <Text variant="label">{t(`guide.loop.${key}`)}</Text>
          </View>)}
        </View>
      </LinearGradient>
      {CHAPTERS.map(({ key, icon, tint }, i) => (
        <Surface key={key} style={styles.section} testID={`guide-${key}`}>
          <View style={styles.chapterHeader}>
            <View style={[styles.icon, { backgroundColor: `${tint}18` }]}><Feather name={icon} size={24} color={tint} /></View>
            <View style={styles.flex}>
              <Text variant="caption" style={{ color: tint }}>{t(`guide.${key}.where`)}</Text>
              <Text variant="heading2" accessibilityRole="header">{i + 1}. {t(`guide.${key}.title`)}</Text>
            </View>
          </View>
          <Text variant="body" tone="secondary" style={styles.body}>{t(`guide.${key}.body`)}</Text>
          <View style={styles.tip}><Feather name="info" size={16} color={tint} /><Text variant="bodySmall" tone="secondary" style={styles.flex}>{t(`guide.${key}.tip`)}</Text></View>
        </Surface>
      ))}
      <Surface active style={styles.section}>
        <Text variant="heading2" accessibilityRole="header">{t('guide.start.title')}</Text>
        {(['wallet', 'health', 'shoe', 'mission'] as const).map((key, i) => <View key={key} style={styles.check}>
          <Text variant="label" tone="mint">{i + 1}</Text><Text variant="bodySmall" style={styles.flex}>{t(`guide.start.${key}`)}</Text>
        </View>)}
      </Surface>
      <Text variant="caption" tone="muted" style={styles.disclaimer}>{t('common.disclaimer')}</Text>
      <Button label={t(onboarding ? 'guide.startAction' : 'guide.done')} onPress={onboarding ? start : () => navigation.goBack()} testID="guide-done" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s, marginBottom: space.l, flexWrap: 'wrap' },
  hero: { borderRadius: radius.xl, padding: space.l, alignItems: 'center', overflow: 'hidden' },
  center: { textAlign: 'center' },
  lead: { textAlign: 'center', marginTop: space.s },
  loop: { flexDirection: 'row', alignSelf: 'stretch', marginTop: space.l, gap: space.s },
  loopItem: { flex: 1, alignItems: 'center', gap: space.xs },
  section: { marginTop: space.m },
  chapterHeader: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  icon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  body: { marginTop: space.m },
  tip: { flexDirection: 'row', gap: space.s, borderTopWidth: 1, borderTopColor: color.borderSubtle, paddingTop: space.m, marginTop: space.m },
  check: { flexDirection: 'row', gap: space.m, marginTop: space.m },
  disclaimer: { textAlign: 'center', marginVertical: space.l },
});
