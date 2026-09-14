import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { Button, Chip, InlineState, Screen, Surface } from '@/components';
import { formatDuration, formatKcal, formatKm, formatPace, qualityKind } from '@/domain/workouts';
import { useT, type TKey } from '@/i18n';
import { ApiError, apiClient, type WorkoutSummary } from '@/services/api/ApiClient';
import { importFromHealthConnect } from '@/services/workouts/importer';
import type { SessionMeta } from '@/services/workouts/LocalWorkoutStore';
import { workoutRecorder } from '@/services/workouts/WorkoutRecorder';
import { color, radius, space, Text } from '@/theme';

/**
 * 運動紀錄（PG-R-01，FR-14.1／14.2／14.3）：列出已匯入的跑步／健走摘要，區分量測／估算／部分／待審核，
 * Active 與 Total 熱量分開；缺資料顯示 —（不假裝 0）；跨來源可能重複只標記不相加。
 */
export function WorkoutsScreen() {
  const { t } = useT();
  const [items, setItems] = useState<WorkoutSummary[] | null>(null);
  const [error, setError] = useState<{ message: string; code: string; ref?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'info' | 'warning'; title: string } | null>(null);
  const navigation = useNavigation();
  const [recoverable, setRecoverable] = useState<SessionMeta[]>([]);
  useEffect(() => {
    void workoutRecorder.markRecoverable().then(setRecoverable).catch(() => setRecoverable([]));
  }, []);
  const recover = async (m: SessionMeta, action: 'finish' | 'discard') => {
    const r = await workoutRecorder.recover(m.sessionId, action);
    setRecoverable((cur) => cur.filter((x) => x.sessionId !== m.sessionId));
    if (action === 'finish' && r.meta) navigation.navigate('WorkoutSummary', { sessionId: r.meta.sessionId });
    else await load();
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems((await apiClient.myWorkouts({ limit: 100 })).items);
      setError(null);
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
      setNotice({ kind: 'warning', title: t('wo.err', { message: e instanceof Error ? e.message : String(e) }) });
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

  return (
    <Screen scroll testID="workouts-screen" refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={color.mint} />}>
      <Text variant="bodySmall" tone="secondary">
        {t('wo.intro')}
      </Text>
      <Button label={t('wo.record')} style={styles.mt} onPress={() => navigation.navigate('WorkoutStart')} testID="workouts-record" />
      <Button label={t('wo.import')} variant="secondary" style={styles.mtS} onPress={() => void doImport()} loading={importing} loadingLabel={t('wo.importing')} testID="workouts-import" />
      {recoverable.map((m) => (
        <InlineState key={m.sessionId} kind="warning" title={t('wo.recoverTitle')} body={t('wo.recoverBody')} action={{ label: t('wo.recoverSave'), onPress: () => void recover(m, 'finish') }} secondaryAction={{ label: t('wo.recoverDiscard'), onPress: () => void recover(m, 'discard') }} testID={`workouts-recover-${m.sessionId}`} />
      ))}
      {notice ? <InlineState kind={notice.kind} title={notice.title} testID={`workouts-${notice.kind}`} /> : null}
      {error ? (
        error.code === 'NO_SESSION' ? (
          <InlineState kind="info" title={t('act.signin.title')} body={t('act.signin.body')} testID="workouts-signin" />
        ) : (
          <InlineState kind="error" title={t('common.somethingInterrupted')} body={t('wo.err', { message: error.message })} referenceId={error.ref} action={{ label: t('common.tryAgain'), onPress: () => void load(), loading }} testID="workouts-error" />
        )
      ) : items && items.length === 0 ? (
        <InlineState kind="info" title={t('wo.empty')} testID="workouts-empty" />
      ) : null}
      {items?.map((w) => (
        <Surface key={w.session_id} style={styles.card} testID={`workout-${w.session_id}`}>
          <View style={styles.rowBetween}>
            <Text variant="title">
              {t(`wo.sport.${w.sport}` as TKey)}
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
  mt: { marginTop: space.m },
  mtS: { marginTop: space.s },
  mtXs: { marginTop: space.xs },
  card: { marginTop: space.m },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: space.m, marginTop: space.s, padding: space.s, borderRadius: radius.m, backgroundColor: color.elevated },
  metric: { minWidth: 64 },
  link: { minHeight: 32, justifyContent: 'center' },
});
