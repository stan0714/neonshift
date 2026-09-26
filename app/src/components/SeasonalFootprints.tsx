import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { Button, Chip, InlineState } from '@/components';
import { SeasonalBadge, type SeasonalBadgeState } from '@/components/SeasonalBadge';
import { ShareImageBlock } from '@/components/ShareImageBlock';
import { APP_CONFIG } from '@/config/app';
import { seasonalShareLayout, SEASONAL_SHARE_DEFAULT, shareUrl, type SeasonalShareFields } from '@/domain/shareImage';
import { useT, useLocaleStore, type TKey } from '@/i18n';
import type { RootParamList } from '@/navigation/types';
import { apiClient, type MySeasonalItem, type SeasonalCampaignView } from '@/services/api/ApiClient';
import { useSeasonalReminderStore } from '@/state/seasonalReminderStore';
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
  // PG-SEASON-06：訂閱清單存在本機（裝置層、不分錢包、不上傳）
  const reminders = useSeasonalReminderStore();
  useEffect(() => { void reminders.load(); }, [reminders.load]);
  /** 年份篩選（設計 §5「不把每年卡片全部塞到首頁」）；'all' 代表不篩 */
  const [year, setYear] = useState<number | 'all'>('all');

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
  // 年份新的在前，同年依窗口開始排——每年一屆，時間順序才讀得懂（設計 §7「收藏年份排序」）
  const years = [...new Set(rows.map((r) => r.year))].sort((a, b) => b - a);
  const shown = rows
    .filter((r) => year === 'all' || r.year === year)
    .sort((a, b) => b.year - a.year || Date.parse(a.window.starts_at) - Date.parse(b.window.starts_at));
  return (
    <View testID="seasonal-footprints">
      <Text variant="label" tone="secondary" uppercase style={styles.head}>{t('season.title')}</Text>
      <Text variant="caption" tone="muted" style={styles.note}>{t('season.intro')}</Text>
      {failed ? <InlineState kind="warning" title={t('season.loadFailed')} testID="seasonal-failed" /> : null}
      {/* 只有跨年份才給篩選：一個年份時這排按鈕只是雜訊 */}
      {years.length > 1 ? (
        <View style={styles.years} accessibilityRole="tablist" testID="seasonal-years">
          {(['all', ...years] as const).map((y) => (
            <Pressable
              key={String(y)}
              onPress={() => setYear(y as number | 'all')}
              accessibilityRole="tab"
              accessibilityState={{ selected: year === y }}
              accessibilityLabel={y === 'all' ? t('season.year.all') : `${t('season.yearFilter')} ${y}`}
              style={[styles.year, year === y && styles.yearOn]}
              testID={`seasonal-year-${y}`}
            >
              <Text variant="caption" tone={year === y ? undefined : 'secondary'} style={year === y && styles.yearOnText}>
                {y === 'all' ? t('season.year.all') : String(y)}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {rows.length === 0 ? (
        <Text variant="bodySmall" tone="muted" testID="seasonal-empty">{t('season.none')}</Text>
      ) : (
        <View style={styles.list}>
          {shown.map((r) => {
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
                {/* PG-SEASON-06：只有 App 內提醒，沒有推播——開關旁邊直接講清楚 */}
                {r.window.state !== 'closed' ? (
                  <View style={styles.remindRow}>
                    <Text variant="bodySmall" tone="secondary" style={styles.flex}>{t('season.remind')}</Text>
                    <Switch
                      value={reminders.subscribed.includes(r.campaign_id)}
                      onValueChange={() => void reminders.toggle(r.campaign_id)}
                      trackColor={{ true: color.mint, false: color.borderSubtle }}
                      thumbColor={color.textPrimary}
                      accessibilityLabel={t('season.remind')}
                      testID={`seasonal-${r.campaign_id}-remind`}
                    />
                  </View>
                ) : null}
                {r.window.state !== 'closed' && reminders.subscribed.includes(r.campaign_id) ? (
                  <Text variant="caption" tone="muted" testID={`seasonal-${r.campaign_id}-remind-note`}>{t('season.remindNote')}</Text>
                ) : null}
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
                {/* PG-SEASON-05：已達標或待驗證才有分享卡；狀態由 domain 如實寫在圖上 */}
                {r.status === 'eligible' || r.status === 'pending_review' ? (
                  <SeasonalShare
                    campaignId={r.campaign_id}
                    themeId={r.theme_id}
                    themeName={name === nameKey ? r.theme_id : name}
                    year={r.year}
                    status={r.status}
                    windowLabel={`${w.inZone} (${r.window.display_timezone})`}
                    achievedAt={(r.status === 'eligible' ? r.first : r.pending)?.started_at ?? null}
                    mintEnabled={r.mint_enabled}
                  />
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

/**
 * 節日收藏卡入口（PG-SEASON-05）。預設收起來——這一頁一屆一張卡，每張都攤開會變成一面牆。
 *
 * 「我什麼時候達標的」預設不進圖，而且勾選後也只到月份：活動日期是公開主題，
 * 使用者的取得時間是個人資訊（設計 §4.5）。這兩件事在畫面上分開講清楚。
 */
function SeasonalShare({
  campaignId, themeId, themeName, year, status, windowLabel, achievedAt, mintEnabled,
}: {
  campaignId: string; themeId: string; themeName: string; year: number;
  status: 'eligible' | 'pending_review'; windowLabel: string; achievedAt: string | null; mintEnabled: boolean;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<SeasonalShareFields>(SEASONAL_SHARE_DEFAULT);
  const url = shareUrl(APP_CONFIG.siteUrl, 'seasonal', 'seasonal');
  const layout = seasonalShareLayout(
    { themeName, themeId, year, status, windowLabel, achievedAt: achievedAt ? new Date(achievedAt) : null, mintEnabled },
    fields,
    { t: (k, p) => t(k as TKey, p), labels: { tagline: t('share.card.tagline'), site: 'neonshift.cc' }, qr: url },
  );
  return (
    <View style={styles.share} testID={`seasonal-${campaignId}-share`}>
      <Button label={t('season.share')} variant="secondary" onPress={() => setOpen((o) => !o)} accessibilityState={{ expanded: open }} testID={`seasonal-${campaignId}-share-open`} />
      {open ? (
        <ShareImageBlock layout={layout} caption={t('share.invite.seasonal', { name: themeName, year, url })} prefix={`seasonal-${campaignId}-share`}>
          {achievedAt ? (
            <>
              <View style={styles.shareRow}>
                <Text variant="bodySmall" style={styles.flex}>{t('share.card.seasonal.date')}</Text>
                <Switch
                  value={fields.date}
                  onValueChange={(v) => setFields({ date: v })}
                  trackColor={{ true: color.mint, false: color.borderSubtle }}
                  thumbColor={color.textPrimary}
                  accessibilityLabel={t('share.card.seasonal.date')}
                  testID={`seasonal-${campaignId}-share-date`}
                />
              </View>
              <Text variant="caption" tone="muted">{t('share.card.seasonal.dateNote')}</Text>
            </>
          ) : null}
        </ShareImageBlock>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { marginTop: space.l, marginBottom: space.xs },
  note: { marginBottom: space.s },
  years: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginBottom: space.s },
  year: { minHeight: 36, paddingHorizontal: space.s, borderRadius: radius.m, borderWidth: 1, borderColor: color.borderSubtle, alignItems: 'center', justifyContent: 'center' },
  yearOn: { backgroundColor: color.mint, borderColor: color.mint },
  yearOnText: { color: color.onMint },
  list: { gap: space.s },
  card: { borderWidth: 1, borderColor: color.borderSubtle, borderRadius: radius.m, padding: space.m, backgroundColor: color.surface, gap: space.xs },
  row: { flexDirection: 'row', gap: space.m, alignItems: 'flex-start' },
  body: { flex: 1, gap: space.xxs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  rule: { marginTop: space.xs },
  status: { gap: space.s, marginTop: space.xs },
  cta: { marginTop: space.xs },
  share: { marginTop: space.xs },
  remindRow: { flexDirection: 'row', alignItems: 'center', gap: space.s, marginTop: space.xs },
  shareRow: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  flex: { flex: 1 },
  source: { marginTop: space.xs },
});
