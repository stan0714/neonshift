import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { Chip, Surface } from '@/components';
import { useT, type TKey } from '@/i18n';
import type { GalleryAchievement } from '@/services/api/ApiClient';
import { color, radius, space, Text } from '@/theme';

/**
 * PB NFT 卡片（Style 20；activity-running-gallery 6.1／6.2）：Speed＝青藍計時環、Distance＝紫綠里程弧（抽象、不畫路線）；
 * 類別、來源、Current／Historical／Invalidated 都用文字；未公開的值顯示「數值未公開」。
 */
export function PbCard({ a, onPress, testID }: { a: GalleryAchievement; onPress?: () => void; testID?: string }) {
  const { t } = useT();
  const speed = a.series === 'pb_speed';
  const tint = a.verification_class === 'organizer' ? color.mint : speed ? color.cyan : color.violet;
  const label = t(`pb.cat.${a.category}` as TKey);
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={`${label} · ${t(`gal.record.${a.record}` as TKey)}`} testID={testID}>
      <Surface level="elevated" style={[styles.tile, a.record === 'invalidated' && styles.dim]}>
        <View style={[styles.art, { borderColor: tint }]}>
          <View style={[styles.ring, { borderColor: tint }, !speed && styles.arc]} />
          <Feather name={speed ? 'zap' : 'map'} size={28} color={tint} />
        </View>
        <Text variant="title" numberOfLines={1}>
          {label}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {t(`gal.series.${a.series}` as TKey)} · {t(`gal.source.${a.verification_class}` as TKey)}
        </Text>
        <Text variant="caption" tone={a.public ? 'secondary' : 'muted'} numeric numberOfLines={1}>
          {a.public && a.value ? a.value : t('gal.private')}
        </Text>
        <View style={styles.chipRow}>
          <Chip label={t(`gal.record.${a.record}` as TKey)} kind={a.record === 'current' ? 'synced' : a.record === 'historical' ? 'neutral' : 'devnet'} />
        </View>
      </Surface>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1, padding: space.s, borderRadius: radius.l },
  dim: { opacity: 0.7 },
  art: { aspectRatio: 1, borderRadius: radius.m, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: space.xs, backgroundColor: color.surface, overflow: 'hidden' },
  ring: { position: 'absolute', width: '70%', aspectRatio: 1, borderRadius: 999, borderWidth: 2, opacity: 0.45 },
  arc: { borderRadius: 999, transform: [{ scaleY: 0.6 }], borderStyle: 'dashed' },
  chipRow: { marginTop: space.xs, flexDirection: 'row' },
});
