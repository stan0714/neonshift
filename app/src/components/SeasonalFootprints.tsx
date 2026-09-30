import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { Alert } from 'react-native';

import { Button, Chip, InlineState } from '@/components';
import { MintProgress, type MintPhase } from '@/components/MintProgress';
import { SeasonalBadge, type SeasonalBadgeState } from '@/components/SeasonalBadge';
import { ShareImageBlock } from '@/components/ShareImageBlock';
import { APP_CONFIG } from '@/config/app';
import { seasonalSourceFact } from '@/domain/seasonalCopy';
import { seasonalShareLayout, SEASONAL_SHARE_DEFAULT, shareUrl, type SeasonalShareFields } from '@/domain/shareImage';
import { useT, useLocaleStore, type TKey } from '@/i18n';
import type { RootParamList } from '@/navigation/types';
import { apiClient, ApiError, type MySeasonalItem, type SeasonalCampaignView } from '@/services/api/ApiClient';
import { achievementService } from '@/services/chain/AchievementService';
import { ClaimError } from '@/services/chain/StarterShoeService';
import { recordLocalMint } from '@/services/chain/localMints';
import { useNftRevealStore } from '@/state/nftRevealStore';
import { requestSeasonalNotificationPermission, seasonalNotificationPermission, type SeasonalPermission } from '@/services/notifications/seasonalNotifications';
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

/**
 * R5：去掉個人欄位，只留公開目錄。換帳號的空檔、載入失敗退回公開目錄、A 的慢回應——
 * 任何一種都不能讓 B 看到 A 的資格、取得紀錄或可領取狀態。
 * 公開目錄（窗口、規則、提醒訂閱）與帳號無關，照樣顯示，不必整段消失。
 */
