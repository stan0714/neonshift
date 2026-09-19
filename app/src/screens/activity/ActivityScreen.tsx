import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { Button, Chip, InlineState, Screen, Surface } from '@/components';
import { calendarGrid, dayOfItem, filterActivity, mergeActivity, monthOf, monthRangeUtc, monthSummary, shiftMonth, sortActivity, type ActivityFilter, type ActivityItem } from '@/domain/activity';
import { stageName } from '@/domain/collectibles';
import { formatDuration, formatKm, formatPace, modeLabel } from '@/domain/workouts';
import { useAppearance } from '@/hooks/useAppearance';
import { useOutbox } from '@/hooks/useOutbox';
import { useT, type TKey } from '@/i18n';
import type { RootParamList } from '@/navigation/types';
import { ApiError, apiClient, type WorkoutSummary } from '@/services/api/ApiClient';
import { workoutRecorder } from '@/services/workouts/WorkoutRecorder';
import { workoutOutbox } from '@/services/workouts/WorkoutOutbox';
import { useWorkoutPrefs } from '@/state/workoutPrefsStore';
import { color, radius, space, Text } from '@/theme';

const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

/**
 * 我的運動 Activity（PG-LINK-04，shoe-sync-activity.md §4）：月份總覽（只計有效且去重）、清單／月曆、模式／來源／狀態篩選、
 * 合併本機＋伺服器（canonical id 去重）、狀態分開標示（僅本機／排隊／同步失敗／已排除／刪除待同步／已同步／待審）、
 * 預設由舊到新（同步順序）可切由新到舊並記住；離線只看本機；未登入看訪客本機資料；登入失效不清本機日誌。
 */
