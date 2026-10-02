import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { Button, Chip, InlineState, Screen, Surface } from '@/components';
import { SignInState } from '@/components/SignInState';
import { formatDuration, formatKcal, formatKm, formatPace, qualityKind, modeLabel } from '@/domain/workouts';
import { useT, type TKey } from '@/i18n';
import { localTimeZone, matchesMode, weeklyReview, type ModeFilter } from '@/domain/review';
import { ApiError, apiClient, type WorkoutSummary } from '@/services/api/ApiClient';
import { apiErrorText } from '@/services/api/errorText';
import { importFromHealthConnect, previewHealthConnect, type ImportPreview } from '@/services/workouts/importer';
import type { SessionMeta } from '@/services/workouts/LocalWorkoutStore';
import { workoutRecorder } from '@/services/workouts/WorkoutRecorder';
import { outboxOrder, workoutOutbox } from '@/services/workouts/WorkoutOutbox';
import { useOutbox } from '@/hooks/useOutbox';
import { PersonalBests } from './workouts/PersonalBests';
import { color, radius, space, Text } from '@/theme';

/**
 * 運動紀錄（PG-R-01，FR-14.1／14.2／14.3）：列出已匯入的跑步／健走摘要，區分量測／估算／部分／待審核，
 * Active 與 Total 熱量分開；缺資料顯示 —（不假裝 0）；跨來源可能重複只標記不相加。
 */
