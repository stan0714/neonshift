import { CommonActions, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Share, StyleSheet, Switch, View } from 'react-native';

import { Button, Chip, InlineState, Screen, Surface } from '@/components';
import { SignInState } from '@/components/SignInState';
import { RouteTrace } from '@/components/RouteTrace';
import { isFirstWear, routeAppearanceOf } from '@/domain/appearance';
import { ShoeHero } from '@/components/ShoeHero';
import { WorkoutActionFeedback } from '@/components/WorkoutActionMotion';
import { modeOfIntent, useWorkoutPrefs } from '@/state/workoutPrefsStore';
import type { Lap, RawPoint } from '@/domain/gps/engine';
import { GPS_QUALITY } from '@/domain/gps/thresholds';
import { estimateEnergy } from '@/domain/energy';
import { formatDuration, formatKm, formatPace, modeLabel } from '@/domain/workouts';
import { useBody } from '@/state/bodyStore';
import { stageName } from '@/domain/collectibles';
import { useT, type TKey } from '@/i18n';
import { compareSameCategory, SHARE_CARD_DEFAULT, shareCard, type ShareCardFields } from '@/domain/review';
import { apiClient, type WorkoutSummary } from '@/services/api/ApiClient';
import type { RootParamList } from '@/navigation/types';
import { LocalWorkoutStore, type SessionMeta } from '@/services/workouts/LocalWorkoutStore';
import { goalReached, workoutRecorder, type SyncOutcome } from '@/services/workouts/WorkoutRecorder';
import { workoutOutbox } from '@/services/workouts/WorkoutOutbox';
import { useWalletStore } from '@/state/walletStore';
import { color, radius, space, Text } from '@/theme';

const store = new LocalWorkoutStore();

/** 摘要頁（Style 23）：距離／elapsed／平均配速或速度／最高 5 秒速度／活動 kcal（無裝置值 —）；分頁 Splits／Laps／品質；路線不顯示（地圖供應商未定） */
/**
 * 結束運動後離開摘要：重設為「首頁 → 運動紀錄」。
 * 直接 navigate 會把已作廢的開始頁與摘要頁留在下面，返回鍵會倒退到準備畫面，看起來像卡住。
 */
const toWorkoutsFromHome = CommonActions.reset({ index: 1, routes: [{ name: 'Main' }, { name: 'Workouts' }] });

