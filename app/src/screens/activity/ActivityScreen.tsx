import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { Button, Chip, InlineState, Screen, Surface } from '@/components';
import { ActivityChart } from '@/components/ActivityChart';
import { RouteThumb, useRoutePoints } from '@/components/RouteThumb';
import { calendarGrid, dayOfItem, filterActivity, inPeriod, mergeActivity, monthSummary, periodAnchorNow, periodRangeUtc, periodSummary, shiftPeriod, sortActivity, timeOfDay, type ActivityFilter, type ActivityItem, type ActivityPeriod } from '@/domain/activity';
import { stageName } from '@/domain/collectibles';
import { formatDuration, formatKm, formatPace, modeLabel } from '@/domain/workouts';
import { useAppearance } from '@/hooks/useAppearance';
import { useOnline } from '@/hooks/useOnline';
import { useOutbox } from '@/hooks/useOutbox';
import { useT, type TKey } from '@/i18n';
import type { RootParamList } from '@/navigation/types';
import { ApiError, apiClient, type WorkoutSummary } from '@/services/api/ApiClient';
import { workoutRecorder } from '@/services/workouts/WorkoutRecorder';
import { workoutOutbox } from '@/services/workouts/WorkoutOutbox';
import { useWorkoutPrefs } from '@/state/workoutPrefsStore';
import { color, radius, space, Text } from '@/theme';

const PERIODS: readonly ActivityPeriod[] = ['week', 'month', 'year', 'all'];

/**
 * 我的運動 Activity（PG-LINK-04／06，shoe-sync-activity.md §4）：週／月／年／全部儀表板（大數字公里、次數／平均配速／時間、逐桶長條圖）、
 * 最近活動卡（路線縮圖＋自動命名）、月曆、模式／來源／狀態篩選、總覽只計有效且去重、
 * 合併本機＋伺服器（canonical id 去重）、狀態分開標示（僅本機／排隊／同步失敗／已排除／刪除待同步／已同步／待審）、
 * 預設由舊到新（同步順序）可切由新到舊並記住；離線只看本機；未登入看訪客本機資料；登入失效不清本機日誌。
 */