export function ActivityScreen() {
  const { t } = useT();
  const navigation = useNavigation();
  const { params } = useRoute<RouteProp<RootParamList, 'Activity'>>();
  const prefs = useWorkoutPrefs();
  const ob = useOutbox();
  const ap = useAppearance();
  const [month, setMonth] = useState(params?.month ?? thisMonth());
  const [filter, setFilter] = useState<ActivityFilter>({ mode: 'all', source: 'all', status: 'all', day: null });
  const [remote, setRemote] = useState<{ month: string; items: WorkoutSummary[] } | null>(null);
  const [remoteErr, setRemoteErr] = useState<{ code: string; message: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  const loadRemote = useCallback(async (m: string) => {
    setLoading(true);
    try {
      const { from, to } = monthRangeUtc(m);
      const items: WorkoutSummary[] = [];
      let cursor: string | undefined;
      // 分頁：載入期間固定查詢快照（同一 as_of 由伺服器維持），刷新才合併新結果
      for (let i = 0; i < 10; i++) {
        const r = await apiClient.myWorkouts({ from, to, order: 'asc', limit: 100, cursor });
        items.push(...r.items);
        if (!r.next_cursor) break;
        cursor = r.next_cursor;
      }
      setRemote({ month: m, items });
      setRemoteErr(null);
    } catch (e) {
      // 未登入／離線：仍能看本機已保存紀錄（登入失效不清掉本機日誌）
      setRemoteErr(e instanceof ApiError ? { code: e.code, message: e.message } : { code: 'UNKNOWN', message: String(e) });
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void loadRemote(month); }, [month, loadRemote]);
  useFocusEffect(useCallback(() => { setTick((n) => n + 1); }, []));
  useEffect(() => workoutRecorder.subscribe(() => setTick((n) => n + 1)), []);
  useEffect(() => workoutOutbox.subscribe(() => setTick((n) => n + 1)), []);

  const items = useMemo(() => {
    void tick;
    const local = workoutRecorder.localStore().list().filter((m) => !ob.owner ? !m.owner : (m.owner === ob.owner || !m.owner));
    const merged = mergeActivity(local, remote?.month === month ? remote.items : [], ob.list);
    return merged.filter((it) => monthOf(dayOfItem(it)) === month);
  }, [tick, remote, month, ob.owner, ob.list]);
  const summary = useMemo(() => monthSummary(items, month), [items, month]);
  const visible = useMemo(() => sortActivity(filterActivity(items, filter), prefs.activityOrder), [items, filter, prefs.activityOrder]);

  const open = (it: ActivityItem) => {
    if (it.localId) navigation.navigate('WorkoutSummary', { sessionId: it.localId });
    else if (it.serverId) navigation.navigate('ActivityDetail', { serverId: it.serverId });
  };
  const monthLabel = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1)).toLocaleDateString(undefined, { year: 'numeric', month: 'long', timeZone: 'UTC' });
  const pending = ob.summary.pending;

  return (
    <Screen scroll scene={ap.scene} testID="activity-screen" refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void loadRemote(month)} tintColor={color.mint} />}>
      <View style={styles.header}>
        <Text variant="heading1">{t('actv.title')}</Text>
        <Pressable onPress={() => navigation.navigate('Main', { screen: 'Profile' })} accessibilityRole="button" style={styles.link} testID="activity-open-sync">
          <Text variant="label" tone="cyan">{t('sync.title')}</Text>
        </Pressable>
      </View>

      <View style={styles.monthRow}>
        <Pressable onPress={() => { setMonth((m) => shiftMonth(m, -1)); setFilter((f) => ({ ...f, day: null })); }} accessibilityRole="button" accessibilityLabel={t('actv.prevMonth')} hitSlop={8} style={styles.monthBtn} testID="activity-prev-month"><Feather name="chevron-left" size={22} color={color.textPrimary} /></Pressable>
        <Text variant="heading2" testID="activity-month">{monthLabel}</Text>
        <Pressable onPress={() => { setMonth((m) => shiftMonth(m, 1)); setFilter((f) => ({ ...f, day: null })); }} accessibilityRole="button" accessibilityLabel={t('actv.nextMonth')} hitSlop={8} style={styles.monthBtn} testID="activity-next-month"><Feather name="chevron-right" size={22} color={color.textPrimary} /></Pressable>
        <View style={styles.flex} />
        <View style={styles.segment} accessibilityRole="tablist">
          {(['list', 'calendar'] as const).map((v) => (
            <Pressable key={v} onPress={() => void prefs.set({ activityView: v })} accessibilityRole="tab" accessibilityState={{ selected: prefs.activityView === v }} style={[styles.segmentItem, prefs.activityView === v && styles.segmentOn]} testID={`activity-view-${v}`}>
              <Feather name={v === 'list' ? 'list' : 'calendar'} size={16} color={prefs.activityView === v ? color.onMint : color.textSecondary} />
            </Pressable>
          ))}
        </View>
      </View>
      <Text variant="bodySmall" tone="secondary" testID="activity-summary">
        {t('actv.monthSummary', { n: summary.count, km: summary.hasDistance ? (summary.distanceMm / 1_000_000).toFixed(1) : '—', time: formatDuration(String(summary.elapsedMs)) })}
        {summary.excluded > 0 ? ` · ${t('actv.excludedCount', { n: summary.excluded })}` : ''}
      </Text>

      <View style={styles.chips}>
        {(['all', 'run', 'brisk', 'walk'] as const).map((m) => <Pressable key={m} onPress={() => setFilter((f) => ({ ...f, mode: m }))} accessibilityRole="button" accessibilityState={{ selected: filter.mode === m }} testID={`activity-mode-${m}`}><Chip label={t(m === 'all' ? 'actv.filter.all' : `wo.mode.${m}` as TKey)} kind={filter.mode === m ? 'level' : 'neutral'} /></Pressable>)}
      </View>
      <View style={styles.chips}>
        {(['all', 'device_gps', 'imported'] as const).map((s) => <Pressable key={s} onPress={() => setFilter((f) => ({ ...f, source: s }))} accessibilityRole="button" accessibilityState={{ selected: filter.source === s }} testID={`activity-source-${s}`}><Chip label={t(`actv.source.${s}` as TKey)} kind={filter.source === s ? 'level' : 'neutral'} /></Pressable>)}
        {(['local', 'synced', 'review', 'failed'] as const).map((s) => <Pressable key={s} onPress={() => setFilter((f) => ({ ...f, status: f.status === s ? 'all' : s }))} accessibilityRole="button" accessibilityState={{ selected: filter.status === s }} testID={`activity-status-${s}`}><Chip label={t(`actv.statusFilter.${s}` as TKey)} kind={filter.status === s ? 'level' : 'neutral'} /></Pressable>)}
      </View>

      <View style={styles.syncRow}>
        <Text variant="caption" tone={pending > 0 ? 'warning' : 'muted'} style={styles.flex} testID="activity-sync-line">
          {ob.owner ? `${t('sync.pending', { n: pending })} · ${t(ob.autoSync ? 'sync.listAutoOn' : 'sync.listAutoOff')}` : t('actv.guestNote')}
        </Text>
        {ob.owner && pending > 0 ? <Button label={t('sum.syncNow')} variant="secondary" onPress={() => void workoutOutbox.run(ob.owner!, { manual: true })} loading={ob.summary.running} loadingLabel={t('sum.syncing')} testID="activity-sync-now" /> : null}
        <Pressable onPress={() => void prefs.set({ activityOrder: prefs.activityOrder === 'asc' ? 'desc' : 'asc' })} accessibilityRole="button" hitSlop={8} style={styles.orderBtn} testID="activity-order">
          <Feather name={prefs.activityOrder === 'asc' ? 'arrow-up' : 'arrow-down'} size={14} color={color.textSecondary} />
          <Text variant="caption" tone="secondary">{t(prefs.activityOrder === 'asc' ? 'actv.order.asc' : 'actv.order.desc')}</Text>
        </Pressable>
      </View>
      {remoteErr && ob.owner ? (
        <Text variant="caption" tone="muted" testID={`activity-remote-${remoteErr.code === 'NO_SESSION' ? 'signin' : 'offline'}`}>
          {t(remoteErr.code === 'NO_SESSION' ? 'actv.remoteSignin' : 'actv.remoteOffline')}
        </Text>
      ) : null}

      {prefs.activityView === 'calendar' ? (
        <Surface style={styles.calendar} testID="activity-calendar">
          <View style={styles.week}>{['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => <Text key={d} variant="caption" tone="muted" style={styles.cell}>{t(`actv.wd.${d}` as TKey)}</Text>)}</View>
          {Array.from({ length: Math.ceil(calendarGrid(month).length / 7) }, (_, w) => (
            <View key={w} style={styles.week}>
              {calendarGrid(month).slice(w * 7, w * 7 + 7).map((day, i) => {
                const d = day ? summary.byDay[day] : undefined;
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

      {visible.length === 0 ? (
        <InlineState kind="info" title={t(items.length ? 'actv.empty.filtered' : 'actv.empty.title')} body={t(items.length ? 'actv.empty.filteredBody' : 'actv.empty.body')} action={items.length ? undefined : { label: t('home.startWorkout'), onPress: () => navigation.navigate('WorkoutStart') }} secondaryAction={items.length ? undefined : { label: t('actv.empty.import'), onPress: () => navigation.navigate('Workouts') }} testID="activity-empty" />
      ) : (
        <Surface style={styles.list} testID="activity-list">
          {visible.map((it) => (
            <Pressable key={it.id} onPress={() => open(it)} accessibilityRole="button" style={styles.row} testID={`activity-item-${it.id}`}>
              <View style={styles.flex}>
                <Text variant="body" numeric>
                  {new Date(it.startedAtUtc).toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: it.timeZone ?? undefined })} · {modeLabel(t, it.sport, it.intent)}
                </Text>
                <Text variant="body" numeric>
                  {it.distanceMm === null ? '—' : formatKm(String(it.distanceMm))} · {it.elapsedMs === null ? '—' : formatDuration(String(it.elapsedMs))} · {it.sport === 'run' ? formatPace(it.avgPaceSPerKm) : it.avgSpeedKmh === null ? '—' : `${it.avgSpeedKmh.toFixed(1)} km/h`}
                </Text>
                <Text variant="caption" tone={it.status === 'sync_failed' || it.status === 'delete_pending' ? 'warning' : it.needsReview || it.status === 'excluded' ? 'danger' : 'muted'} testID={`activity-item-status-${it.id}`}>
                  {it.shoe ? stageName(t, it.shoe.level) : t('sum.shoeUnknown')} · {t(`actv.source.${it.source}` as TKey)} · {t(`actv.status.${it.status}` as TKey)}
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={color.textMuted} />
            </Pressable>
          ))}
        </Surface>
      )}
      <Text variant="caption" tone="muted" style={styles.footnote}>{t('actv.retentionNote')}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.s },
  link: { minHeight: 44, justifyContent: 'center' },
  monthRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  monthBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  segment: { flexDirection: 'row', borderRadius: radius.m, borderWidth: 1, borderColor: color.borderSubtle, overflow: 'hidden' },
  segmentItem: { width: 44, height: 36, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { backgroundColor: color.mint },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.s },
  syncRow: { flexDirection: 'row', alignItems: 'center', gap: space.s, marginTop: space.s },
  orderBtn: { flexDirection: 'row', alignItems: 'center', gap: space.xxs, minHeight: 44 },
  calendar: { marginTop: space.s },
  week: { flexDirection: 'row' },
  cell: { flex: 1, alignItems: 'center', minHeight: 44, justifyContent: 'center', textAlign: 'center' },
  dayCell: { borderRadius: radius.s, paddingVertical: space.xxs },
  dayOn: { backgroundColor: color.elevated },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: color.mint, marginTop: 2 },
  list: { marginTop: space.s, paddingVertical: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: 64, paddingVertical: space.s, borderBottomWidth: 1, borderBottomColor: color.borderSubtle },
  mtXs: { marginTop: space.xs },
  footnote: { marginTop: space.l, textAlign: 'center' },
});
