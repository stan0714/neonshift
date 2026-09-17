import { Feather } from '@expo/vector-icons';
import { Alert, Linking, StyleSheet, View } from 'react-native';
import { Button } from './Button';
import { shoeVariant, wildlifeOf } from '@/config/shoeCollection';
import type { ShoeLevel } from '@/config/shoeProgression';
import { useWalletStore } from '@/state/walletStore';
import { useT, type TKey } from '@/i18n';
import { color, radius, space, Text } from '@/theme';

export function ShoeStory({ level, locked = false, preview = false }: { level: ShoeLevel; locked?: boolean; preview?: boolean }) {
  const { t } = useT();
  const owner = useWalletStore(s => s.session?.publicKey.toString() ?? null);
  const animal = wildlifeOf(level);
  if (!animal) return null;
  const variant = shoeVariant(preview || locked ? null : owner, level);
  return <View style={styles.card} testID={`shoe-story-${level}`}>
    <View style={styles.heading}><Feather name="feather" size={20} color={color.mint} /><Text variant="label" tone="mint">{t('wild.series')}</Text></View>
    <Text variant="heading2">{t(`col.stage.${level}` as TKey)}</Text>
    <Text variant="caption" tone="secondary">{animal.scientific} · {t(`wild.status.${animal.status}` as TKey)}</Text>
    <Text variant="bodySmall" tone="secondary">{t(`wild.story.${level}` as TKey)}</Text>
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
    <Button variant="secondary" label={t('wild.source')} onPress={() => {
      void Linking.openURL(animal.source).catch(() => Alert.alert(t('wild.sourceError')));
    }} />
  </View>;
}
const styles = StyleSheet.create({
  card: { alignSelf: 'stretch', marginTop: space.m, padding: space.m, borderRadius: radius.l, borderWidth: 1, borderColor: color.borderSubtle, backgroundColor: color.surface, gap: space.s },
  heading: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  edition: { flexDirection: 'row', gap: space.s, padding: space.s, backgroundColor: color.elevated, borderRadius: radius.m },
  copy: { flex: 1, gap: space.xxs },
});