export function WorkoutSummaryScreen() {
  const { t } = useT();
  const navigation = useNavigation();
  const { params } = useRoute<RouteProp<RootParamList, 'WorkoutSummary'>>();
  const [meta, setMeta] = useState<SessionMeta | null>(() => store.readMeta(params.sessionId));
  const [tab, setTab] = useState<'splits' | 'laps' | 'quality'>('splits');
  const [syncing, setSyncing] = useState(false);
  const [syncOutcome, setSyncOutcome] = useState<SyncOutcome | null>(null);

  // 剛跑完是由記錄頁 replace 進來的：上一頁是已作廢的準備畫面，返回鍵會把人往回帶（所以預設隱藏）。
  // 從運動紀錄／Activity 點進來看舊紀錄時，上一頁是真的，返回鍵要出現，否則只能靠底下的按鈕離開。
  useEffect(() => {
    const st = navigation.getState();
    const prev = st?.routes[st.routes.length - 2]?.name;
    navigation.setOptions({ headerBackVisible: prev !== undefined && prev !== 'WorkoutStart' && prev !== 'WorkoutRecord' });
  }, [navigation]);

  const reload = useCallback(() => setMeta(store.readMeta(params.sessionId)), [params.sessionId]);
  useEffect(reload, [reload]);
  // finish() 保存後即進入本頁，同步在背景進行；完成時 recorder 會 emit，這裡重讀 meta 讓「已同步」即時更新
  useEffect(() => workoutRecorder.subscribe(reload), [reload]);

  const s = meta?.summary;
  // LINK-10：第一次穿這雙（Lv.2+）完成且通過審核的運動 → 一張小紀念卡；關閉記在該紀錄上，不鑄 NFT、不加 XP
  const firstWear = !!meta && !meta.firstWearDismissed && isFirstWear(store.list(), meta.sessionId);
  const dismissFirstWear = () => { if (!meta) return; store.writeMeta({ ...meta, firstWearDismissed: true }); reload(); };
  // 軌跡預覽（預設開啟，可在此關閉並記住）：讀本機加密點，只在畫面上畫折線，不上傳
  const prefs = useWorkoutPrefs();
  const layer = routeAppearanceOf(meta?.routeAppearance).layer;
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
        { sport: meta.sport, intent: meta.intent ?? null, startedAt: new Date(meta.startedAtUtc), elapsedMs: s.elapsedMs, movingMs: s.movingMs, distanceMm: s.distanceMm, avgPaceSPerKm: s.movingAvgPaceSPerKm ?? s.avgPaceSPerKm, avgSpeedKmh: s.movingAvgSpeedKmh ?? s.avgSpeedKmh, maxSpeed5sKmh: s.maxSpeed5sKmh, splits: s.splits.map((x) => ({ index: x.index, paceSPerKm: x.paceSPerKm, isPartial: x.isPartial })), lapCount: s.laps.length, goal: meta.goal ?? null, goalMet: !!meta.goal && goalReached(meta.goal, s.movingMs, s.distanceMm), qualityAccepted: s.quality.accepted, qualityRejected: Object.values(s.quality.rejected).reduce((a, b) => a + b, 0), autoPausedMs },
        shareFields,
        (k, p) => t(k as TKey, p),
        { mode: modeLabel(t, meta.sport, meta.intent), app: 'NeonShift', site: 'neonshift.cc' },
      )
    : '';
  // PG-U-01：目標結果（未達標仍保存，顯示實際完成）；模式標籤
  // review 2：時間目標以運動時間判定（goal v2）；舊紀錄（v1）也改用運動時間呈現，與記錄頁一致
  const goalMet = !!meta?.goal && !!s && goalReached(meta.goal, s.movingMs, s.distanceMm);
  const goalLabel = meta?.goal ? (meta.goal.kind === 'time' ? t('rec.goal.min', { n: Math.round(meta.goal.target / 60) }) : t('rec.goal.km', { n: meta.goal.target / 1_000_000 })) : '';
  if (!meta || !s) return <Screen testID="workout-summary-screen"><InlineState kind="error" title={t('common.somethingInterrupted')} /></Screen>;
  const isWalk = meta.sport === 'walk';
  // PG-R-11：App 內記錄沒有裝置熱量；有體重（只存手機）才顯示估算，否則 — 並提示到 Profile 填
  const weightKg = useBody((b) => b.weightKg);
  const energy = estimateEnergy({ sport: meta.sport, weightKg, movingMs: s.movingMs, distanceMm: s.distanceMm, segments: s.splits.filter((l) => !l.isPartial).map((l) => ({ distanceMm: l.distanceMm, durationMs: l.durationMs })) });
  // PG-LINK-02：「立即同步」是一次授權，走同一條由舊到新的佇列；較早紀錄卡住時本筆回 BLOCKED_EARLIER
  const syncNow = async () => {
    setSyncing(true);
    try {
      const owner = useWalletStore.getState().session?.address ?? null;
      if (!owner) { setSyncOutcome({ ok: false, code: 'NO_SESSION', message: 'wallet not connected' }); return; }
      if (!meta.owner) await workoutOutbox.assign([meta.sessionId], owner); // 訪客紀錄：本人按下同步即歸屬到目前錢包
      const r = await workoutOutbox.run(owner, { manual: true, target: meta.sessionId });
      setSyncOutcome(r.target ?? { ok: false, code: 'UNKNOWN', message: 'not processed' });
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
      <Text variant="heading1" style={styles.mt}>{t('sum.flow.title')}</Text>
      {(meta.unsavedPoints ?? 0) > 0 ? (
        <InlineState kind="warning" title={t('sum.unsaved.title')} body={t('sum.unsaved.body', { n: meta.unsavedPoints ?? 0 })} testID="sum-unsaved" />
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
          <InlineState kind={syncOutcome.code === 'NETWORK_ERROR' || syncOutcome.code === 'BLOCKED_EARLIER' ? 'warning' : 'error'} title={t(syncOutcome.code === 'NETWORK_ERROR' ? 'sum.sync.offlineTitle' : syncOutcome.code === 'REJECTED' ? 'sum.sync.rejectedTitle' : syncOutcome.code === 'BLOCKED_EARLIER' ? 'sync.blockedEarlier' : 'sum.sync.failedTitle')} body={syncOutcome.code === 'BLOCKED_EARLIER' ? t('sync.blockedEarlierBody', { message: syncOutcome.message }) : t(syncOutcome.code === 'NETWORK_ERROR' ? 'sum.sync.offlineBody' : syncOutcome.code === 'REJECTED' ? 'sum.sync.rejectedBody' : 'sum.sync.failedBody', { message: syncOutcome.message })} action={syncOutcome.code === 'REJECTED' ? undefined : syncOutcome.code === 'BLOCKED_EARLIER' ? { label: t('sync.openQueue'), onPress: () => navigation.dispatch(toWorkoutsFromHome) } : { label: t('common.tryAgain'), onPress: () => void syncNow(), loading: syncing }} testID={`sum-sync-${syncOutcome.code.toLowerCase()}`} />
        )
      ) : null}

      <View style={styles.hero}>
        <Text variant="displayL" numeric testID="sum-distance">
          {formatKm(String(s.distanceMm))}
        </Text>
        <Text variant="caption" tone="muted">
          {modeLabel(t, meta.sport, meta.intent)} · {new Date(meta.startedAtUtc).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>
      <Button label={t('sum.done')} style={styles.mt} onPress={() => navigation.dispatch(toWorkoutsFromHome)} testID="sum-done" />
      <View style={styles.grid}>
        <Stat label={t('sum.elapsed')} value={formatDuration(String(s.elapsedMs))} />
        <Stat label={t('sum.moving')} value={formatDuration(String(s.movingMs))} />
        <Stat label={t('sum.pausedStat')} value={s.pausedMs > 0 ? `${formatDuration(String(s.pausedMs))}${autoPausedMs > 0 ? ` (${t('sum.autoPausedShort', { t: formatDuration(String(autoPausedMs)) })})` : ''}` : '—'} />
        {/* review 1：主數字＝運動平均（不含暫停），與記錄頁一致；有暫停時另列「全程（含暫停）」，即後端的 avg_pace */}
        <Stat label={`${isWalk ? t('sum.avgSpeed') : t('sum.avgPace')} · ${t('sum.avgMovingHint')}`} value={isWalk ? ((s.movingAvgSpeedKmh ?? s.avgSpeedKmh) === null ? '—' : `${(s.movingAvgSpeedKmh ?? s.avgSpeedKmh)!.toFixed(1)} km/h`) : formatPace(s.movingAvgPaceSPerKm ?? s.avgPaceSPerKm)} testID="sum-avg" hint={s.pausedMs > 0 ? t('sum.avgOverall', { v: isWalk ? (s.avgSpeedKmh === null ? '—' : `${s.avgSpeedKmh.toFixed(1)} km/h`) : formatPace(s.avgPaceSPerKm) }) : undefined} />
        <Stat label={t('sum.max5s')} value={s.maxSpeed5sKmh === null ? '—' : `${s.maxSpeed5sKmh.toFixed(1)} km/h`} />
        <Stat label={energy ? t('sum.kcalEstimated') : t('sum.kcal')} value={energy ? `≈${energy.activeKcal}` : '—'} testID="sum-kcal" />
        {/* PG-LINK-01：當時跑鞋（開始時快照；未綁定玩家／舊紀錄＝未指定） */}
        <Stat label={t('sum.shoe')} value={meta.shoeSnapshot ? `Lv.${meta.shoeSnapshot.level} · ${stageName(t, meta.shoeSnapshot.level)}` : t('sum.shoeUnknown')} testID="sum-shoe" />
      </View>
      {!energy && weightKg === null ? (
        <Pressable onPress={() => navigation.navigate('Main', { screen: 'Profile' })} accessibilityRole="link" style={styles.kcalHint} testID="sum-kcal-hint">
          <Text variant="caption" tone="secondary">{t('sum.kcalHint')} </Text>
          <Text variant="caption" tone="cyan">{t('sum.kcalHintLink')}</Text>
        </Pressable>
      ) : null}
      {firstWear && meta.shoeSnapshot ? (
        <Surface active style={styles.card} testID="sum-first-wear">
          <View style={styles.firstWearRow}>
            <ShoeHero level={meta.shoeSnapshot.level} size={64} badge={false} active={false} />
            <View style={styles.flex}>
              <Text variant="title">{t('sum.firstWear.title', { shoe: stageName(t, meta.shoeSnapshot.level) })}</Text>
              <Text variant="caption" tone="secondary" style={styles.mtXs}>{t('sum.firstWear.body')}</Text>
            </View>
            <Pressable onPress={dismissFirstWear} accessibilityRole="button" accessibilityLabel={t('common.close')} hitSlop={8} style={styles.closeBtn} testID="sum-first-wear-close">
              <Text variant="label" tone="secondary">✕</Text>
            </Pressable>
          </View>
        </Surface>
      ) : null}
      {meta.environment !== 'indoor' ? (
        <Surface style={styles.card} testID="sum-route">
          <View style={styles.routeHead}>
            <Text variant="title">{t('sum.route')}</Text>
            <Switch value={prefs.showRoute} onValueChange={(v) => void prefs.set({ showRoute: v })} trackColor={{ true: color.mint, false: color.borderSubtle }} thumbColor={color.textPrimary} accessibilityLabel={t('sum.routeToggle')} testID="sum-route-toggle" />
          </View>
          {prefs.showRoute ? <RouteTrace points={points ?? []} layer={layer} /> : null}
          <Text variant="caption" tone="mint" testID="sum-route-locked">{t('route.saved', { layer: t(`sum.layer.${layer}` as TKey) })}</Text>
          {!meta.routeAppearance ? <Text variant="caption" tone="muted">{t('route.legacy')}</Text> : null}
          <Text variant="caption" tone="muted" style={styles.routeHint}>
            {t('sum.routeHint')}
          </Text>
        </Surface>
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
      {params.celebrate ? <WorkoutActionFeedback key={params.sessionId} mode={modeOfIntent(meta.sport, meta.intent) ?? (meta.sport === 'run' ? 'run' : 'walk')} action="finish" /> : null}
    </Screen>
  );
}

function Stat({ label, value, hint, testID }: { label: string; value: string; hint?: string; testID?: string }) {
  return (
    <View style={styles.stat} testID={testID}>
      <Text variant="heading2" numeric testID={testID ? `${testID}-value` : undefined}>
        {value}
      </Text>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      {hint ? (
        <Text variant="caption" tone="muted" numeric testID={testID ? `${testID}-hint` : undefined}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  firstWearRow: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  closeBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  mtXs: { marginTop: space.xxs },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.xs, minHeight: 44 },
  hero: { alignItems: 'center', marginTop: space.m },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: space.m, gap: space.s },
  kcalHint: { flexDirection: 'row', flexWrap: 'wrap', marginTop: space.xs, minHeight: 32, alignItems: 'center' },
  stat: { flexBasis: '43%', flexGrow: 1, minWidth: 0, padding: space.m, borderRadius: radius.m, backgroundColor: color.elevated },
  syncRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', marginTop: space.m, gap: space.s },
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
