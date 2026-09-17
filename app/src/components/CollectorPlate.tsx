import { StyleSheet, View } from 'react-native';

import { wildlifeOf } from '@/config/shoeCollection';
import { SHOE_PROGRESSION, type ShoeLevel } from '@/config/shoeProgression';
import { stageName } from '@/domain/collectibles';
import type { CollectibleEdition } from '@/services/chain/CollectibleService';
import { useT } from '@/i18n';
import { color, radius, space, Text } from '@/theme';

/**
 * 編號狀態：
 * - `preview`：示意編號（DEMO），標明正式編號依鏈上領取順序
 * - `unclaimed`：已達階但尚未領取紀念 NFT（升階揭曉當下）
 * - `loading`／`unavailable`：查詢中／RPC 失敗
 * - `CollectibleEdition`：第 n 位領取，共 total 位
 */
export type EditionState = CollectibleEdition | 'preview' | 'unclaimed' | 'loading' | 'unavailable';

export const formatEditionNo = (n: number) => `No. ${n < 10_000 ? String(n).padStart(4, '0') : String(n)}`;

/** 收藏銘牌：系列 · 鞋階／物種 · NFT 編號（拆盒揭曉、NFT 揭曉、跑鞋詳情共用） */
export function CollectorPlate({ level, edition, compact = false }: { level: ShoeLevel; edition: EditionState; compact?: boolean }) {
  const { t } = useT();
  const stage = SHOE_PROGRESSION.stages[level - 1];
  const animal = wildlifeOf(level);
  const no = typeof edition === 'object' ? formatEditionNo(edition.edition) : edition === 'preview' ? formatEditionNo(1) : edition === 'loading' ? 'No. …' : 'No. ——';
  const caption =
    typeof edition === 'object' ? t('nft.editionCaption', { n: edition.edition, total: edition.total })
    : edition === 'preview' ? t('nft.editionPreview')
    : edition === 'unclaimed' ? t('nft.editionUnclaimed')
    : edition === 'loading' ? t('nft.editionLoading')
    : t('nft.editionUnavailable');
  return (
    <View style={[styles.plate, { borderColor: `${stage.tint}66` }, compact && styles.compact]} testID={`collector-plate-${level}`}>
      <View style={styles.row}>
        <Text variant="label" tone="mint">{animal ? t('wild.series') : t('col.shoe')}</Text>
        <Text variant="label" tone="muted">{t('nft.plate.stage', { n: level, total: SHOE_PROGRESSION.stages.length })}</Text>
      </View>
      <View style={styles.row}>
        <Text variant="title">{stageName(t, level)}</Text>
        <Text variant={compact ? 'title' : 'heading2'} numeric style={{ color: stage.tint }} testID="collector-plate-no">{no}</Text>
      </View>
      <Text variant="caption" tone="secondary" testID="collector-plate-caption">{caption}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  plate: { alignSelf: 'stretch', borderWidth: 1, borderRadius: radius.l, backgroundColor: color.surface, padding: space.m, gap: space.xs },
  compact: { padding: space.s },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.s },
});
