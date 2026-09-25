import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { StyleSheet, View } from 'react-native';

import { Button, Chip, InlineState } from '@/components';
import { SeasonalBadge, type SeasonalBadgeState } from '@/components/SeasonalBadge';
import { useT, useLocaleStore, type TKey } from '@/i18n';
import type { RootParamList } from '@/navigation/types';
import { apiClient, type MySeasonalItem, type SeasonalCampaignView } from '@/services/api/ApiClient';
import { useWalletStore } from '@/state/walletStore';
import { color, radius, space, Text } from '@/theme';

/**
 * Seasonal Footprints（PG-SEASON-03；設計 §4）。
 *
 * 這一版只呈現「活動與資格狀態」：後端還沒有 seasonal 的 registry／mint 路徑
 * （`mint_enabled: false`），所以達標只寫「已達標，本屆尚未開放領取」，
 * 不出現領取按鈕、不播放揭曉動畫、也不說已取得 NFT（§4.3）。
 *
 * 未登入時顯示公開目錄（即將開始／進行中），登入後才有個人進度。
 */
type Row = SeasonalCampaignView & Partial<Pick<MySeasonalItem, 'status' | 'first' | 'pending' | 'progress'>>;

const badgeState = (r: Row): SeasonalBadgeState => (r.status === 'eligible' ? 'earned' : r.status === 'pending_review' ? 'pending' : 'locked');

/** 活動時區的日期範圍，加上一行使用者本地時間；不採可隨裝置改的當下時區做判定 */
const windowLabel = (r: Row, locale: string) => {
  const start = new Date(r.window.starts_at);
  const end = new Date(new Date(r.window.ends_at).getTime() - 1);
  const fmt = (d: Date, tz: string) => d.toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: tz });
  return { inZone: `${fmt(start, r.window.display_timezone)} – ${fmt(end, r.window.display_timezone)}`, local: `${fmt(start, Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')} – ${fmt(end, Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')}` };
};

const chipKind = (state: SeasonalCampaignView['window']['state']) => (state === 'open' ? 'level' : state === 'grace' ? 'devnet' : state === 'upcoming' ? 'synced' : 'neutral');

export function SeasonalFootprints({ reloadKey = 0 }: { reloadKey?: number | string }) {
  const { t } = useT();
  const locale = useLocaleStore((s) => s.locale);
  const navigation = useNavigation<NativeStackNavigationProp<RootParamList>>();
  const session = useWalletStore((s) => s.session);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      // 登入後才問個人資格；未登入只拿公開目錄，不因為沒登入就整段消失
      const r = session ? await apiClient.mySeasonal() : await apiClient.seasonal();
      setRows(r.items);
      setFailed(false);
    } catch {
      setRows((prev) => prev ?? []);
      setFailed(true);
    }
  }, [session]);
  useEffect(() => { void load(); }, [load, reloadKey]);
  // 待審轉核准是伺服器端非同步發生的：回到這個分頁就重抓
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (rows === null) return null;
  return (
    <View testID="seasonal-footprints">
      <Text variant="label" tone="secondary" uppercase style={styles.head}>{t('season.title')}</Text>
      <Text variant="caption" tone="muted" style={styles.note}>{t('season.intro')}</Text>
      {failed ? <InlineState kind="warning" title={t('season.loadFailed')} testID="seasonal-failed" /> : null}
      {rows.length === 0 ? (
        <Text variant="bodySmall" tone="muted" testID="seasonal-empty">{t('season.none')}</Text>
      ) : (
        <View style={styles.list}>
          {rows.map((r) => {
            const w = windowLabel(r, locale);
            const state = badgeState(r);
            const nameKey = `season.name.${r.theme_id}` as TKey;
            const name = t(nameKey);
            return (
              <View key={r.campaign_id} style={styles.card} testID={`seasonal-${r.campaign_id}`}>
                <View style={styles.row}>
                  <SeasonalBadge themeId={r.theme_id} year={r.year} state={state} size={84} />
                  <View style={styles.body}>
                    <Text variant="title">{name === nameKey ? r.theme_id : name}</Text>
                    <View style={styles.chips}>
                      <Chip label={t(`season.window.${r.window.state}` as TKey)} kind={chipKind(r.window.state)} />
                      {r.prototype ? <Chip label={t('season.prototype')} kind="devnet" /> : null}
                    </View>
                    <Text variant="caption" tone="secondary" numeric testID={`seasonal-${r.campaign_id}-window`}>
                      {w.inZone} ({r.window.display_timezone})
                    </Text>
                    <Text variant="caption" tone="muted" numeric>{t('season.localTime', { range: w.local })}</Text>
                  </View>
                </View>
                <Text variant="caption" tone="secondary" style={styles.rule}>
                  {t('season.rule', { min: r.rules.min_moving_minutes, days: r.rules.grace_days })}
                </Text>
                {r.status ? (
                  <View style={styles.status} testID={`seasonal-${r.campaign_id}-status-${r.status}`}>
                    {r.status === 'eligible' ? (
                      // 達標不等於已取得：後端沒有鑄造路徑，這裡就不能出現領取按鈕
                      <InlineState kind="success" title={t('season.state.eligible')} body={t('season.state.eligibleBody')} />
                    ) : r.status === 'pending_review' ? (
                      <InlineState kind="info" title={t('season.state.pending')} body={t('season.state.pendingBody')} />
                    ) : (
                      <Text variant="bodySmall" tone="secondary">
                        {t('season.progress', { done: Math.floor((r.progress?.best_moving_ms ?? 0) / 60_000), min: r.rules.min_moving_minutes })}
                      </Text>
                    )}
                    {r.first ? (
                      <Button
                        label={t('season.viewSource')}
                        variant="secondary"
                        onPress={() => navigation.navigate('ActivityDetail', { serverId: r.first!.source.id })}
                        testID={`seasonal-${r.campaign_id}-source`}
                      />
                    ) : null}
                  </View>
                ) : null}
                {r.window.state === 'open' && r.status !== 'eligible' ? (
                  <Button label={t('season.start')} variant="secondary" style={styles.cta} onPress={() => navigation.navigate('WorkoutStart')} testID={`seasonal-${r.campaign_id}-start`} />
                ) : null}
                <Text variant="caption" tone="muted" style={styles.source}>{t('season.sourceNote', { fact: r.source.fact })}</Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { marginTop: space.l, marginBottom: space.xs },
  note: { marginBottom: space.s },
  list: { gap: space.s },
  card: { borderWidth: 1, borderColor: color.borderSubtle, borderRadius: radius.m, padding: space.m, backgroundColor: color.surface, gap: space.xs },
  row: { flexDirection: 'row', gap: space.m, alignItems: 'flex-start' },
  body: { flex: 1, gap: space.xxs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  rule: { marginTop: space.xs },
  status: { gap: space.s, marginTop: space.xs },
  cta: { marginTop: space.xs },
  source: { marginTop: space.xs },
});
