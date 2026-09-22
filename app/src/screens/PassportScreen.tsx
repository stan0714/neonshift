import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { Chip, InlineState, Screen, Surface } from '@/components';
import { SignInState } from '@/components/SignInState';
import { t as tStatic, useT, type TKey } from '@/i18n';
import { ApiError, apiClient, type PassportEntry, type PassportResponse } from '@/services/api/ApiClient';
import { apiErrorText } from '@/services/api/errorText';
import { useWalletStore } from '@/state/walletStore';
import { color, radius, space, Text } from '@/theme';

/**
 * XD-03 成就護照（mobile-differentiation 4.3；Style 24.9）：本人只讀旅程視圖。
 * 每項：標題、種類、來源分類（主辦確認／裝置紀錄／待驗證）、達成日、規則版本、目前有效狀態、公開與否、NFT 狀態。
 * 不顯示健康數字、路線或座標；NFT 詳情仍走既有 AchievementDetail。信任邊界：裝置紀錄是感測器摘要經伺服器規則檢查，不是硬體證明。
 */
type Filter = 'all' | 'valid' | 'pending' | 'revoked';
const SOURCE_CHIP: Record<PassportEntry['source_class'], 'synced' | 'neutral' | 'devnet'> = { organizer: 'synced', device: 'neutral', pending: 'devnet' };
const VALID_CHIP: Record<PassportEntry['validity'], 'synced' | 'devnet' | 'offline' | 'neutral'> = { valid: 'synced', pending: 'devnet', revoked: 'offline', locked: 'neutral' };

export function titleOf(t: (k: TKey) => string, e: PassportEntry): string {
  const k = e.title_key as TKey;
  const s = t(k);
  return s === e.title_key ? e.category : s;
}

export function PassportScreen() {
  const { t } = useT();
  const navigation = useNavigation();
  const session = useWalletStore((s) => s.session);
  const [data, setData] = useState<PassportResponse | null>(null);
  const [err, setErr] = useState<{ code: string; message: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async () => {
    if (!session) { setData(null); return; }
    setLoading(true);
    try {
      setData(await apiClient.passport());
      setErr(null);
    } catch (e) {
      setErr({ code: e instanceof ApiError ? e.code : 'UNKNOWN', message: apiErrorText(tStatic, e) });
    } finally {
      setLoading(false);
    }
  }, [session]);
  useEffect(() => { void load(); }, [load]);

  if (!session) return <Screen testID="passport-screen"><InlineState kind="info" title={t('act.signin.title')} body={t('act.signin.body')} testID="passport-signin" /></Screen>;
  const entries = (data?.entries ?? []).filter((e) => filter === 'all' || e.validity === filter);
  return (
    <Screen scroll testID="passport-screen" refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={color.mint} />}>
      <Text variant="bodySmall" tone="secondary">{t('pass.intro')}</Text>
      {err ? (
        err.code === 'NO_SESSION' ? <SignInState title={t('explore.signin.title')} body={t('explore.signin.body')} onSignedIn={load} testID="passport-signin" />
          : <InlineState kind={err.code === 'NETWORK_ERROR' ? 'warning' : 'error'} title={err.code === 'NETWORK_ERROR' ? t('common.devnetBreak') : t('common.somethingInterrupted')} body={err.message} action={{ label: t('common.tryAgain'), onPress: () => void load(), loading }} testID="passport-error" />
      ) : null}
      {data ? (
        <View style={styles.counts} testID="passport-counts">
          {(['valid', 'pending', 'revoked', 'locked'] as const).map((k) => (
            <View key={k} style={styles.count}>
              <Text variant="heading2" numeric>{data.counts[k]}</Text>
              <Text variant="caption" tone="muted">{t(`pass.validity.${k}` as TKey)}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <View style={styles.filters} accessibilityRole="tablist">
        {(['all', 'valid', 'pending', 'revoked'] as const).map((f) => (
          <Pressable key={f} onPress={() => setFilter(f)} accessibilityRole="tab" accessibilityState={{ selected: filter === f }} style={[styles.filter, filter === f && styles.filterOn]} testID={`passport-filter-${f}`}>
            <Text variant="caption" tone={filter === f ? undefined : 'secondary'} style={filter === f && styles.filterOnText}>{t(`pass.filter.${f}` as TKey)}</Text>
          </Pressable>
        ))}
      </View>
      {data && entries.length === 0 ? <Text variant="bodySmall" tone="secondary" style={styles.mt} testID="passport-empty">{t('pass.empty')}</Text> : null}
      {entries.map((e) => (
        <Surface key={e.id} style={styles.card} testID={`passport-entry-${e.kind}-${e.category}-${e.validity}`}>
          <View style={styles.head}>
            <View style={styles.flex}>
              <Text variant="label" tone="muted" uppercase>{t(`pass.kind.${e.kind}` as TKey)}</Text>
              <Text variant="title">{titleOf(t, e)}</Text>
            </View>
            <Chip label={t(`pass.validity.${e.validity}` as TKey)} kind={VALID_CHIP[e.validity]} />
          </View>
          <View style={styles.row}>
            <Chip label={t(`pass.source.${e.source_class}` as TKey)} kind={SOURCE_CHIP[e.source_class]} />
            <Text variant="caption" tone="muted">{e.achieved_at ? new Date(e.achieved_at).toLocaleDateString() : t('pass.noDate')} · {t('pass.rules', { v: e.rules_version })}</Text>
          </View>
          {e.reason ? <Text variant="caption" tone="warning" style={styles.mtXs}>{t(`pass.reason.${e.reason}` as TKey) === `pass.reason.${e.reason}` ? e.reason : t(`pass.reason.${e.reason}` as TKey)}</Text> : null}
          <Text variant="caption" tone="muted" style={styles.mtXs}>
            {e.public ? t('pass.public') : t('pass.private')}{e.nft ? ` · ${t(`pass.nft.${e.nft.status}` as TKey)}` : ` · ${t('pass.nft.none')}`}{e.source ? ` · ${t('pass.sourceRef', { kind: e.source.kind, rev: e.source.revision })}` : ''}
          </Text>
          {e.nft?.asset ? (
            <Pressable onPress={() => navigation.navigate('AchievementDetail', { asset: e.nft!.asset! })} accessibilityRole="link" style={styles.link} testID={`passport-nft-${e.category}`}>
              <Text variant="bodySmall" tone="cyan">{t('pass.openNft')}</Text>
            </Pressable>
          ) : null}
        </Surface>
      ))}
      <Text variant="caption" tone="muted" style={styles.mt} testID="passport-trust">{t('pass.trust')}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  mt: { marginTop: space.m },
  mtXs: { marginTop: space.xs },
  flex: { flex: 1, minWidth: 0 },
  counts: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s, marginTop: space.m },
  count: { flexGrow: 1, flexBasis: '20%', padding: space.s, borderRadius: radius.m, backgroundColor: color.elevated, alignItems: 'center' },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.m },
  filter: { minHeight: 36, paddingHorizontal: space.s, borderRadius: radius.m, borderWidth: 1, borderColor: color.borderSubtle, alignItems: 'center', justifyContent: 'center' },
  filterOn: { backgroundColor: color.mint, borderColor: color.mint },
  filterOnText: { color: color.onMint },
  card: { marginTop: space.s },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space.s },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.s, marginTop: space.xs },
  link: { minHeight: 32, justifyContent: 'center', marginTop: space.xs },
});
