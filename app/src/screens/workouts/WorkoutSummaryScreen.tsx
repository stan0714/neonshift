import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Share, StyleSheet, Switch, View } from 'react-native';

import { Button, Chip, InlineState, Screen, Surface } from '@/components';
import { SignInState } from '@/components/SignInState';
import { RouteTrace, TRACE_LAYERS } from '@/components/RouteTrace';
import { WorkoutActionFeedback } from '@/components/WorkoutActionMotion';
import { modeOfIntent, useWorkoutPrefs } from '@/state/workoutPrefsStore';
import type { Lap, RawPoint } from '@/domain/gps/engine';
import { GPS_QUALITY } from '@/domain/gps/thresholds';
import { formatDuration, formatKm, formatPace, modeLabel } from '@/domain/workouts';
import { useT, type TKey } from '@/i18n';
import { compareSameCategory, SHARE_CARD_DEFAULT, shareCard, type ShareCardFields } from '@/domain/review';
import { apiClient, type WorkoutSummary } from '@/services/api/ApiClient';
import type { RootParamList } from '@/navigation/types';
import { LocalWorkoutStore, type SessionMeta } from '@/services/workouts/LocalWorkoutStore';
import { goalReached, workoutRecorder, type SyncOutcome } from '@/services/workouts/WorkoutRecorder';
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
  const [syncOutcome, setSyncOutcome] = useState<SyncOutcome | null>(null);

  const reload = useCallback(() => setMeta(store.readMeta(params.sessionId)), [params.sessionId]);
  useEffect(reload, [reload]);
  // finish() 保存後即進入本頁，同步在背景進行；完成時 recorder 會 emit，這裡重讀 meta 讓「已同步」即時更新
  useEffect(() => workoutRecorder.subscribe(reload), [reload]);

  const s = meta?.summary;
  // 軌跡預覽（預設開啟，可在此關閉並記住）：讀本機加密點，只在畫面上畫折線，不上傳
  const prefs = useWorkoutPrefs();
  const [points, setPoints] = useState<RawPoint[] | null>(null);
  useEffect(() => {
    if (!prefs.showRoute || meta?.environment === 'indoor') return;
    let alive = true;
    store.readPoints(params.sessionId).then((pts) => { if (alive) setPoints(pts); }).catch(() => { if (alive) setPoints([]); });
    return () => { alive = false; };
  }, [params.sessionId, prefs.showRoute, meta?.environment]);
  // PG-U-03：同類回顧（伺服器清單）與分享欄位
  const [peers, setPeers] = useState<WorkoutSummary[] | null>(null);
  const [shareFields, setShareFields] = useState<ShareCardFields>(SHARE_CARD_DEFAULT);
  useEffect(() => {
    let alive = true;
    apiClient.myWorkouts({ limit: 100 }).then((r) => { if (alive) setPeers(r.items); }).catch(() => { if (alive) setPeers([]); });
    return () => { alive = false; };
  }, [params.sessionId]);
  const peersLoaded = peers !== null;
  const rejectedTotal = s ? Object.values(s.quality.rejected).reduce((a, b) => a + b, 0) : 0;
  const integrity = s?.integrity ?? null;
  const autoPausedMs = (meta?.pauses ?? []).filter((p) => p.kind === 'auto').reduce((n, p) => n + ((p.resumedAtMs ?? meta?.endedAtUtc ?? p.atMs) - p.atMs), 0); // 舊 session（規則 v1）沒有 integrity → 視為未檢查（顯示 ok 但不宣稱）
  const asSummary: WorkoutSummary | null = meta && s ? ({ session_id: meta.syncedSessionId ?? meta.sessionId, sport: meta.sport, intent: meta.intent ?? null, environment: meta.environment, source: { origin: 'gps', source_id: 'cc.neonshift.app/gps', external_record_id: meta.sessionId, source_revision: 1 }, started_at: new Date(meta.startedAtUtc).toISOString(), ended_at: new Date(meta.endedAtUtc ?? meta.startedAtUtc + s.elapsedMs).toISOString(), elapsed_ms: String(s.elapsedMs), paused_ms: String(s.pausedMs), status: 'saved', quality: 'complete', rules_version: s.rulesVersion, review_reasons: [], metrics: { distance: s.distanceMm > 0 ? { value_mm: String(s.distanceMm), method: 'gps' } : null, steps: null, active_energy: null, total_energy: null, avg_pace_s_per_km: s.avgPaceSPerKm, avg_speed_kmh: s.avgSpeedKmh, step_length_mm: null }, pb_eligible: false, possible_duplicate_of: null, extras: {}, revision: 1, imported_at: '', updated_at: '' } as WorkoutSummary) : null;
  const cmp = asSummary && peers ? compareSameCategory(asSummary, peers) : null;
  const sharePreview = meta && s
    ? shareCard(
        { sport: meta.sport, intent: meta.intent ?? null, startedAt: new Date(meta.startedAtUtc), elapsedMs: s.elapsedMs, movingMs: s.movingMs, distanceMm: s.distanceMm, avgPaceSPerKm: s.avgPaceSPerKm, avgSpeedKmh: s.avgSpeedKmh, maxSpeed5sKmh: s.maxSpeed5sKmh, splits: s.splits.map((x) => ({ index: x.index, paceSPerKm: x.paceSPerKm, isPartial: x.isPartial })), lapCount: s.laps.length, goal: meta.goal ?? null, goalMet: !!meta.goal && goalReached(meta.goal, s.elapsedMs, s.distanceMm), qualityAccepted: s.quality.accepted, qualityRejected: Object.values(s.quality.rejected).reduce((a, b) => a + b, 0), autoPausedMs },
        shareFields,
        (k, p) => t(k as TKey, p),
        { mode: modeLabel(t, meta.sport, meta.intent), app: 'NeonShift', site: 'neonshift.cc' },
      )
    : '';
  // PG-U-01：目標結果（未達標仍保存，顯示實際完成）；模式標籤
  const goalMet = !!meta?.goal && !!s && goalReached(meta.goal, s.elapsedMs, s.distanceMm);
  const goalLabel = meta?.goal ? (meta.goal.kind === 'time' ? t('rec.goal.min', { n: Math.round(meta.goal.target / 60) }) : t('rec.goal.km', { n: meta.goal.target / 1_000_000 })) : '';
  if (!meta || !s) return <Screen testID="workout-summary-screen"><InlineState kind="error" title={t('common.somethingInterrupted')} /></Screen>;
  const isWalk = meta.sport === 'walk';
  const syncNow = async () => {
    setSyncing(true);
    try {
      const r = await workoutRecorder.syncMeta(meta);
      setSyncOutcome(r);
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
          {modeLabel(t, meta.sport, meta.intent)} · {new Date(meta.startedAtUtc).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>
      <View style={styles.grid}>
        <Stat label={t('sum.elapsed')} value={formatDuration(String(s.elapsedMs))} />
        <Stat label={t('sum.moving')} value={formatDuration(String(s.movingMs))} />
        <Stat label={t('sum.pausedStat')} value={s.pausedMs > 0 ? `${formatDuration(String(s.pausedMs))}${autoPausedMs > 0 ? ` (${t('sum.autoPausedShort', { t: formatDuration(String(autoPausedMs)) })})` : ''}` : '—'} />
        <Stat label={isWalk ? t('sum.avgSpeed') : t('sum.avgPace')} value={isWalk ? (s.avgSpeedKmh === null ? '—' : `${s.avgSpeedKmh.toFixed(1)} km/h`) : formatPace(s.avgPaceSPerKm)} />
        <Stat label={t('sum.max5s')} value={s.maxSpeed5sKmh === null ? '—' : `${s.maxSpeed5sKmh.toFixed(1)} km/h`} />
        <Stat label={t('sum.kcal')} value="—" />
      </View>
      {meta.environment !== 'indoor' ? (
        <Surface style={styles.card} testID="sum-route">
          <View style={styles.routeHead}>
            <Text variant="title">{t('sum.route')}</Text>
            <Switch value={prefs.showRoute} onValueChange={(v) => void prefs.set({ showRoute: v })} trackColor={{ true: color.mint, false: color.borderSubtle }} thumbColor={color.textPrimary} accessibilityLabel={t('sum.routeToggle')} testID="sum-route-toggle" />
          </View>
          {prefs.showRoute ? <RouteTrace points={points ?? []} layer={prefs.traceLayer} /> : null}
          {prefs.showRoute ? (
            <View style={styles.layerRow} accessibilityRole="radiogroup" testID="sum-route-layers">
              {TRACE_LAYERS.map((l) => (
                <Pressable key={l} onPress={() => void prefs.set({ traceLayer: l })} accessibilityRole="radio" accessibilityState={{ selected: prefs.traceLayer === l }} style={[styles.layerChip, prefs.traceLayer === l && styles.layerChipOn]} testID={`sum-route-layer-${l}`}>
                  <Text variant="caption" tone={prefs.traceLayer === l ? undefined : 'secondary'} style={prefs.traceLayer === l && styles.layerChipOnText}>
                    {t(`sum.layer.${l}` as TKey)}
                  </Text>
                </Pressable>
              ))}
              <View style={[styles.layerChip, styles.layerChipDisabled]} accessible accessibilityLabel={`${t('sum.layer.geo')} · ${t('sum.layer.geoPending')}`} testID="sum-route-layer-geo">
                <Text variant="caption" tone="muted">
                  {t('sum.layer.geo')} · {t('sum.layer.geoPending')}
                </Text>
              </View>
            </View>
          ) : null}
          <Text variant="caption" tone="muted" style={styles.routeHint}>
            {t('sum.routeHint')}
          </Text>
        </Surface>
      ) : null}
      {meta.status === 'needs_review' ? <InlineState kind="warning" title={t('sum.needsReview')} testID="sum-needs-review" /> : null}
      <View style={styles.syncRow}>
        <Text variant="caption" tone={meta.syncedSessionId ? 'success' : 'muted'} testID="sum-sync">
          {meta.syncedSessionId ? t('sum.synced') : t('sum.notSynced')}
        </Text>
        {!meta.syncedSessionId ? <Button label={t('sum.syncNow')} variant="secondary" onPress={() => void syncNow()} loading={syncing} loadingLabel={t('sum.syncing')} testID="sum-sync-now" /> : null}
      </View>
      {syncOutcome && !syncOutcome.ok && !meta.syncedSessionId ? (
        syncOutcome.code === 'NO_SESSION' ? (
          <SignInState title={t('sum.sync.signinTitle')} body={t('sum.sync.signinBody')} onSignedIn={syncNow} testID="sum-sync-signin" />
        ) : (
          <InlineState kind={syncOutcome.code === 'NETWORK_ERROR' ? 'warning' : 'error'} title={t(syncOutcome.code === 'NETWORK_ERROR' ? 'sum.sync.offlineTitle' : syncOutcome.code === 'REJECTED' ? 'sum.sync.rejectedTitle' : 'sum.sync.failedTitle')} body={t(syncOutcome.code === 'NETWORK_ERROR' ? 'sum.sync.offlineBody' : syncOutcome.code === 'REJECTED' ? 'sum.sync.rejectedBody' : 'sum.sync.failedBody', { message: syncOutcome.message })} action={syncOutcome.code === 'REJECTED' ? undefined : { label: t('common.tryAgain'), onPress: () => void syncNow(), loading: syncing }} testID={`sum-sync-${syncOutcome.code.toLowerCase()}`} />
        )
      ) : null}
      <View style={styles.tabs} accessibilityRole="tablist">
        {(['splits', 'laps', 'quality'] as const).map((k) => (
          <Pressable key={k} onPress={() => setTab(k)} accessibilityRole="tab" accessibilityState={{ selected: tab === k }} style={[styles.tab, tab === k && styles.tabOn]} testID={`sum-tab-${k}`}>
            <Text variant="bodySmall" tone={tab === k ? undefined : 'secondary'} style={tab === k && styles.tabOnText}>
              {t(`sum.tab.${k}` as TKey)}
            </Text>
          </Pressable>
        ))}
      </View>
      {meta.goal && meta.goal.kind !== 'free' ? (
        <Text variant="bodySmall" tone={goalMet ? 'mint' : 'secondary'} style={styles.mt} testID={`sum-goal-${goalMet ? 'met' : 'missed'}`}>
          {goalMet ? t('sum.goalMet', { target: goalLabel }) : t('sum.goalMissed', { target: goalLabel })}
        </Text>
      ) : null}
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
          <View testID="sum-quality">
            <View style={styles.qualityWrap}>
              <Chip label={t('sum.quality.accepted', { n: s.quality.accepted })} kind="synced" />
              <Chip label={t('sum.quality.rejected', { n: rejectedTotal })} kind="neutral" />
              <Chip label={t('sum.quality.gaps', { n: s.quality.gaps })} kind={s.quality.gaps ? 'devnet' : 'neutral'} />
              <Chip label={t('sum.quality.coverage', { p: Math.round(s.quality.coverageRatio * 100) })} kind="neutral" />
            </View>
            <Text variant="bodySmall" tone={s.quality.complete ? 'success' : 'warning'} style={styles.qualityVerdict} testID="sum-quality-verdict">
              {s.quality.complete ? t('sum.quality.complete') : t('sum.quality.incomplete')}
            </Text>
            <Text variant="caption" tone="muted">{t('sum.quality.explainAccepted', { m: GPS_QUALITY.acceptMaxAccuracyM })}</Text>
            <Text variant="caption" tone="muted">{t('sum.quality.explainRejected', { m: GPS_QUALITY.acceptMaxAccuracyM })}</Text>
            {rejectedTotal > 0 ? (
              <Text variant="caption" tone="muted" testID="sum-quality-reasons">
                {(Object.entries(s.quality.rejected) as [keyof typeof s.quality.rejected, number][]).filter(([, n]) => n > 0).map(([k, n]) => `${t(`sum.quality.reason.${k}` as TKey)} ${n}`).join(' · ')}
              </Text>
            ) : null}
            <Text variant="caption" tone="muted">{t('sum.quality.explainGaps')}</Text>
            <Text variant="caption" tone="muted">{t('sum.quality.explainCoverage')}</Text>
            <Text variant="label" tone="muted" uppercase style={styles.qualityVerdict}>{t('rec.integrity.title')}</Text>
            {integrity && integrity.flags.length > 0 ? (
              <View testID="sum-integrity">
                {integrity.flags.map((f) => (
                  <Text key={f} variant="bodySmall" tone="warning">
                    {f === 'mock_location' ? t('rec.integrity.mock_location', { n: integrity.mockPoints }) : f === 'sustained_speed' ? t('rec.integrity.sustained_speed', { n: integrity.sustainedSpeedEpisodes }) : f === 'gap_teleport' ? t('rec.integrity.gap_teleport', { n: integrity.gapTeleports }) : f === 'clock_drift' ? t('rec.integrity.clock_drift', { s: Math.round(integrity.clockDriftMs / 1000) }) : t('rec.integrity.motion_mismatch', { n: integrity.motionProbes.total, m: integrity.motionProbes.mismatched })}
                  </Text>
                ))}
              </View>
            ) : integrity ? (
              <Text variant="caption" tone="success" testID="sum-integrity-ok">{t('rec.integrity.ok')}</Text>
            ) : null}
            {integrity && integrity.motionProbes.total > 0 ? <Text variant="caption" tone="muted">{t('rec.integrity.probes', { n: integrity.motionProbes.total, m: integrity.motionProbes.mismatched })}</Text> : null}
          </View>
        )}
      </Surface>
      {/* PG-U-03：同類個人回顧（同 sport／環境／來源等級；不足 3 筆不生成百分比）＋分享預覽（預設無座標／精確時間／錢包） */}
      {cmp ? (
        <Surface style={styles.card} testID="sum-compare">
          <Text variant="title">{t('sum.compare.title')}</Text>
          <Text variant="bodySmall" tone="secondary">
            {t('sum.compare.body', { n: cmp.count, km: (Number(cmp.avgDistanceMm) / 1_000_000).toFixed(2), pace: cmp.avgPaceSPerKm === null ? '—' : formatPace(cmp.avgPaceSPerKm) })}
          </Text>
          {cmp.paceDeltaPct !== null ? (
            <Text variant="bodySmall" tone={cmp.paceDeltaPct >= 0 ? 'mint' : 'secondary'} testID="sum-compare-pace">
              {cmp.paceDeltaPct >= 0 ? t('sum.compare.faster', { p: cmp.paceDeltaPct }) : t('sum.compare.slower', { p: -cmp.paceDeltaPct })}
            </Text>
          ) : null}
        </Surface>
      ) : peersLoaded ? (
        <Text variant="caption" tone="muted" style={styles.mt} testID="sum-compare-none">
          {t('sum.compare.none')}
        </Text>
      ) : null}
      <Surface style={styles.card} testID="sum-share">
        <Text variant="title">{t('sum.share.title')}</Text>
        <Text variant="caption" tone="muted">
          {t('sum.share.note')}
        </Text>
        {(['mode', 'pace', 'splits', 'goal', 'quality', 'date'] as const).map((f) => (
          <View key={f} style={styles.rowBetween}>
            <Text variant="bodySmall">{t(`sum.share.${f}` as TKey)}</Text>
            <Switch value={shareFields[f]} onValueChange={(v) => setShareFields({ ...shareFields, [f]: v })} trackColor={{ true: color.mint, false: color.borderSubtle }} thumbColor={color.textPrimary} accessibilityLabel={t(`sum.share.${f}` as TKey)} testID={`sum-share-${f}`} />
          </View>
        ))}
        <Text variant="bodySmall" tone="secondary" style={styles.mt} testID="sum-share-preview">
          {sharePreview}
        </Text>
        <Button label={t('sum.share.button')} variant="secondary" style={styles.mt} onPress={() => void Share.share({ message: sharePreview }).catch(() => {})} testID="sum-share-button" />
      </Surface>
      <Button label={t('sum.done')} style={styles.mt} onPress={() => navigation.navigate('Workouts')} testID="sum-done" />
      {params.celebrate ? <WorkoutActionFeedback key={params.sessionId} mode={modeOfIntent(meta.sport, meta.intent) ?? (meta.sport === 'run' ? 'run' : 'walk')} action="finish" /> : null}
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
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.xs, minHeight: 44 },
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
  qualityVerdict: { marginTop: space.s, marginBottom: space.xxs },
  routeHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.xs },
  routeHint: { marginTop: space.xs },
  layerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs },
  layerChip: { minHeight: 36, paddingHorizontal: space.s, borderRadius: radius.l, borderWidth: 1, borderColor: color.borderSubtle, alignItems: 'center', justifyContent: 'center', backgroundColor: color.surface },
  layerChipOn: { backgroundColor: color.mint, borderColor: color.mint },
  layerChipOnText: { color: color.onMint },
  layerChipDisabled: { opacity: 0.6, borderStyle: 'dashed' },
  mt: { marginTop: space.m },
});