export function ActivityScreen() {
  const { t, locale } = useT();
  const navigation = useNavigation();
  const { params } = useRoute<RouteProp<RootParamList, 'Activity'>>();
  const prefs = useWorkoutPrefs();
  const ob = useOutbox();
  const ap = useAppearance();
  // 期間：偏好記住週／月／年／全部；帶 month 參數進來一律月檢視該月
  const [kind, setKind] = useState<ActivityPeriod>(params?.month ? 'month' : prefs.activityPeriod);
  const [anchors, setAnchors] = useState<Record<ActivityPeriod, string>>(() => ({ week: periodAnchorNow('week'), month: params?.month ?? periodAnchorNow('month'), year: periodAnchorNow('year'), all: '' }));
  const anchor = anchors[kind];
  const periodKey = `${ob.owner ?? 'guest'}:${kind}:${anchor}`;
  const setPeriod = (k: ActivityPeriod) => { setKind(k); void prefs.set({ activityPeriod: k }); setFilter((f) => ({ ...f, day: null })); };
  const shift = (delta: number) => { setAnchors((a) => ({ ...a, [kind]: shiftPeriod(kind, anchor, delta) })); setFilter((f) => ({ ...f, day: null })); };
  const [filter, setFilter] = useState<ActivityFilter>({ mode: 'all', source: 'all', status: 'all', day: null });
  /**
   * 伺服器紀錄依期間快取（key＝owner:kind:anchor）。2026-10-03 實機：切到 Y／All 時總覽先用
   * 本機紀錄算出 20.6 km，伺服器回來才跳成 25.1 km；原本只記得「目前這一期」，切走再切回又重抓、又跳。
   * 有快取 → 直接顯示、背景刷新；沒快取（第一次看這一期）→ 總覽先顯示載入中，不秀一個不完整的數字。
   */
  const [remoteCache, setRemoteCache] = useState<Record<string, WorkoutSummary[]>>({});
  const [remoteErr, setRemoteErr] = useState<{ code: string; message: string; key?: string } | null>(null);
  /**
   * 「立即同步」的結果。2026-09-30 實機：按下去**完全沒有反應**——原本是
   * `onPress={() => void workoutOutbox.run(...)}`，回傳值直接丟掉，所以失敗（例如後端
   * session 已失效）時畫面什麼都不說。同一個 App 的 WorkoutsScreen／ProfileScreen 都會顯示結果。
   */
  const [syncNote, setSyncNote] = useState<{ kind: 'success' | 'warning'; title: string; body?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const requestVersion = useRef(0);
  const [truncated, setTruncated] = useState(false);

  const loadRemote = useCallback(async (k: ActivityPeriod, a: string) => {
    const version = ++requestVersion.current;
    setLoading(true);
    setRemoteErr(null);
    setTruncated(false);
    try {
      const { from, to } = periodRangeUtc(k, a);
      const items: WorkoutSummary[] = [];
      let cursor: string | undefined;
      // 分頁：載入期間固定查詢快照（同一 as_of 由伺服器維持），刷新才合併新結果
      for (let i = 0; i < 10; i++) {
        const r = await apiClient.myWorkouts({ from, to, order: 'asc', limit: 100, cursor });
        items.push(...r.items);
        cursor = r.next_cursor ?? undefined;
        if (!cursor) break;
      }
      if (version !== requestVersion.current) return;
      setTruncated(!!cursor);
      setRemoteCache((c) => ({ ...c, [`${ob.owner ?? 'guest'}:${k}:${a}`]: items }));
      setRemoteErr(null);
    } catch (e) {
      if (version !== requestVersion.current) return;
      // 未登入／離線：仍能看本機已保存紀錄（登入失效不清掉本機日誌）
      const key = `${ob.owner ?? 'guest'}:${k}:${a}`;
      setRemoteErr(e instanceof ApiError ? { code: e.code, message: e.message, key } : { code: 'UNKNOWN', message: String(e), key });
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [ob.owner]);
  useEffect(() => { void loadRemote(kind, anchor); return () => { requestVersion.current++; }; }, [kind, anchor, loadRemote]);
  useFocusEffect(useCallback(() => { setTick((n) => n + 1); }, []));
  useEffect(() => workoutRecorder.subscribe(() => setTick((n) => n + 1)), []);
  useEffect(() => workoutOutbox.subscribe(() => setTick((n) => n + 1)), []);

  const items = useMemo(() => {
    void tick;
    const local = workoutRecorder.localStore().list().filter((m) => !ob.owner ? !m.owner : (m.owner === ob.owner || !m.owner));
    const merged = mergeActivity(local, remoteCache[periodKey] ?? [], ob.list);
    return merged.filter((it) => inPeriod(it, kind, anchor));
  }, [tick, remoteCache, periodKey, kind, anchor, ob.owner, ob.list]);
  /** 已連錢包、這一期還沒拿到伺服器結果、也還沒失敗 → 總覽數字未定 */
  const heroPending = !!ob.owner && !(periodKey in remoteCache) && remoteErr?.key !== periodKey;
  const scoped = useMemo(() => filterActivity(items, { ...filter, day: null }), [items, filter]);
  const summary = useMemo(() => periodSummary(scoped, kind, anchor), [scoped, kind, anchor]);
  const month = useMemo(() => monthSummary(scoped, anchor), [scoped, anchor]); // 月曆用（只在月檢視）
  const visible = useMemo(() => sortActivity(filterActivity(items, filter), prefs.activityOrder), [items, filter, prefs.activityOrder]);


  const open = (it: ActivityItem) => {
    if (it.localId) navigation.navigate('WorkoutSummary', { sessionId: it.localId });
    else if (it.serverId) navigation.navigate('ActivityDetail', { serverId: it.serverId });
  };
  const periodLabel = kind === 'month' ? new Date(Date.UTC(Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7)) - 1, 1)).toLocaleDateString(locale, { year: 'numeric', month: 'long', timeZone: 'UTC' })
    : kind === 'week' ? `${fmtDay(anchor, locale)} – ${fmtDay(summary.buckets[6]?.key ?? anchor, locale)}`
    : kind === 'year' ? anchor : t('actv.periodLabel.all');
  const countLabel: TKey = filter.mode === 'run' ? 'actv.hero.runs' : filter.mode === 'brisk' || filter.mode === 'walk' ? 'actv.hero.walks' : 'actv.hero.workouts';
  const walkMode = filter.mode === 'brisk' || filter.mode === 'walk';
  const pending = ob.summary.pending;
  const online = useOnline();
  // 回首頁：有待同步且有網路 → 先問要不要同步（同步在背景跑，不擋導航）；確認不同步才回首頁
  const goHome = () => {
    const home = () => navigation.navigate('Main', { screen: 'Home' });
    if (!ob.owner || pending === 0 || !online) { home(); return; }
    Alert.alert(t('sync.leave.title', { n: pending }), t('sync.leave.body'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('sync.leave.skip'), onPress: home },
      { text: t('sync.leave.sync'), onPress: () => { void workoutOutbox.run(ob.owner!, { manual: true }); home(); } },
    ]);
  };
  // 篩選預設收合（Style 23.17）：只顯示「篩選」＋作用中數量；展開才列模式／來源／狀態
  const [showFilters, setShowFilters] = useState(false);
  const clearFilters = () => setFilter({ mode: 'all', source: 'all', status: 'all', day: null });
  const activeFilters = (filter.day ? 1 : 0) + (filter.mode !== 'all' ? 1 : 0) + (filter.source !== 'all' ? 1 : 0) + (filter.status !== 'all' ? 1 : 0);
  // 升版前／未連錢包錄的紀錄沒有 owner：需本人確認歸屬後才進佇列（Style 23.14）
  /** 與 ProfileScreen 同一套結果處理：成功講送出幾筆，失敗講原因——尤其 NO_SESSION 要說「請重新登入」 */
  const runSync = async () => {
    if (!ob.owner) return;
    setSyncNote(null);
    const r = await workoutOutbox.run(ob.owner, { manual: true });
    if (!r.stoppedAt) setSyncNote({ kind: 'success', title: t('sync.done', { n: r.sent }) });
    else setSyncNote({
      kind: 'warning',
      title: t('sync.stopped', { n: r.sent }),
      body: t(`sync.err.${r.stoppedAt.outcome.ok ? 'UNKNOWN' : r.stoppedAt.outcome.code}` as TKey, { message: r.stoppedAt.outcome.ok ? '' : r.stoppedAt.outcome.message }),
    });
  };

  const assignGuest = () => {
    if (!ob.owner) return;
    Alert.alert(t('sync.assign.title', { n: ob.unassigned.length }), t('sync.assign.body'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('sync.assign.confirm'), onPress: () => void workoutOutbox.assign(ob.unassigned.map((m) => m.sessionId), ob.owner!) },
    ]);
  };

  return (
    <Screen scroll scene={ap.scene} testID="activity-screen" refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void loadRemote(kind, anchor)} tintColor={color.mint} />}>
      <View style={styles.header}>
        <Text variant="heading1">{t('actv.title')}</Text>
        <View style={styles.headerLinks}>
          <Pressable onPress={() => navigation.navigate('Main', { screen: 'Profile' })} accessibilityRole="button" style={styles.link} testID="activity-open-sync">
            <Text variant="label" tone="cyan">{t('sync.title')}</Text>
          </Pressable>
          <Pressable onPress={goHome} accessibilityRole="button" accessibilityLabel={t('actv.home')} style={[styles.link, styles.homeBtn]} testID="activity-home">
            <Feather name="home" size={16} color={color.mint} />
            <Text variant="label" tone="mint">{t('actv.home')}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.periods} accessibilityRole="tablist" testID="activity-periods">
        {PERIODS.map((k) => (
          <Pressable key={k} onPress={() => setPeriod(k)} accessibilityRole="tab" accessibilityLabel={t(`actv.periodLabel.${k}` as TKey)} accessibilityState={{ selected: kind === k }} style={[styles.periodItem, kind === k && styles.periodOn]} testID={`activity-period-${k}`}>
            <Text variant="title" tone={kind === k ? undefined : 'secondary'} style={kind === k && styles.periodOnText}>{t(`actv.period.${k}` as TKey)}</Text>
          </Pressable>
        ))}
      </View>

      <Surface style={styles.overview}>
      <View style={styles.monthRow}>
        {kind !== 'all' ? <Pressable onPress={() => shift(-1)} accessibilityRole="button" accessibilityLabel={t('actv.prevPeriod')} hitSlop={8} style={styles.monthBtn} testID="activity-prev-month"><Feather name="chevron-left" size={22} color={color.textPrimary} /></Pressable> : null}
        <Text variant="title" style={styles.periodTitle} testID="activity-month">{periodLabel}</Text>
        {kind !== 'all' ? <Pressable onPress={() => shift(1)} accessibilityRole="button" accessibilityLabel={t('actv.nextPeriod')} hitSlop={8} style={styles.monthBtn} testID="activity-next-month"><Feather name="chevron-right" size={22} color={color.textPrimary} /></Pressable> : null}

      </View>

      <View style={styles.viewToolbar}>
        {kind === 'month' ? (
          <View style={styles.segment} accessibilityRole="tablist">
            {(['list', 'calendar'] as const).map((v) => (
              <Pressable key={v} onPress={() => void prefs.set({ activityView: v })} accessibilityRole="tab" accessibilityLabel={t(v === 'list' ? 'actv.viewChart' : 'actv.viewCalendar')} accessibilityState={{ selected: prefs.activityView === v }} style={[styles.segmentItem, prefs.activityView === v && styles.segmentOn]} testID={`activity-view-${v}`}>
                <Feather name={v === 'list' ? 'bar-chart-2' : 'calendar'} size={16} color={prefs.activityView === v ? color.onMint : color.textSecondary} />
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
      {kind !== 'all' && anchor !== periodAnchorNow(kind) ? <Pressable onPress={() => { setAnchors((a) => ({ ...a, [kind]: periodAnchorNow(kind) })); setFilter((f) => ({ ...f, day: null })); }} style={styles.filterBtn} accessibilityRole="button" testID="activity-current-period"><Text variant="caption" tone="mint">{t('actv.currentPeriod')}</Text></Pressable> : null}
      <View style={styles.hero} testID="activity-hero">
        <Text variant="label" tone="mint">{t('actv.overview')}</Text>
        <Text variant="displayL" numeric style={styles.heroKm} testID="activity-hero-km">{heroPending ? '—' : summary.hasDistance ? (summary.distanceMm / 1_000_000).toFixed(1) : '—'}</Text>
        <Text variant="bodySmall" tone="secondary">{t('actv.kmUnit')}</Text>
        <View style={styles.heroStats}>
          <View style={styles.heroStat}><Text variant="heading2" numeric testID="activity-hero-count">{heroPending ? '—' : summary.count}</Text><Text variant="caption" tone="secondary">{t(countLabel)}</Text></View>
          <View style={styles.heroStat}><Text variant="heading2" numeric testID="activity-hero-pace">{heroPending ? '—' : walkMode ? (summary.avgSpeedKmh === null ? '—' : `${summary.avgSpeedKmh.toFixed(1)} km/h`) : formatPace(summary.avgPaceSPerKm)}</Text><Text variant="caption" tone="secondary">{t(walkMode ? 'actv.hero.speed' : 'actv.hero.pace')}</Text></View>
          <View style={styles.heroStat}><Text variant="heading2" numeric testID="activity-hero-time">{heroPending ? '—' : summary.hasTime ? formatDuration(String(summary.elapsedMs)) : '—'}</Text><Text variant="caption" tone="secondary">{t('actv.hero.time')}</Text></View>
        </View>
        {heroPending ? <Text variant="caption" tone="muted" testID="activity-hero-loading">{t('actv.heroLoading')}</Text> : null}
        {!heroPending && summary.excluded > 0 ? <Text variant="caption" tone="muted" testID="activity-summary">{t('actv.excludedCount', { n: summary.excluded })}</Text> : null}
      </View>
      {kind !== 'month' || prefs.activityView !== 'calendar' ? (
        <>
          <ActivityChart buckets={summary.buckets} selected={filter.day ?? null} onSelect={(key) => setFilter((f) => ({ ...f, day: key }))} avgMm={summary.avgBucketMm} />
          {filter.day ? <Text variant="caption" tone="secondary" style={styles.mtXs} testID="activity-bucket-filter">{t('actv.bucketFilter', { label: filter.day })}</Text> : null}
        </>
      ) : null}

      <Text variant="caption" tone="secondary" style={styles.mtXs}>{t('actv.scopeNote')}</Text>
      </Surface>
      {truncated ? <InlineState kind="warning" title={t('actv.partialResults')} body={t('actv.partialResultsBody')} testID="activity-partial" /> : null}

      <View style={styles.filterRow}>
        <Pressable onPress={() => setShowFilters((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: showFilters }} style={styles.filterBtn} testID="activity-filters-toggle">
          <Feather name="sliders" size={14} color={activeFilters ? color.mint : color.textSecondary} />
          <Text variant="caption" tone={activeFilters ? 'mint' : 'secondary'}>{activeFilters ? t('actv.filtersActive', { n: activeFilters }) : t('actv.filters')}</Text>
          <Feather name={showFilters ? 'chevron-up' : 'chevron-down'} size={14} color={color.textSecondary} />
        </Pressable>
        {activeFilters ? (
          <Pressable onPress={clearFilters} accessibilityRole="button" hitSlop={8} style={styles.filterBtn} testID="activity-filters-clear">
            <Text variant="caption" tone="secondary">{t('actv.filtersClear')}</Text>
          </Pressable>
        ) : null}
      </View>
      {filter.day ? <Pressable onPress={() => setFilter((f) => ({ ...f, day: null }))} accessibilityRole="button" accessibilityLabel={t('actv.clearSelection')} style={styles.selection} testID="activity-clear-day"><Feather name="calendar" size={16} color={color.mint} /><Text variant="bodySmall" style={styles.flex}>{filter.day}</Text><Text variant="caption" tone="mint">{t('actv.filtersClear')}</Text><Feather name="x" size={16} color={color.mint} /></Pressable> : null}
      {showFilters ? <Surface style={styles.filterPanel}>
      <Text variant="label" tone="muted">{t('actv.filterMode')}</Text>
      <View style={styles.chips}>
        {(['all', 'run', 'brisk', 'walk'] as const).map((m) => <Pressable key={m} onPress={() => setFilter((f) => ({ ...f, mode: m }))} accessibilityRole="button" accessibilityState={{ selected: filter.mode === m }} testID={`activity-mode-${m}`}><Chip label={t(m === 'all' ? 'actv.filter.all' : `wo.mode.${m}` as TKey)} kind={filter.mode === m ? 'level' : 'neutral'} /></Pressable>)}
      </View>
      <View style={styles.chips}>
        {(['all', 'device_gps', 'imported'] as const).map((s) => <Pressable key={s} onPress={() => setFilter((f) => ({ ...f, source: s }))} accessibilityRole="button" accessibilityState={{ selected: filter.source === s }} testID={`activity-source-${s}`}><Chip label={t(`actv.source.${s}` as TKey)} kind={filter.source === s ? 'level' : 'neutral'} /></Pressable>)}
        {(['local', 'synced', 'review', 'failed'] as const).map((s) => <Pressable key={s} onPress={() => setFilter((f) => ({ ...f, status: f.status === s ? 'all' : s }))} accessibilityRole="button" accessibilityState={{ selected: filter.status === s }} testID={`activity-status-${s}`}><Chip label={t(`actv.statusFilter.${s}` as TKey)} kind={filter.status === s ? 'level' : 'neutral'} /></Pressable>)}
      </View>
      </Surface> : null}

      <View style={styles.syncRow}>
        <Text variant="caption" tone={pending > 0 ? 'warning' : 'muted'} style={styles.flex} testID="activity-sync-line">
          {ob.owner ? `${t('sync.pending', { n: pending })} · ${t(ob.autoSync ? 'sync.listAutoOn' : 'sync.listAutoOff')}` : t('actv.guestNote')}
        </Text>
      </View>
      {ob.owner && (pending > 0 || ob.unassigned.length > 0) ? (
        <View style={styles.syncBtns}>
          {pending > 0 ? <Button label={t('sum.syncNow')} variant="secondary" onPress={() => void runSync()} loading={ob.summary.running} loadingLabel={t('sum.syncing')} testID="activity-sync-now" /> : null}
          {ob.unassigned.length > 0 ? <Button label={t('sync.assign.btn', { n: ob.unassigned.length })} variant="secondary" onPress={assignGuest} testID="activity-sync-assign" /> : null}
        </View>
      ) : null}
      {syncNote ? <InlineState kind={syncNote.kind} title={syncNote.title} body={syncNote.body} testID="activity-sync-note" /> : null}
      {remoteErr && ob.owner ? (
        <Text variant="caption" tone="muted" testID={`activity-remote-${remoteErr.code === 'NO_SESSION' ? 'signin' : 'offline'}`}>
          {t(remoteErr.code === 'NO_SESSION' ? 'actv.remoteSignin' : 'actv.remoteOffline')}
        </Text>
      ) : null}

      {kind === 'month' && prefs.activityView === 'calendar' ? (
        <Surface style={styles.calendar} testID="activity-calendar">
          <View style={styles.week}>{['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => <Text key={d} variant="caption" tone="muted" style={styles.cell}>{t(`actv.wd.${d}` as TKey)}</Text>)}</View>
          {Array.from({ length: Math.ceil(calendarGrid(anchor).length / 7) }, (_, w) => (
            <View key={w} style={styles.week}>
              {calendarGrid(anchor).slice(w * 7, w * 7 + 7).map((day, i) => {
                const d = day ? month.byDay[day] : undefined;
                const on = filter.day === day;
                return day ? (
                  <Pressable key={day} onPress={() => setFilter((f) => ({ ...f, day: f.day === day ? null : day }))} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.cell, styles.dayCell, on && styles.dayOn]} testID={`activity-day-${day}`}>
                    <Text variant="bodySmall" tone={d ? undefined : 'muted'}>{Number(day.slice(8))}</Text>
                    {d ? <View style={styles.dot} /> : null}
                    {d?.distanceMm ? <Text variant="caption" tone="mint" numeric>{(d.distanceMm / 1_000_000).toFixed(1)}</Text> : d ? <Text variant="caption" tone="mint">{d.count}</Text> : null}
                  </Pressable>
                ) : <View key={`e${i}`} style={styles.cell} />;
              })}
            </View>
          ))}
          {filter.day ? <Text variant="caption" tone="secondary" style={styles.mtXs}>{t('actv.dayFilter', { day: filter.day })}</Text> : null}
        </Surface>
      ) : null}

      <View style={styles.recentHead}>
        <View style={styles.flex}><Text variant="heading2">{t('actv.recent')}</Text><Text variant="caption" tone="secondary" testID="activity-result-count">{t('actv.results', { n: visible.length })}</Text></View>
        <Pressable onPress={() => void prefs.set({ activityOrder: prefs.activityOrder === 'asc' ? 'desc' : 'asc' })} accessibilityRole="button" hitSlop={8} style={styles.orderBtn} testID="activity-order">
          <Feather name={prefs.activityOrder === 'asc' ? 'arrow-up' : 'arrow-down'} size={14} color={color.textSecondary} />
          <Text variant="caption" tone="secondary">{t(prefs.activityOrder === 'asc' ? 'actv.order.asc' : 'actv.order.desc')}</Text>
        </Pressable>
      </View>
      {visible.length === 0 ? (
        <InlineState kind="info" title={t(items.length ? 'actv.empty.filtered' : 'actv.empty.title')} body={t(items.length ? 'actv.empty.filteredBody' : 'actv.empty.body')} action={items.length ? { label: t('actv.filtersClear'), onPress: clearFilters } : { label: t('home.startWorkout'), onPress: () => navigation.navigate('WorkoutStart') }} secondaryAction={items.length ? undefined : { label: t('actv.empty.import'), onPress: () => navigation.navigate('Workouts') }} testID="activity-empty" />
      ) : (
        <View style={styles.list} testID="activity-list">
          {visible.map((it) => <ActivityCard key={it.id} it={it} onPress={() => open(it)} />)}
        </View>
      )}
      <Text variant="caption" tone="muted" style={styles.footnote}>{t('actv.retentionNote')}</Text>
    </Screen>
  );
}

const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmtDay = (day: string, locale: string) => new Date(Date.parse(`${day}T00:00:00Z`)).toLocaleDateString(locale, { month: 'numeric', day: 'numeric', timeZone: 'UTC' });

/** 最近活動卡（Style 23.17）：路線縮圖＋日期（今天／昨天／日期）＋自動命名（週幾＋時段＋模式）＋距離／配速或速度／時間＋狀態 */
function ActivityCard({ it, onPress }: { it: ActivityItem; onPress: () => void }) {
  const { t, locale } = useT();
  const points = useRoutePoints(it.localId);
  const day = dayOfItem(it);
  const today = localDay(new Date());
  const yday = localDay(new Date(Date.now() - 86_400_000));
  const dateLabel = day === today ? t('actv.today') : day === yday ? t('actv.yesterday') : new Date(it.startedAtUtc).toLocaleDateString(locale, { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: it.timeZone ?? undefined });
  const wd = new Date(it.startedAtUtc).toLocaleDateString(locale, { weekday: 'long', timeZone: it.timeZone ?? undefined });
  const title = t('actv.autoTitle', { wd, tod: t(`actv.tod.${timeOfDay(it.startedAtUtc, it.timeZone)}` as TKey), mode: modeLabel(t, it.sport, it.intent) });
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${dateLabel} · ${title}`} testID={`activity-item-${it.id}`}>
      <Surface style={[styles.card, { borderLeftColor: it.sport === 'run' ? color.mint : it.intent === 'brisk' ? color.cyan : color.violet }]}>
        <View style={styles.cardHead}>
          <RouteThumb points={points} layer={it.routeAppearance.layer} testID={`activity-thumb-${it.id}`} />
          <View style={styles.flex}>
            <Text variant="caption" tone="secondary" numeric>{dateLabel} · {new Date(it.startedAtUtc).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: it.timeZone ?? undefined })}</Text>
            <Text variant="title" testID={`activity-item-title-${it.id}`}>{title}</Text>
          </View>
          <Feather name="chevron-right" size={18} color={color.textMuted} />
        </View>
        <View style={styles.cardStats}>
          <View style={styles.cardMetric}><Text variant="heading2" numeric>{it.distanceMm === null ? '—' : formatKm(String(it.distanceMm)).replace(/ km$/, '')}</Text><Text variant="caption" tone="secondary">km</Text></View>
          <View style={styles.cardMetric}><Text variant="heading2" numeric>{it.sport === 'run' ? formatPace(it.avgPaceSPerKm) : it.avgSpeedKmh === null ? '—' : it.avgSpeedKmh.toFixed(1)}</Text><Text variant="caption" tone="secondary">{it.sport === 'run' ? t('actv.hero.pace') : `${t('actv.hero.speed')} km/h`}</Text></View>
          <View style={styles.cardMetric}><Text variant="heading2" numeric>{it.elapsedMs === null ? '—' : formatDuration(String(it.elapsedMs))}</Text><Text variant="caption" tone="secondary">{t('actv.hero.time')}</Text></View>
        </View>
        <Text variant="caption" tone={it.status === 'sync_failed' || it.status === 'delete_pending' ? 'warning' : it.needsReview || it.status === 'excluded' ? 'danger' : 'muted'} testID={`activity-item-status-${it.id}`}>
          {[it.shoe ? stageName(t, it.shoe.level) : null, t(`actv.source.${it.source}` as TKey), t(`actv.status.${it.status}` as TKey), it.needsReview && it.status !== 'needs_review' ? t('actv.status.needs_review') : null].filter(Boolean).join(' · ')}
        </Text>
      </Surface>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  viewToolbar: { alignItems: 'flex-end', marginTop: space.xxs },
  overview: { marginTop: space.xs },
  periodTitle: { flex: 1, textAlign: 'center', flexShrink: 1 },
  filterPanel: { marginTop: space.xs },
  selection: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 48, paddingHorizontal: space.s, borderRadius: radius.m, backgroundColor: color.elevated },
  periods: { flexDirection: 'row', borderRadius: radius.l, borderWidth: 1, borderColor: color.borderSubtle, overflow: 'hidden', marginBottom: space.s },
  periodItem: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  periodOn: { backgroundColor: color.mint },
  periodOnText: { color: color.onMint },
  hero: { marginTop: space.m, gap: space.xxs },
  heroKm: { fontSize: 64, lineHeight: 70, fontStyle: 'italic' },
  heroStats: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s, marginTop: space.s, paddingTop: space.s, borderTopWidth: 1, borderTopColor: color.borderSubtle },
  heroStat: { flexGrow: 1, minWidth: 80, gap: space.xxs },
  recentHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.l, marginBottom: space.xs },
  card: { gap: space.s, borderLeftWidth: 3 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  cardMetric: { flexGrow: 1, flexBasis: 80, gap: space.xxs },
  cardStats: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s, borderTopWidth: 1, borderTopColor: color.borderSubtle, paddingTop: space.s },
  header: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, justifyContent: 'space-between', alignItems: 'center', marginBottom: space.s },
  headerLinks: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  link: { minHeight: 48, justifyContent: 'center' },
  homeBtn: { flexDirection: 'row', alignItems: 'center', gap: space.xxs },
  filterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.s },
  filterBtn: { flexDirection: 'row', alignItems: 'center', gap: space.xxs, minHeight: 48 },
  monthRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  monthBtn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  segment: { flexDirection: 'row', borderRadius: radius.m, borderWidth: 1, borderColor: color.borderSubtle, overflow: 'hidden' },
  segmentItem: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { backgroundColor: color.mint },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.s },
  syncRow: { flexDirection: 'row', alignItems: 'center', gap: space.s, marginTop: space.s },
  syncBtns: { gap: space.xs, marginTop: space.xs },
  orderBtn: { flexDirection: 'row', alignItems: 'center', gap: space.xxs, minHeight: 48 },
  calendar: { marginTop: space.s },
  week: { flexDirection: 'row' },
  cell: { flex: 1, alignItems: 'center', minHeight: 48, justifyContent: 'center', textAlign: 'center' },
  dayCell: { borderRadius: radius.s, paddingVertical: space.xxs },
  dayOn: { backgroundColor: color.elevated },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: color.mint, marginTop: 2 },
  list: { gap: space.s },
  mtXs: { marginTop: space.xs },
  footnote: { marginTop: space.l, textAlign: 'center' },
});