const publicOnly = (r: Row): Row => ({ ...r, status: undefined, first: undefined, pending: undefined, progress: undefined });

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
  /** rows 裡的個人欄位屬於哪個錢包（null＝只有公開目錄）。R5：不相符就不顯示個人資料 */
  const [rowsOwner, setRowsOwner] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  /** R5：每次載入遞增；回應對不上就丟掉——A 的慢回應不得蓋掉 B */
  const gen = useRef(0);
  // PG-SEASON-06：訂閱清單存在本機（裝置層、不分錢包、不上傳）
  const reminders = useSeasonalReminderStore();
  useEffect(() => { void reminders.load(); }, [reminders.load]);
  /**
   * 通知權限（PG-SEASON-06）。開畫面時只「查詢」不要求——靜默彈系統詢問是騷擾，
   * 而且使用者還沒表示想被提醒。真正的要求在打開開關的那一刻。
   */
  const [notifyPermission, setNotifyPermission] = useState<SeasonalPermission | null>(null);
  useEffect(() => { void seasonalNotificationPermission().then(setNotifyPermission); }, []);
  const onToggleRemind = async (campaignId: string) => {
    const turningOn = !reminders.subscribed.includes(campaignId);
    // 先問權限再記訂閱：被拒絕也照樣記下訂閱（App 內浮層仍會提醒），只是文案改成說實話
    if (turningOn) setNotifyPermission(await requestSeasonalNotificationPermission());
    await reminders.toggle(campaignId);
  };
  /** 年份篩選（設計 §5「不把每年卡片全部塞到首頁」）；'all' 代表不篩 */
  const [year, setYear] = useState<number | 'all'>('all');

  const load = useCallback(async () => {
    const address = session?.address ?? null;
    const mine = ++gen.current;
    const current = () => gen.current === mine;
    try {
      // 登入後才問個人資格；未登入只拿公開目錄，不因為沒登入就整段消失
      const r = address ? await apiClient.mySeasonal() : await apiClient.seasonal();
      if (!current()) return;
      setRows(r.items);
      setRowsOwner(address);
      setFailed(false);
    } catch (e) {
      if (!current()) return;
      // 錢包連著但後端 session 已經沒了（過期／撤銷）：那不是「活動讀不到」，
      // 而是「個人資格讀不到」。公開目錄本來就不需要登入，退回去拿它——
      // 窗口、規則與提醒訂閱照樣可用，只是少了個人狀態，比整段顯示錯誤好得多。
      if (address && e instanceof ApiError && e.code === 'NO_SESSION') {
        try {
          const pub = await apiClient.seasonal();
          if (!current()) return;
          setRows(pub.items);
          setRowsOwner(null); // 公開目錄沒有個人資料
          setFailed(false);
          return;
        } catch {
          // 公開目錄也拿不到：那才是真的讀取失敗，往下走
        }
        if (!current()) return;
      }
      // 讀不到就退回公開目錄——但**不保留**上一次的個人資料（可能是別的帳號的）
      setRows((prev) => prev ?? []);
      setRowsOwner(null);
      setFailed(true);
    }
  }, [session]);
  useEffect(() => { void load(); }, [load, reloadKey]);
  // 上一個帳號的讀取錯誤不是這個帳號的事
  useEffect(() => { setFailed(false); }, [session?.address]);
  // 待審轉核准是伺服器端非同步發生的：回到這個分頁就重抓
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (rows === null) return null;
  // R5：個人欄位只有在確定屬於**目前這個帳號**時才顯示。這一層是渲染時判定，
  // 不是「重抓時記得清掉」——後者只要有一條路徑忘了清，A 的資格就會出現在 B 的畫面上。
  const address = session?.address ?? null;
  const owned = address !== null && rowsOwner === address;
  const data: Row[] = owned ? rows : rows.map(publicOnly);
  // 年份新的在前，同年依窗口開始排——每年一屆，時間順序才讀得懂（設計 §7「收藏年份排序」）
  const years = [...new Set(data.map((r) => r.year))].sort((a, b) => b - a);
  const shown = data
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
      {data.length === 0 ? (
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
                    {/*
                      裝置時區與活動時區相同時，這一行會跟上面一模一樣——顯示兩次同樣的時間
                      只是雜訊，還會讓人以為兩者有差別。只有真的不同才顯示（那時它才有用：
                      活動在 Asia/Taipei，而你人在別的時區）。
                    */}
                    {w.local !== w.inZone ? <Text variant="caption" tone="muted" numeric>{t('season.localTime', { range: w.local })}</Text> : null}
                  </View>
                </View>
                <Text variant="caption" tone="secondary" style={styles.rule}>
                  {t('season.rule', { min: r.rules.min_moving_minutes, days: r.rules.grace_days })}
                </Text>
                {/* PG-SEASON-06：本機排程通知（沒有遠端推播、訂閱不上傳）——開關旁邊直接講清楚 */}
                {r.window.state !== 'closed' ? (
                  <View style={styles.remindRow}>
                    <Text variant="bodySmall" tone="secondary" style={styles.flex}>{t('season.remind')}</Text>
                    <Switch
                      value={reminders.subscribed.includes(r.campaign_id)}
                      onValueChange={() => void onToggleRemind(r.campaign_id)}
                      trackColor={{ true: color.mint, false: color.borderSubtle }}
                      thumbColor={color.textPrimary}
                      accessibilityLabel={t('season.remind')}
                      testID={`seasonal-${r.campaign_id}-remind`}
                    />
                  </View>
                ) : null}
                {r.window.state !== 'closed' && reminders.subscribed.includes(r.campaign_id) ? (
                  /* 系統通知被關掉時就不能說「會提醒你」——只有 'denied' 換文案；
                     'unavailable' 只會在沒有這個原生模組的開發環境出現（JS 與原生是同一包出去的） */
                  <Text variant="caption" tone="muted" testID={`seasonal-${r.campaign_id}-remind-note`}>{t(notifyPermission === 'denied' ? 'season.remindDenied' : 'season.remindNote')}</Text>
                ) : null}
                {r.status ? (
                  <View style={styles.status} testID={`seasonal-${r.campaign_id}-status-${r.status}`}>
                    {r.status === 'eligible' ? (
                      // 達標不等於已取得：`mint_enabled` 關著時沒有鑄造路徑，這裡就不能出現領取按鈕（PG-SEASON-04）
                      <>
                        <InlineState kind="success" title={t('season.state.eligible')} body={t(r.mint_enabled ? 'season.state.claimableBody' : 'season.state.eligibleBody')} />
                        {r.mint_enabled ? <SeasonalClaim campaignId={r.campaign_id} themeId={r.theme_id} year={r.year} onClaimed={load} /> : null}
                      </>
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
                <Text variant="caption" tone="muted" style={styles.source}>{t('season.sourceNote', { fact: seasonalSourceFact(r.source.fact, locale) })}</Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

/**
 * 領取這一屆（PG-SEASON-04）。與 PB／里程碑／活動章走**同一條**流程：
 * 逐次公開同意 → mint-intent（registry 已核准才有證明）→ 預覽會公開的內容與費用 → MWA 簽送。
 *
 * 只有後端 `mint_enabled` 為 true 才會被掛上來——那個開關代表「鏈上程式已支援 seasonal 類別
 * 且已部署到這個 cluster」。後端若仍關著，這裡按下去會拿到 409，畫面照實說還沒開放。
 */
function SeasonalClaim({ campaignId, themeId, year, onClaimed }: { campaignId: string; themeId: string; year: number; onClaimed: () => void | Promise<void> }) {
  const { t } = useT();
  const session = useWalletStore((s) => s.session);
  const [phase, setPhase] = useState<MintPhase | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'info' | 'warning' | 'error'; title: string; body?: string } | null>(null);

  const ask = () => {
    if (!session) return;
    Alert.alert(t('pb.consentTitle'), t('pb.consentBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('pb.consentPrivate'), onPress: () => void run(false) },
      { text: t('pb.consentShare'), onPress: () => void run(true) },
    ]);
  };

  const run = async (consent: boolean) => {
    if (!session) return;
    setBusy(true);
    setNotice(null);
    setPhase('server');
    try {
      const intent = await achievementService.seasonalIntent(campaignId, consent);
      if (intent.status === 'minted') { setNotice({ kind: 'success', title: t('season.claimed'), body: t('season.claimedBody') }); return; }
      if (intent.status !== 'approved' || !intent.proof) {
        // 待核准不是失敗：資格已記下，registry 上鏈後才有證明
        setNotice(intent.status === 'pending_registry' || intent.status === 'approved' ? { kind: 'info', title: t('pb.mintPending'), body: t('pb.pendingBody') } : { kind: 'warning', title: t('pb.revoked'), body: t('ms.revokedBody') });
        return;
      }
      const attrs = ((intent.metadata_preview.attributes as { trait_type: string; value: string }[] | undefined) ?? []).map((a) => `• ${a.trait_type}: ${a.value}`).join('\n');
      setPhase('approved');
      const sol = (intent.fee_estimate_lamports / 1e9).toFixed(4);
      await new Promise<void>((resolve) => {
        Alert.alert(t('ms.previewTitle'), t('ms.previewBody', { attrs, sol }), [
          { text: t('common.cancel'), style: 'cancel', onPress: () => resolve() },
          {
            text: t('pb.mintNow'),
            onPress: () => {
              void (async () => {
                try {
                  const r = await achievementService.mint(session.publicKey, intent, setPhase);
                  if (r.kind === 'minted') recordLocalMint(intent.achievement.achievement_id, { asset: r.asset, signature: r.signature ?? '' });
                  if (r.kind === 'minted' && !r.alreadyMinted) useNftRevealStore.getState().enqueue({ id: r.asset, title: typeof intent.metadata_preview.name === 'string' ? intent.metadata_preview.name : undefined, seasonal: { themeId, year } });
                  if (r.kind === 'minted') setNotice({ kind: 'success', title: t('season.claimed'), body: t('season.claimedBody') });
                } catch (e) {
                  const code = e instanceof ClaimError ? e.code : 'FAILED';
                  setNotice({ kind: 'error', title: code === 'REJECTED' || code === 'NETWORK_ERROR' || code === 'NOT_AVAILABLE' ? t(`pb.err.${code}` as TKey) : t('pb.err.generic', { message: e instanceof Error ? e.message : String(e) }) });
                } finally {
                  resolve();
                }
              })();
            },
          },
        ]);
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 後端還沒開放領取（SEASONAL_MINT_NOT_OPEN）就照實說，不說成失敗
      setNotice(/SEASONAL_MINT_NOT_OPEN/.test(msg) ? { kind: 'info', title: t('season.state.eligible'), body: t('season.state.eligibleBody') } : { kind: 'error', title: t('pb.err.generic', { message: msg }) });
    } finally {
      setPhase(null);
      setBusy(false);
      await onClaimed();
    }
  };

  return (
    <View style={styles.share} testID={`seasonal-${campaignId}-claim`}>
      <MintProgress phase={phase} />
      <Button label={t('season.claim')} onPress={ask} loading={busy} loadingLabel={t('season.claiming')} disabled={busy || !session} disabledReason={!session ? t('common.reasonConnectWallet') : undefined} testID={`seasonal-${campaignId}-claim-btn`} />
      {notice ? <InlineState kind={notice.kind} title={notice.title} body={notice.body} testID={`seasonal-${campaignId}-claim-${notice.kind}`} /> : null}
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
