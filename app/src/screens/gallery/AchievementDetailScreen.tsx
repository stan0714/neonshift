import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { Button, InlineState, Screen, Surface } from '@/components';
import { useT, type TKey } from '@/i18n';
import { achievementLabel } from '@/screens/gallery/PbCard';
import type { RootParamList } from '@/navigation/types';
import { ApiError, apiClient, type GalleryAchievementDetail } from '@/services/api/ApiClient';
import { color, space, Text } from '@/theme';
import { shortAddress } from '@/state/walletStore';
import { PbCard } from './PbCard';

/** NFT 詳情（activity-running-gallery 6.2）：作品、系列、原達成者／現持有人分開、鑄造日期、來源、狀態、network、asset、Explorer */
export function AchievementDetailScreen() {
  const { t } = useT();
  const navigation = useNavigation();
  const { params } = useRoute<RouteProp<RootParamList, 'AchievementDetail'>>();
  const [data, setData] = useState<GalleryAchievementDetail | null>(null);
  const [err, setErr] = useState<{ code: string; message: string } | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await apiClient.galleryAchievement(params.asset));
      setErr(null);
    } catch (e) {
      setData(null); // 對方退出藝廊（NOT_FOUND）或失敗：不留舊作品（review P1-2）
      setErr(e instanceof ApiError ? { code: e.code, message: e.message } : { code: 'UNKNOWN', message: String(e) });
    }
  }, [params.asset]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Screen scroll testID="achievement-detail-screen">
      {err ? <InlineState kind={err.code === 'NOT_FOUND' ? 'info' : 'error'} title={err.code === 'NOT_FOUND' ? t('gal.missing.title') : t('common.somethingInterrupted')} body={err.code === 'NOT_FOUND' ? t('gal.missing.body') : t('nftd.err', { message: err.message })} testID="achievement-error" /> : null}
      {data ? (
        <>
          <View style={styles.cardWrap}>
            <PbCard a={data} testID="achievement-card" />
          </View>
          {data.record === 'invalidated' ? <InlineState kind="warning" title={t('gal.record.invalidated')} body={t('nftd.invalidatedBody')} testID="achievement-invalidated" /> : null}
          <Surface style={styles.card}>
            <Row label={t('nftd.series')} value={`${t(`gal.series.${data.series}` as TKey)} · ${achievementLabel(t, data)}`} />
            <Row label={t('nftd.source')} value={t(`gal.source.${data.verification_class}` as TKey)} />
            <Row label={t('nftd.status')} value={t(`gal.record.${data.record}` as TKey)} />
            <Row label={t('nftd.achiever')} value={shortAddress(data.original_achiever)} onPress={() => navigation.navigate('GalleryPlayer', { wallet: data.original_achiever })} testID="achievement-achiever" />
            <Row label={t('nftd.holder')} value={t('nftd.holderNote')} />
            <Row label={t('nftd.minted')} value={data.minted_at ? data.minted_at.slice(0, 10) : '—'} />
            <Row label={t('nftd.network')} value={data.network} />
            <Row label={t('nftd.asset')} value={data.asset ? shortAddress(data.asset, 8) : '—'} />
          </Surface>
          <Button label={t('nftd.explorer')} variant="secondary" style={styles.card} onPress={() => void Linking.openURL(data.explorer_url)} testID="achievement-explorer" />
        </>
      ) : null}
    </Screen>
  );
}

function Row({ label, value, onPress, testID }: { label: string; value: string; onPress?: () => void; testID?: string }) {
  const inner = (
    <View style={styles.row}>
      <Text variant="caption" tone="muted" uppercase style={styles.rowLabel}>
        {label}
      </Text>
      <Text variant="bodySmall" tone={onPress ? 'cyan' : 'primary'} style={styles.rowValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
  return onPress ? <Pressable onPress={onPress} accessibilityRole="link" testID={testID}>{inner}</Pressable> : inner;
}

const styles = StyleSheet.create({
  cardWrap: { width: '60%', alignSelf: 'center', marginTop: space.m },
  card: { marginTop: space.m },
  row: { flexDirection: 'row', gap: space.s, paddingVertical: space.xs, borderBottomWidth: 1, borderBottomColor: color.borderSubtle },
  rowLabel: { width: 110 },
  rowValue: { flex: 1 },
});
