import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Chip, InlineState, Screen, Surface } from '@/components';
import { SignInState } from '@/components/SignInState';
import { itemFromRemote, type ActivityItem } from '@/domain/activity';
import { stageName } from '@/domain/collectibles';
import { estimateEnergy } from '@/domain/energy';
import { formatDuration, formatKcal, formatKm, formatPace, modeLabel, qualityKind, reviewReasonsText } from '@/domain/workouts';
import { useWeightKg } from '@/state/bodyStore';
import { useT, type TKey } from '@/i18n';
import type { RootParamList } from '@/navigation/types';
import { ApiError, apiClient, type WorkoutSummary } from '@/services/api/ApiClient';
import { color, space, Text } from '@/theme';

/**
 * 伺服器摘要詳情（PG-LINK-04）：只在伺服器（Health Connect 匯入、他裝置同步）的紀錄——顯示可得欄位；缺資料隱藏對應區塊並說明。
 * 伺服器摘要不可捏造路線；本機有原始點的紀錄走 WorkoutSummary。只限本人。
 */
export function ActivityDetailScreen() {
  const { t } = useT();
  const navigation = useNavigation();
  const { params } = useRoute<RouteProp<RootParamList, 'ActivityDetail'>>();
  const [w, setW] = useState<WorkoutSummary | null>(null);
  const [err, setErr] = useState<{ code: string; message: string } | null>(null);
  const load = useCallback(async () => {
    try { setW(await apiClient.workout(params.serverId)); setErr(null); }
    catch (e) { setErr(e instanceof ApiError ? { code: e.code, message: e.message } : { code: 'UNKNOWN', message: String(e) }); }
  }, [params.serverId]);
  useEffect(() => { void load(); }, [load]);
  const { weightKg } = useWeightKg(); // PG-R-11（hook 須在 early return 之前）
  if (err) {
    return (
      <Screen testID="activity-detail-screen">
        {err.code === 'NO_SESSION' ? (
          <SignInState title={t('act.signin.title')} body={t('act.signin.body')} onSignedIn={load} testID="activity-detail-signin" />
        ) : (
          <InlineState kind={err.code === 'NETWORK_ERROR' ? 'warning' : 'error'} title={err.code === 'NOT_FOUND' ? t('actv.detail.notFound') : t('common.somethingInterrupted')} body={err.message} action={{ label: t('common.tryAgain'), onPress: () => void load() }} testID="activity-detail-error" />
        )}
      </Screen>
    );
  }
  if (!w) return <Screen testID="activity-detail-screen"><InlineState kind="info" title={t('common.loading')} testID="activity-detail-loading" /></Screen>;
  const it: ActivityItem = itemFromRemote(w);
  const isWalk = it.sport === 'walk';
  // PG-R-11：無裝置熱量時，以手機上的體重估算（分段優先）
  const energy = it.activeKcalMkcal === null ? estimateEnergy({ sport: it.sport, weightKg, movingMs: it.movingMs, distanceMm: it.distanceMm, segments: it.splits?.filter((l) => !l.isPartial).map((l) => ({ distanceMm: l.distanceMm, durationMs: l.durationMs })) ?? null }) : null;
  const when = (ms: number | null) => (ms === null ? '—' : new Date(ms).toLocaleString(undefined, { timeZone: it.timeZone ?? undefined }));
  return (
    <Screen scroll testID="activity-detail-screen">
      <View style={styles.hero}>
        <Text variant="displayL" numeric testID="activity-detail-distance">{it.distanceMm === null ? '—' : formatKm(String(it.distanceMm))}</Text>
        <Text variant="caption" tone="muted">{modeLabel(t, it.sport, it.intent)} · {when(it.startedAtUtc)}</Text>
        <View style={styles.chips}>
          <Chip label={t(`actv.source.${it.source}`)} kind="neutral" />
          <Chip label={t(`wo.quality.${w.quality}` as TKey)} kind={qualityKind(w.quality)} />
          {it.needsReview ? <Chip label={t('sum.needsReviewShort')} kind="devnet" /> : null}
        </View>
      </View>
      <Surface>
        {([
          [t('actv.detail.start'), when(it.startedAtUtc)],
          [t('actv.detail.end'), when(it.endedAtUtc)],
          [t('sum.elapsed'), it.elapsedMs === null ? '—' : formatDuration(String(it.elapsedMs))],
          [t('sum.moving'), it.movingMs === null ? '—' : formatDuration(String(it.movingMs))],
          [isWalk ? t('sum.avgSpeed') : t('sum.avgPace'), isWalk ? (it.avgSpeedKmh === null ? '—' : `${it.avgSpeedKmh.toFixed(1)} km/h`) : formatPace(it.avgPaceSPerKm)],
          [t('actv.detail.steps'), it.steps === null ? '—' : String(it.steps)],
          [energy ? t('sum.kcalEstimated') : t('sum.kcal'), it.activeKcalMkcal !== null ? formatKcal(String(it.activeKcalMkcal)) : energy ? `≈${energy.activeKcal} kcal` : '—'],
          [t('sum.shoe'), it.shoe ? `Lv.${it.shoe.level} · ${stageName(t, it.shoe.level)}` : t('sum.shoeUnknown')],
          [t('actv.detail.pb'), it.pbEligible === null ? '—' : t(it.pbEligible ? 'actv.detail.pbYes' : 'actv.detail.pbNo')],
          [t('actv.detail.sync'), t('actv.status.server_only')],
          [t('route.title'), t(`sum.layer.${it.routeAppearance.layer}` as TKey)],
        ] as const).map(([label, value]) => (
          <View key={label} style={styles.row}>
            <Text variant="label" tone="muted" uppercase>{label}</Text>
            <Text variant="body" numeric style={styles.value}>{value}</Text>
          </View>
        ))}
      </Surface>
      {it.splits && it.splits.length ? (
        <Surface style={styles.mt} testID="activity-detail-splits">
          <Text variant="label" tone="muted" uppercase>{t('sum.tab.splits')}</Text>
          {it.splits.map((s, i) => (
            <View key={i} style={styles.row}>
              <Text variant="bodySmall" tone="muted" numeric>{i + 1}{s.isPartial ? ` · ${t('sum.partial')}` : ''}</Text>
              <Text variant="body" numeric>{formatKm(String(s.distanceMm))} · {formatDuration(String(s.durationMs))} · {formatPace(s.paceSPerKm)}</Text>
            </View>
          ))}
        </Surface>
      ) : (
        <Text variant="caption" tone="muted" style={styles.mt} testID="activity-detail-no-splits">{t('actv.detail.noSplits')}</Text>
      )}
      {it.reviewReasons.length ? <InlineState kind="warning" title={t('sum.needsReview')} body={`${reviewReasonsText(t, it.reviewReasons)}\n${t('sum.needsReview.next')}`} testID="activity-detail-review" /> : null}
      <Text variant="caption" tone="muted" style={styles.mt}>{t('actv.detail.noRoute')}</Text>
      <Text variant="caption" tone="cyan" style={styles.mt} onPress={() => navigation.goBack()}>{t('common.close')}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: space.xs, marginBottom: space.m },
  chips: { flexDirection: 'row', gap: space.xs, flexWrap: 'wrap', justifyContent: 'center' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.m, minHeight: 44, borderBottomWidth: 1, borderBottomColor: color.borderSubtle },
  value: { flexShrink: 1, textAlign: 'right' },
  mt: { marginTop: space.m },
});
