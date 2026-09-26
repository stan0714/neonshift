import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { Button, Chip, InlineState, Screen, Surface } from '@/components';
import { ShareImageBlock } from '@/components/ShareImageBlock';
import { SignInState } from '@/components/SignInState';
import { APP_CONFIG } from '@/config/app';
import { passportShareLayout, PASSPORT_SHARE_EMBLEMS, shareUrl } from '@/domain/shareImage';
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
  const [shareOpen, setShareOpen] = useState(false);

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
      {/* PG-SHARE-06 時機 S3：護照卡。有效枚數與畫面同一個判斷，待核准／撤銷不計入也不進格子 */}
      {data && data.counts.valid > 0 ? (
        <Surface style={styles.card} testID="passport-share-card">
          <Button label={t('share.card.image')} variant="secondary" onPress={() => setShareOpen((o) => !o)} accessibilityState={{ expanded: shareOpen }} testID="passport-share-open" />
          {shareOpen ? <PassportShare entries={data.entries} validCount={data.counts.valid} /> : null}
        </Surface>
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

/**
 * 護照卡（PG-SHARE-06 時機 S3）。主數字是**目前有效**的枚數——與畫面上的 valid 計數同一個來源，
 * 待核准、已撤銷與上鎖都不算；「有效」也不等於「鏈上有」，所以網路標示看已鑄造的枚數，
 * 一枚都沒鑄造就不掛（social-share §4.5）。這張卡不放達成日期、成績與 asset id。
 */
function PassportShare({ entries, validCount }: { entries: PassportEntry[]; validCount: number }) {
  const { t } = useT();
  const valid = entries.filter((e) => e.validity === 'valid');
  const url = shareUrl(APP_CONFIG.siteUrl, 'passport', 'passport');
  // 格子只取有效項目的種類，重複的種類不佔兩格（同一種類拿兩枚在圖上看起來像數錯）
  const emblems = [...new Set(valid.map((e) => e.category))].slice(0, PASSPORT_SHARE_EMBLEMS);
  const layout = passportShareLayout(
    { validCount, mintedCount: valid.filter((e) => e.nft?.status === 'minted').length, emblems },
    {
      t: (k, pr) => t(k as TKey, pr),
      labels: { tagline: t('share.card.tagline'), site: 'neonshift.cc', notice: APP_CONFIG.cluster === 'mainnet-beta' ? t('share.card.net.mainnet') : t('share.card.net.devnet') },
      qr: url,
    },
  );
  return <ShareImageBlock layout={layout} caption={t('share.invite.passport', { n: validCount, url })} prefix="passport-share" />;
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
