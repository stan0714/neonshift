import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SvgUri } from 'react-native-svg';

import { Chip, Surface } from '@/components';
import { useT, type TKey } from '@/i18n';
import type { GalleryAchievement } from '@/services/api/ApiClient';
import { color, radius, space, Text } from '@/theme';

/**
 * PB NFT 卡片（Style 20；activity-running-gallery 6.1／6.2）：Speed＝青藍計時環、Distance＝紫綠里程弧（抽象、不畫路線）；
 * 類別、來源、Current／Historical／Invalidated 都用文字；未公開的值顯示「數值未公開」。
 * PG-M-03：首次里程碑（genesis_distance／first_finish）同一卡片，圖示 award／flag、文字不與 PB 混稱。
 */
export const achievementLabel = (t: ReturnType<typeof useT>['t'], a: Pick<GalleryAchievement, 'series' | 'category' | 'event'>) =>
  a.series === 'event_check_in' || a.series === 'event_finish' ? (a.event?.title ?? t('gal.series.' + a.series as TKey)) : a.series === 'genesis_distance' || a.series === 'first_finish' ? t(`ms.cat.${a.category}` as TKey) : t(`pb.cat.${a.category}` as TKey);
export function PbCard({ a, onPress, testID }: { a: GalleryAchievement; onPress?: () => void; testID?: string }) {
  const { t } = useT();
  const speed = a.series === 'pb_speed';
  const milestone = a.series === 'genesis_distance' || a.series === 'first_finish';
  const event = a.series === 'event_check_in' || a.series === 'event_finish';
  const tint = a.verification_class === 'organizer' ? color.mint : speed ? color.cyan : color.violet;
  const label = achievementLabel(t, a);
  // review P2-6：用對應作品圖（後端 metadata image，SVG）；載入失敗退回通用圖示
  const [artFailed, setArtFailed] = useState(false);
  const showArt = !!a.image && /\.svg(\?|$)/i.test(a.image) && !artFailed;
  // 紀念語：首次完成／刷新紀錄／參與活動（技術欄位留在詳情）
  const story = event ? (a.series === 'event_finish' ? t('gal.story.eventFinish') : t('gal.story.eventCheckIn')) : milestone ? t('gal.story.first') : a.record === 'current' ? t('gal.story.pbCurrent') : a.record === 'historical' ? t('gal.story.pbHistorical') : t('gal.story.invalidated');
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={`${label} · ${t(`gal.record.${a.record}` as TKey)}`} testID={testID}>
      <Surface level="elevated" style={[styles.tile, a.record === 'invalidated' && styles.dim]}>
        <View style={[styles.art, { borderColor: tint }]}>
          {showArt ? (
            <SvgUri uri={a.image} width="100%" height="100%" onError={() => setArtFailed(true)} testID="pb-card-art" />
          ) : (
            <>
              <View style={[styles.ring, { borderColor: tint }, !speed && styles.arc]} />
              <Feather name={event ? (a.series === 'event_finish' ? 'flag' : 'check-circle') : milestone ? (a.series === 'first_finish' ? 'flag' : 'award') : speed ? 'zap' : 'map'} size={28} color={tint} />
            </>
          )}
        </View>
        <Text variant="caption" tone="mint" numberOfLines={1}>
          {story}
        </Text>
        <Text variant="title" numberOfLines={1}>
          {label}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {t(`gal.series.${a.series}` as TKey)} · {t(`gal.source.${a.verification_class}` as TKey)}
        </Text>
        <Text variant="caption" tone={a.public ? 'secondary' : 'muted'} numeric numberOfLines={1}>
          {a.public && a.value ? a.value : event ? (a.achieved_on ?? t('gal.privateEvent')) : milestone && !a.public ? t('gal.privateMilestone') : t('gal.private')}
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
