import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Chip, InlineState, Screen, Surface } from '@/components';
import type { Lap } from '@/domain/gps/engine';
import { formatDuration, formatKm, formatPace } from '@/domain/workouts';
import { useT, type TKey } from '@/i18n';
import type { RootParamList } from '@/navigation/types';
import { LocalWorkoutStore, type SessionMeta } from '@/services/workouts/LocalWorkoutStore';
import { workoutRecorder } from '@/services/workouts/WorkoutRecorder';
import { color, radius, space, Text } from '@/theme';

const store = new LocalWorkoutStore();

/** 摘要頁（Style 23）：距離／elapsed／平均配速或速度／最高 5 秒速度／活動 kcal（無裝置值 —）；分頁 Splits／Laps／品質；路線不顯示（地圖供應商未定） */
export function WorkoutSummaryScreen() {
  const { t } = useT();
  const navigation = useNavigation();
  const { params } = useRoute<RouteProp<RootParamList, 'WorkoutSummary'>>();
  const [meta, setMeta] = useState<SessionMeta | null>(() => store.readMeta(params.sessionId));
  const [tab, setTab] = useState<'splits' | 'laps' | 'quality'>('splits');
  const [syncing, setSyncing] = useState(false);

  const reload = useCallback(() => setMeta(store.readMeta(params.sessionId)), [params.sessionId]);
  useEffect(reload, [reload]);

  const s = meta?.summary;
  if (!meta || !s) return <Screen testID="workout-summary-screen"><InlineState kind="error" title={t('common.somethingInterrupted')} /></Screen>;
  const isWalk = meta.sport === 'walk';
  const syncNow = async () => {
    setSyncing(true);
    try {
      await workoutRecorder.syncMeta(meta);
      reload();
    } finally {
      setSyncing(false);
    }
  };
  const LapRow = ({ l }: { l: Lap }) => (
    <View style={styles.row} testID={`sum-${l.kind}-${l.index}`}>
      <Text variant="bodySmall" tone="muted" numeric style={styles.idx}>
        {l.index}
      </Text>
      <Text variant="body" numeric style={styles.flex}>
        {formatKm(String(l.distanceMm))}
      </Text>
      <Text variant="body" numeric>
        {formatDuration(String(l.durationMs))}
      </Text>
      <Text variant="bodySmall" tone="secondary" numeric style={styles.pace}>
        {formatPace(l.paceSPerKm)}
      </Text>
      {l.isPartial ? <Chip label={t('sum.partial')} kind="neutral" /> : l.uncertain ? <Chip label={t('sum.uncertain')} kind="devnet" /> : s.fastestSplit && l.kind === 'split' && l.index === s.fastestSplit.index ? <Chip label={t('sum.fastest')} kind="synced" /> : null}
    </View>
  );

  return (
    <Screen scroll testID="workout-summary-screen">
      <View style={styles.hero}>
        <Text variant="displayL" numeric testID="sum-distance">
          {formatKm(String(s.distanceMm))}
        </Text>
        <Text variant="caption" tone="muted">
          {t(`wo.sport.${meta.sport}` as TKey)} · {new Date(meta.startedAtUtc).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>
      <View style={styles.grid}>
        <Stat label={t('sum.elapsed')} value={formatDuration(String(s.elapsedMs))} />
        <Stat label={isWalk ? t('sum.avgSpeed') : t('sum.avgPace')} value={isWalk ? (s.avgSpeedKmh === null ? '—' : `${s.avgSpeedKmh.toFixed(1)} km/h`) : formatPace(s.avgPaceSPerKm)} />
        <Stat label={t('sum.max5s')} value={s.maxSpeed5sKmh === null ? '—' : `${s.maxSpeed5sKmh.toFixed(1)} km/h`} />
        <Stat label={t('sum.kcal')} value="—" />
      </View>
      {meta.status === 'needs_review' ? <InlineState kind="warning" title={t('sum.needsReview')} testID="sum-needs-review" /> : null}
      <View style={styles.syncRow}>
        <Text variant="caption" tone={meta.syncedSessionId ? 'success' : 'muted'} testID="sum-sync">
          {meta.syncedSessionId ? t('sum.synced') : t('sum.notSynced')}
        </Text>
        {!meta.syncedSessionId ? <Button label={t('sum.syncNow')} variant="secondary" onPress={() => void syncNow()} loading={syncing} testID="sum-sync-now" /> : null}
      </View>
      <View style={styles.tabs} accessibilityRole="tablist">
        {(['splits', 'laps', 'quality'] as const).map((k) => (
          <Pressable key={k} onPress={() => setTab(k)} accessibilityRole="tab" accessibilityState={{ selected: tab === k }} style={[styles.tab, tab === k && styles.tabOn]} testID={`sum-tab-${k}`}>
            <Text variant="bodySmall" tone={tab === k ? undefined : 'secondary'} style={tab === k && styles.tabOnText}>
              {t(`sum.tab.${k}` as TKey)}
            </Text>
          </Pressable>
        ))}
      </View>
      <Surface style={styles.card}>
        {tab === 'splits' ? (
          s.splits.length ? s.splits.map((l) => <LapRow key={`s${l.index}`} l={l} />) : <Text variant="bodySmall" tone="secondary">{t('sum.noLaps')}</Text>
        ) : tab === 'laps' ? (
          <>
            {s.laps.length ? s.laps.map((l) => <LapRow key={`${l.kind}${l.index}`} l={l} />) : <Text variant="bodySmall" tone="secondary">{t('sum.noLaps')}</Text>}
            {s.trackEquivalent ? (
              <View style={styles.mt} testID="sum-track">
                <Text variant="bodySmall" numeric>
                  {t('sum.trackEq', { laps: s.trackEquivalent.laps, len: s.trackEquivalent.lapMm / 1000, rem: Math.round(s.trackEquivalent.remainderMm / 1000) })}
                </Text>
                <Text variant="caption" tone="muted">
                  {t('sum.trackEqHint')}
                </Text>
              </View>
            ) : null}
          </>
        ) : (
          <View style={styles.qualityWrap} testID="sum-quality">
            <Chip label={t('sum.quality.accepted', { n: s.quality.accepted })} kind="synced" />
            <Chip label={t('sum.quality.rejected', { n: Object.values(s.quality.rejected).reduce((a, b) => a + b, 0) })} kind="neutral" />
            <Chip label={t('sum.quality.gaps', { n: s.quality.gaps })} kind={s.quality.gaps ? 'devnet' : 'neutral'} />
            <Chip label={t('sum.quality.coverage', { p: Math.round(s.quality.coverageRatio * 100) })} kind="neutral" />
          </View>
        )}
      </Surface>
      <Button label={t('sum.done')} style={styles.mt} onPress={() => navigation.navigate('Workouts')} testID="sum-done" />
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text variant="heading2" numeric>
        {value}
      </Text>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', marginTop: space.m },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: space.m, gap: space.s },
  stat: { width: '47%', padding: space.m, borderRadius: radius.m, backgroundColor: color.elevated },
  syncRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.m, gap: space.s },
  tabs: { flexDirection: 'row', marginTop: space.m, borderWidth: 1, borderColor: color.borderSubtle, borderRadius: radius.m, overflow: 'hidden' },
  tab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: color.mint },
  tabOnText: { color: color.onMint },
  card: { marginTop: space.s },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: 40, borderBottomWidth: 1, borderBottomColor: color.borderSubtle },
  idx: { width: 24 },
  flex: { flex: 1 },
  pace: { width: 72, textAlign: 'right' },
  qualityWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  mt: { marginTop: space.m },
});