export function WorkoutsScreen() {
  const { t } = useT();
  const [items, setItems] = useState<WorkoutSummary[] | null>(null);
  const [mode, setMode] = useState<ModeFilter>('all'); // PG-U-03：走路＋健走合看 walking
  const [error, setError] = useState<{ message: string; code: string; ref?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'info' | 'warning'; title: string; body?: string } | null>(null);
  const navigation = useNavigation();
  const [recoverable, setRecoverable] = useState<SessionMeta[]>([]);
  // review 6：進行中的運動有固定入口，不會被當成中斷紀錄
  const [active, setActive] = useState(() => workoutRecorder.active());
  const [unsynced, setUnsynced] = useState<SessionMeta[]>([]);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  // review 9：本機清單（可恢復／未同步）不只在首次掛載讀一次。
  // 頁面留在導覽堆疊時，從記錄頁或摘要頁返回會重新取得焦點 → 重讀；recorder 狀態變化（結束、背景同步完成）→ 重讀。
  const reloadLocal = useCallback(() => {
    setActive(workoutRecorder.active());
    void workoutRecorder.markRecoverable().then(setRecoverable).catch(() => setRecoverable([]));
    setUnsynced(workoutRecorder.unsynced());
  }, []);
  useFocusEffect(useCallback(() => { reloadLocal(); }, [reloadLocal]));
  useEffect(() => workoutRecorder.subscribe(reloadLocal), [reloadLocal]);
  // PG-LINK-02：單筆「立即同步」走同一條有序佇列（從最早那筆開始，不跳過）；訪客紀錄先歸屬到目前錢包
  const ob = useOutbox();
  const syncLocal = async (m: SessionMeta) => {
    if (!ob.owner) { setNotice({ kind: 'warning', title: t('wo.local.needSignin') }); return; }
    setSyncingId(m.sessionId);
    setNotice(null);
    try {
      if (!m.owner) await workoutOutbox.assign([m.sessionId], ob.owner);
      const r = await workoutOutbox.run(ob.owner, { manual: true, target: m.sessionId });
      const o = r.target ?? { ok: false as const, code: 'UNKNOWN' as const, message: '' };
      if (o.ok) { setNotice({ kind: 'success', title: t('wo.local.synced') }); await load(); }
      else if (o.code === 'NO_SESSION') setNotice({ kind: 'warning', title: t('wo.local.needSignin') });
      else if (o.code === 'BLOCKED_EARLIER') setNotice({ kind: 'warning', title: t('sync.blockedEarlier'), body: r.stoppedAt && !r.stoppedAt.outcome.ok ? t(`sync.err.${r.stoppedAt.outcome.code}` as TKey, { message: r.stoppedAt.outcome.message }) : undefined });
      else setNotice({ kind: 'warning', title: t('wo.local.syncFailed', { message: o.message }) });
    } finally {
      setSyncingId(null);
      setUnsynced(workoutRecorder.unsynced());
    }
  };
  const excludeLocal = (m: SessionMeta, reason: string) => {
    Alert.alert(t('sync.exclude.title'), t('sync.exclude.body'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('sync.exclude.confirm'), style: 'destructive', onPress: () => void workoutOutbox.exclude(m.sessionId, reason) },
    ]);
  };
  const deleteLocal = (m: SessionMeta) => {
    Alert.alert(t('wo.local.deleteTitle'), t('wo.local.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('wo.local.delete'), style: 'destructive', onPress: () => { workoutRecorder.deleteLocal(m.sessionId); setUnsynced(workoutRecorder.unsynced()); } },
    ]);
  };
  const recover = async (m: SessionMeta, action: 'finish' | 'discard') => {
    const r = await workoutRecorder.recover(m.sessionId, action);
    setRecoverable((cur) => cur.filter((x) => x.sessionId !== m.sessionId));
    if (action === 'finish' && r.meta) navigation.navigate('WorkoutSummary', { sessionId: r.meta.sessionId });
    else await load();
  };

  // 匯入預檢：伺服器清單載入後對照 Health Connect（不提示權限）；全部已匯入 → 不顯示匯入按鈕，只留一行說明
  const [preview, setPreview] = useState<ImportPreview>({ kind: 'unknown' });
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = (await apiClient.myWorkouts({ limit: 100 })).items;
      setItems(list);
      setError(null);
      previewHealthConnect(list).then(setPreview).catch(() => setPreview({ kind: 'unknown' }));
    } catch (e) {
      setError(e instanceof ApiError ? { message: e.message, code: e.code, ...(e.requestId ? { ref: e.requestId } : {}) } : { message: String(e), code: 'UNKNOWN' });
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const doImport = async () => {
    setImporting(true);
    setNotice(null);
    try {
      const r = await importFromHealthConnect();
      if (r.kind === 'unavailable') setNotice({ kind: 'info', title: t('wo.notAvailable') });
      else if (r.kind === 'denied') setNotice({ kind: 'warning', title: t('wo.denied') });
      else if (r.imported === 0) setNotice({ kind: 'info', title: t('wo.nothingNew') });
      else setNotice({ kind: 'success', title: t('wo.imported', { n: r.imported, count: r.imported }) });
      if (r.kind === 'ok') await load();
    } catch (e) {
      // 不把原始例外訊息塞進文案：apiErrorText 會把網路類錯誤轉成看得懂的句子，
      // 其餘沿用後端 message（那是 errorText.ts 裡刻意的取捨）
      setNotice({ kind: 'warning', title: t('wo.err', { message: apiErrorText(t, e) }) });
    } finally {
      setImporting(false);
    }
  };

  const remove = (w: WorkoutSummary) => {
    Alert.alert(t('wo.deleteTitle'), t('wo.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('wo.delete'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              // PG-LINK-03：這支手機記錄的 session → 先寫 tombstone 走佇列（離線也能刪、不會被上傳復活）；只在伺服器的（匯入）→ 直接刪
              const local = workoutRecorder.localStore().list().find((m) => m.syncedSessionId === w.session_id);
              if (local && ob.owner) {
                await workoutOutbox.requestDelete(local.sessionId);
                const r = await workoutOutbox.run(ob.owner, { manual: true, target: local.sessionId });
                if (r.target?.ok) { setNotice({ kind: 'success', title: t('wo.deleted') }); await load(); }
                else setNotice({ kind: 'info', title: t('sync.deletePending'), body: r.target && !r.target.ok ? t(`sync.err.${r.target.code}` as TKey, { message: r.target.message }) : undefined });
                return;
              }
              await apiClient.deleteWorkout(w.session_id);
              setNotice({ kind: 'success', title: t('wo.deleted') });
              await load();
            } catch (e) {
              setNotice({ kind: 'warning', title: t('wo.err', { message: e instanceof Error ? e.message : String(e) }) });
            }
          })();
        },
      },
    ]);
  };

  /** 有這支手機錄的原始紀錄 → 開 WorkoutSummary（路線、分段）；只在伺服器（匯入）→ ActivityDetail。與 Activity 分頁同一規則 */
  const openServer = (w: { session_id: string }) => {
    const local = workoutRecorder.localStore().list().find((m) => m.syncedSessionId === w.session_id);
    if (local) navigation.navigate('WorkoutSummary', { sessionId: local.sessionId });
    else navigation.navigate('ActivityDetail', { serverId: w.session_id });
  };

  return (
    <Screen scroll testID="workouts-screen" refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={color.mint} />}>
      <Text variant="bodySmall" tone="secondary">
        {t('wo.intro')}
      </Text>
      <Button label={t('wo.record')} style={styles.mt} onPress={() => navigation.navigate('WorkoutStart')} testID="workouts-record" />
      {preview.kind === 'ok' && preview.pending === 0 ? (
        <Text variant="caption" tone="muted" style={styles.mtS} testID="workouts-import-uptodate">{t('wo.importUpToDate', { n: preview.total })}</Text>
      ) : (
        <Button label={preview.kind === 'ok' ? t('wo.importPending', { n: preview.pending }) : t('wo.import')} variant="secondary" style={styles.mtS} onPress={() => void doImport()} loading={importing} loadingLabel={t('wo.importing')} testID="workouts-import" />
      )}
      {active ? (
        <InlineState kind="info" title={t('wo.ongoing.title')} body={t('wo.ongoing.body')} action={{ label: t('wo.ongoing.return'), onPress: () => navigation.navigate('WorkoutRecord') }} testID="workouts-ongoing" />
      ) : null}
      {recoverable.map((m) => (
        <InlineState key={m.sessionId} kind="warning" title={t('wo.recoverTitle')} body={t('wo.recoverBody')} action={{ label: t('wo.recoverSave'), onPress: () => void recover(m, 'finish') }} secondaryAction={{ label: t('wo.recoverDiscard'), onPress: () => void recover(m, 'discard') }} testID={`workouts-recover-${m.sessionId}`} />
      ))}
      {notice ? <InlineState kind={notice.kind} title={notice.title} body={notice.body} testID={`workouts-${notice.kind}`} /> : null}
      {unsynced.length || ob.list.length ? (
        <Surface style={styles.mt} testID="workouts-unsynced">
          <Text variant="title">{t('wo.local.title', { n: unsynced.length + ob.list.filter((e) => e.op === 'delete').length })}</Text>
          <Text variant="caption" tone="secondary">{t('wo.local.body')} {t(ob.autoSync ? 'sync.listAutoOn' : 'sync.listAutoOff')}</Text>
          {ob.summary.head && (ob.summary.head.status === 'blocked' || ob.summary.head.status === 'retry_wait') && ob.summary.pending > 1 ? (
            <Text variant="caption" tone="warning" style={styles.mtXs} testID="workouts-head-stuck">{t('sync.headStuck', { when: new Date(ob.summary.head.meta.startedAtUtc).toLocaleDateString(), reason: t(`sync.err.${ob.summary.head.lastError?.code ?? 'UNKNOWN'}` as TKey, { message: ob.summary.head.lastError?.message ?? '' }) })}</Text>
          ) : null}
          {/* 同步永遠由舊到新：清單也用同一順序，並標示目前處理項與狀態 */}
          {[...ob.list.map((e) => ({ m: e.meta, e })), ...ob.unassigned.map((m) => ({ m, e: null }))].sort((a, b) => outboxOrder(a.m, b.m)).map(({ m, e }) => (
            <View key={m.sessionId} style={styles.localRow} testID={`workouts-local-${m.sessionId}`}>
              <Pressable style={styles.flex} onPress={() => navigation.navigate('WorkoutSummary', { sessionId: m.sessionId })} accessibilityRole="button" testID={`workouts-local-open-${m.sessionId}`}>
                <Text variant="body">{modeLabel(t, m.sport, m.intent)} · {formatKm(String(m.summary?.distanceMm ?? 0))} · {formatDuration(String(m.summary?.elapsedMs ?? 0))}</Text>
                <Text variant="caption" tone="muted">{new Date(m.startedAtUtc).toLocaleString()}{m.status === 'needs_review' ? ` · ${t('sum.needsReviewShort')}` : ''}</Text>
                <Text variant="caption" tone={e?.status === 'blocked' ? 'warning' : e?.status === 'excluded' ? 'danger' : 'muted'} testID={`workouts-local-status-${m.sessionId}`}>
                  {e?.op === 'delete' ? t('sync.deletePending') : e ? t(`sync.status.${e.status}` as TKey) : t('sync.status.guest')}{e?.lastError && (e.status === 'blocked' || e.status === 'retry_wait') ? ` · ${t(`sync.err.${e.lastError.code}` as TKey, { message: e.lastError.message })}` : ''}
                </Text>
              </Pressable>
              {e?.status === 'excluded' ? (
                <Button label={t('sync.unexclude')} variant="secondary" onPress={() => void workoutOutbox.unexclude(m.sessionId)} testID={`workouts-local-unexclude-${m.sessionId}`} />
              ) : (
                <Button label={t('sum.syncNow')} variant="secondary" onPress={() => void syncLocal(m)} loading={syncingId === m.sessionId || e?.status === 'sending'} loadingLabel={t('sum.syncing')} testID={`workouts-local-sync-${m.sessionId}`} />
              )}
              {e?.status === 'blocked' && e.lastError?.code === 'REJECTED' ? (
                <Pressable onPress={() => excludeLocal(m, e.lastError!.message)} accessibilityRole="button" accessibilityLabel={t('sync.exclude.btn')} hitSlop={8} style={styles.trash} testID={`workouts-local-exclude-${m.sessionId}`}>
                  <Text variant="label" tone="warning">{t('sync.exclude.btn')}</Text>
                </Pressable>
              ) : null}
              {e?.op !== 'delete' ? (
                <Pressable onPress={() => deleteLocal(m)} accessibilityRole="button" accessibilityLabel={t('wo.local.delete')} hitSlop={8} style={styles.trash} testID={`workouts-local-delete-${m.sessionId}`}>
                  <Text variant="label" tone="danger">{t('wo.local.delete')}</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </Surface>
      ) : null}
      {error ? (
        error.code === 'NO_SESSION' ? (
          <SignInState title={t('act.signin.title')} body={t('act.signin.body')} onSignedIn={load} testID="workouts-signin" />
        ) : (
          <InlineState kind="error" title={t('common.somethingInterrupted')} body={t('wo.err', { message: error.message })} referenceId={error.ref} action={{ label: t('common.tryAgain'), onPress: () => void load(), loading }} testID="workouts-error" />
        )
      ) : items && items.length === 0 ? (
        <InlineState kind="info" title={t('wo.empty')} testID="workouts-empty" />
      ) : null}
      <PersonalBests reloadKey={items?.length ?? 0} />
      {items && items.length ? (
        <>
          <View style={styles.filters} accessibilityRole="tablist">
            {(['all', 'walking', 'running'] as const).map((f) => (
              <Pressable key={f} onPress={() => setMode(f)} accessibilityRole="tab" accessibilityState={{ selected: mode === f }} style={[styles.filter, mode === f && styles.filterOn]} testID={`workouts-filter-${f}`}>
                <Text variant="caption" tone={mode === f ? undefined : 'secondary'} style={mode === f && styles.filterOnText}>
                  {t(`wo.filter.${f}` as TKey)}
                </Text>
              </Pressable>
            ))}
          </View>
          <Surface style={styles.card} testID="workouts-week-review">
            <Text variant="title">{t('wo.week.title')}</Text>
            <Text variant="caption" tone="muted">
              {t('wo.week.note', { tz: localTimeZone() })}
            </Text>
            {weeklyReview(items, mode).slice(0, 4).map((wk) => (
              <View key={wk.weekStart} style={styles.weekBlock} testID={`workouts-week-${wk.weekStart}`}>
                <Text variant="bodySmall">{t('wo.week.row', { start: wk.weekStart })}</Text>
                <View style={styles.weekMetrics}>
                  <Metric label={t('wo.week.sessions')} value={String(wk.sessions)} />
                  <Metric label={t('wo.week.days')} value={String(wk.activeDays)} />
                  <Metric label={t('wo.week.distance')} value={formatKm(String(wk.distanceMm))} />
                  <Metric label={t('wo.week.duration')} value={formatDuration(String(wk.elapsedMs))} />
                </View>
              </View>
            ))}
          </Surface>
        </>
      ) : null}
      {items?.filter((w) => matchesMode(w, mode)).map((w) => (
        // 2026-10-02 實機：已同步的紀錄只出現在這張伺服器卡片上，而它原本整張沒有 onPress——
        // 同一筆在 Activity 分頁點得開，在這裡點下去毫無反應。開啟規則與 Activity 分頁一致。
        <Pressable key={w.session_id} onPress={() => openServer(w)} accessibilityRole="button" testID={`workout-open-${w.session_id}`}>
        <Surface style={styles.card} testID={`workout-${w.session_id}`}>
          <View style={styles.rowBetween}>
            <Text variant="title">
              {modeLabel(t, w.sport, w.intent)}
              {w.environment === 'indoor' ? ` · ${t('wo.env.indoor')}` : ''}
            </Text>
            <Chip label={t(`wo.quality.${w.quality}` as TKey)} kind={qualityKind(w.quality)} />
          </View>
          <Text variant="caption" tone="muted">
            {new Date(w.started_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </Text>
          <View style={styles.metrics}>
            <Metric label="km" value={formatKm(w.metrics.distance?.value_mm)} />
            <Metric label={t('wo.time')} value={formatDuration(w.elapsed_ms)} />
            <Metric label={t('wo.pace')} value={formatPace(w.metrics.avg_pace_s_per_km)} />
            <Metric label="kcal" value={w.metrics.active_energy ? formatKcal(w.metrics.active_energy.value_mkcal) : w.metrics.total_energy ? `${formatKcal(w.metrics.total_energy.value_mkcal)} (${t('wo.energyTotal')})` : '—'} />
          </View>
          <Text variant="caption" tone="muted" style={styles.mtXs}>
            {t('wo.source', { origin: t(`wo.origin.${w.source.origin}` as TKey), id: w.source.source_id })}
            {w.metrics.steps !== null ? ` · ${w.metrics.steps.toLocaleString()} steps` : ''}
          </Text>
          {w.review_reasons.length > 0 ? (
            <Text variant="caption" tone="warning" style={styles.mtXs}>
              {w.review_reasons.map((r) => t(`wo.reason.${r}` as TKey)).join(' · ')}
            </Text>
          ) : null}
          {w.possible_duplicate_of ? (
            <Text variant="caption" tone="warning" style={styles.mtXs} testID={`workout-dup-${w.session_id}`}>
              {t('wo.dup')}
            </Text>
          ) : null}
          <View style={styles.rowBetween}>
            {w.pb_eligible ? <Chip label={t('wo.pbEligible')} kind="level" /> : <View />}
            <Pressable onPress={() => remove(w)} accessibilityRole="button" accessibilityLabel={t('wo.delete')} hitSlop={8} style={styles.link} testID={`workout-delete-${w.session_id}`}>
              <Text variant="caption" tone="danger">
                {t('wo.delete')}
              </Text>
            </Pressable>
          </View>
        </Surface>
        </Pressable>
      ))}
    </Screen>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text variant="bodySmall" numeric>
        {value}
      </Text>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  localRow: { flexDirection: 'row', alignItems: 'center', gap: space.s, marginTop: space.s },
  trash: { minHeight: 44, justifyContent: 'center' },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.m },
  filter: { minHeight: 36, paddingHorizontal: space.s, borderRadius: radius.m, borderWidth: 1, borderColor: color.borderSubtle, alignItems: 'center', justifyContent: 'center' },
  filterOn: { backgroundColor: color.mint, borderColor: color.mint },
  filterOnText: { color: color.onMint },
  mt: { marginTop: space.m },
  mtS: { marginTop: space.s },
  mtXs: { marginTop: space.xs },
  card: { marginTop: space.m },
  rowBetween: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: space.s },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: space.m, marginTop: space.s, padding: space.s, borderRadius: radius.m, backgroundColor: color.elevated },
  metric: { minWidth: 0, flexBasis: '43%', flexGrow: 1, flexShrink: 1, gap: space.xxs },
  weekBlock: { marginTop: space.m, paddingTop: space.m, borderTopWidth: 1, borderTopColor: color.borderSubtle, gap: space.s },
  weekMetrics: { flexDirection: 'row', flexWrap: 'wrap', gap: space.m },
  link: { minHeight: 32, justifyContent: 'center' },
});
