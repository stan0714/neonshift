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

/**
 * 供給：鞋階紀念 NFT 不限量（達階即可免費領，永遠開放）→ `open`，編號不補零、不出現上限；
 * 活動限量款才有 `{ limit }` → 補零到上限位數並顯示 `/ 上限`。
 */
export type EditionSupply = 'open' | { limit: number };

export const formatEditionNo = (n: number, supply: EditionSupply = 'open') => {
  if (supply === 'open') return `No. ${n.toLocaleString()}`;
  const width = String(supply.limit).length;
  return `No. ${String(n).padStart(width, '0')} / ${supply.limit.toLocaleString()}`;
};

/** 收藏銘牌：系列 · 鞋階／物種 · NFT 編號（拆盒揭曉、NFT 揭曉、跑鞋詳情共用） */
export function CollectorPlate({ level, edition, supply = 'open', compact = false }: { level: ShoeLevel; edition: EditionState; supply?: EditionSupply; compact?: boolean }) {
  const { t } = useT();
  const stage = SHOE_PROGRESSION.stages[level - 1];
  const animal = wildlifeOf(level);
  const no = typeof edition === 'object' ? formatEditionNo(edition.edition, supply) : edition === 'preview' ? formatEditionNo(1, supply) : edition === 'loading' ? 'No. …' : 'No. ——';
  const supplyText = supply === 'open' ? t('nft.supplyOpen') : t('nft.supplyLimited', { limit: supply.limit.toLocaleString() });
  const caption =
    typeof edition === 'object' ? t('nft.editionCaption', { n: edition.edition, total: edition.total, supply: supplyText })
    : edition === 'preview' ? t('nft.editionPreview', { supply: supplyText })
    : edition === 'unclaimed' ? t('nft.editionUnclaimed')
    : edition === 'loading' ? t('nft.editionLoading')
    : t('nft.editionUnavailable');
  return (
    <View style={[styles.plate, { borderColor: `${stage.tint}66` }, compact && styles.compact]} testID={`collector-plate-${level}`}>
      <View style={styles.row}>
        <Text variant="label" tone="mint">{animal ? t('wild.series') : t('col.shoe')}</Text>
        <Text variant="label" tone="muted" style={styles.right}>{t('nft.plate.stage', { n: level, total: SHOE_PROGRESSION.stages.length })} · {supplyText}</Text>
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
  right: { flexShrink: 1, textAlign: 'right' },
});
