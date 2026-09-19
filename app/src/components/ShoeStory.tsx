import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';
import { Button } from './Button';
import { ShoeHero, type ShoeDetail } from './ShoeHero';
import { shoeVariant, wildlifeOf } from '@/config/shoeCollection';
import { SHOE_PROGRESSION, type ShoeLevel } from '@/config/shoeProgression';
import { useWalletStore } from '@/state/walletStore';
import { useT, type TKey } from '@/i18n';
import { color, radius, space, Text } from '@/theme';

const PARTS: ShoeDetail[] = ['heel', 'upper', 'sole'];

export function ShoeStory({ level, locked = false, preview = false }: { level: ShoeLevel; locked?: boolean; preview?: boolean }) {
  const { t } = useT();
  const [part, setPart] = useState<ShoeDetail>('heel');
  const owner = useWalletStore(s => s.session?.publicKey.toString() ?? null);
  const animal = wildlifeOf(level);
  if (!animal) return null;
  const displayOwner = preview || locked ? null : owner;
  const variant = shoeVariant(displayOwner, level);
  const tint = SHOE_PROGRESSION.stages[level - 1].tint;
  return <View style={styles.card} testID={`shoe-story-${level}`}>
    <View style={styles.heading}><Feather name="feather" size={20} color={tint} /><Text variant="label" style={{ color: tint }}>{t('wild.series')}</Text></View>
    <Text variant="heading2">{t(`col.stage.${level}` as TKey)}</Text>
    <Text variant="title" style={{ color: tint }}>{t(`wild.headline.${level}` as TKey)}</Text>
    <View style={styles.habitat}><Feather name="map-pin" size={15} color={color.textSecondary} /><Text variant="caption" tone="secondary" style={styles.copy}>{t(`wild.habitat.${level}` as TKey)}</Text></View>

    <View style={styles.explore}>
      <Text variant="label">{t('wild.explore')}</Text>
      <Text variant="caption" tone="secondary">{t('wild.exploreHint')}</Text>
      <View style={styles.tabs} accessibilityRole="tablist">
        {PARTS.map((item, index) => <Pressable key={item} accessibilityRole="tab" accessibilityState={{ selected: part === item }} accessibilityLabel={t(`wild.part.${item}` as TKey)} onPress={() => setPart(item)} style={[styles.tab, part === item && { borderColor: tint, backgroundColor: color.elevated }]} testID={`shoe-detail-${item}`}>
          <Text variant="caption" tone="muted">0{index + 1}</Text>
          <Text variant="label" style={part === item ? { color: tint } : undefined}>{t(`wild.part.${item}` as TKey)}</Text>
        </Pressable>)}
      </View>
      <View style={styles.art} testID={`shoe-inspect-${part}`}>
        <ShoeHero owner={displayOwner} level={level} size={230} detail={part} active={false} badge={false} />
      </View>
      <Text variant="caption" tone="muted">{t(preview || locked ? 'wild.detailPreview' : 'wild.designNote')}</Text>
      <View accessibilityLiveRegion="polite" style={styles.detailCopy}>
        <Text variant="title">{t(`wild.${part}.title.${level}` as TKey)}</Text>
        <Text variant="bodySmall" tone="secondary">{t(`wild.${part}.body.${level}` as TKey)}</Text>
      </View>
    </View>

    <Text variant="label">{t('wild.habitat')}</Text>
    <Text variant="caption" tone="secondary">{animal.scientific} · {t(`wild.status.${animal.status}` as TKey)}</Text>
    <Text variant="bodySmall" tone="secondary">{t(`wild.story.${level}` as TKey)}</Text>
    <View style={[styles.invitation, { borderLeftColor: tint }]}>
      <Text variant="label">{t('wild.invitation')}</Text>
      <Text variant="bodySmall">{t(`wild.invitation.${level}` as TKey)}</Text>
    </View>
    <Text variant="label">{t('wild.action')}</Text>
    <Text variant="bodySmall" tone="secondary">{t(`wild.action.${level}` as TKey)}</Text>
    <View style={styles.edition}>
      <Feather name={locked ? 'package' : 'sun'} size={20} color={color.warning} />
      <View style={styles.copy}>
        <Text variant="title">{variant ? t('wild.edition', { name: t(`wild.variant.${variant}` as TKey) }) : t(locked ? 'wild.sealed' : 'wild.preview')}</Text>
        <Text variant="caption" tone="secondary">{t('wild.boxBody')}</Text>
        <Text variant="caption" tone="muted">{t('wild.cosmetic')}</Text>
      </View>
    </View>
    <Text variant="caption" tone="muted">{t('wild.note')}</Text>
    <Text variant="caption" tone="muted">{t('wild.sourceChecked')}</Text>
    <Button variant="secondary" label={t('wild.source')} onPress={() => {
      void Linking.openURL(animal.source).catch(() => Alert.alert(t('wild.sourceError')));
    }} />
  </View>;
}
const styles = StyleSheet.create({
  card: { alignSelf: 'stretch', marginTop: space.m, padding: space.m, borderRadius: radius.l, borderWidth: 1, borderColor: color.borderSubtle, backgroundColor: color.surface, gap: space.s },
  heading: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  habitat: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  explore: { gap: space.s, paddingVertical: space.s, borderTopWidth: 1, borderBottomWidth: 1, borderColor: color.borderSubtle },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  tab: { flexGrow: 1, flexBasis: 70, minHeight: 48, padding: space.s, gap: space.xxs, borderWidth: 1, borderColor: color.borderSubtle, borderRadius: radius.m },
  art: { alignItems: 'center', overflow: 'hidden', borderRadius: radius.m, backgroundColor: color.canvas },
  detailCopy: { gap: space.xs },
  invitation: { borderLeftWidth: 2, padding: space.s, gap: space.xs, backgroundColor: color.elevated },
  edition: { flexDirection: 'row', gap: space.s, padding: space.s, backgroundColor: color.elevated, borderRadius: radius.m },
  copy: { flex: 1, gap: space.xxs },
});
