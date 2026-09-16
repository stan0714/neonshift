import { Feather } from '@expo/vector-icons';
import { StackActions, useNavigation } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import * as Haptics from 'expo-haptics';
import { Alert, BackHandler, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Chip, Screen } from '@/components';
import { RouteTrace } from '@/components/RouteTrace';
import { SpeedSparkline } from '@/components/SpeedSparkline';
import { WorkoutActionFeedback, type WorkoutAction } from '@/components/WorkoutActionMotion';
import { paceVsAvg, profileOf, speedZone } from '@/domain/modes';
import { formatDuration, formatPace } from '@/domain/workouts';
import { useT, type TKey } from '@/i18n';
import { workoutCues } from '@/services/workouts/WorkoutCues';
import { workoutRecorder } from '@/services/workouts/WorkoutRecorder';
import { modeOfIntent, useWorkoutPrefs } from '@/state/workoutPrefsStore';
import { color, layout, radius, space, Text } from '@/theme';
import { useRecorder } from './useRecorder';

/**
 * 記錄頁（Style 23）：走路主顯示 km/h、跑步主顯示 min/km；時間／距離次要；GPS 與暫停狀態始終可見；
 * Lap／Pause ≥ 48dp；Finish 只在暫停頁並需確認。動作切換播放短暫回饋，穩定記錄中不做循環裝飾動畫。
 */
export function WorkoutRecordScreen() {
  const { t, locale } = useT();
  const navigation = useNavigation();
  const s = useRecorder();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ action: WorkoutAction; id: number } | null>(null);
  const previousState = useRef(s.state);
  // 暫停／繼續：播一次模式專屬回饋（Style 23.4）；震動提示開啟時附一次輕震動
  useEffect(() => {
    const next: WorkoutAction | null = previousState.current === 'recording' && s.state === 'paused' ? 'pause' : previousState.current === 'paused' && s.state === 'recording' ? 'resume' : null;
    previousState.current = s.state;
    if (!next) return;
    setFeedback((f) => ({ action: next, id: (f?.id ?? 0) + 1 }));
    if (useWorkoutPrefs.getState().haptic) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, [s.state]);
  const [lapNote, setLapNote] = useState<{ text: string; tone: 'cyan' | 'warning' } | null>(null);
  const [goalNotified, setGoalNotified] = useState(false);

  useEffect(() => {
    // PG-U-01：達標只提醒一次（震動＋文字），不自動停止；結束仍需確認
    if (s.goalReached && !goalNotified) {
      setGoalNotified(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
  }, [s.goalReached, goalNotified]);

  // PG-U-02：操作鎖（明確長按解鎖；不阻擋系統返回——返回後記錄仍由前景服務持續，可自 Workouts 清單回來）
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    // 記錄中未鎖定時攔返回鍵（避免誤觸）；鎖定時放行系統返回（緊急操作不可被阻擋）
    const sub = BackHandler.addEventListener('hardwareBackPress', () => !locked && (s.state === 'recording' || s.state === 'paused'));
    return () => sub.remove();
  }, [s.state, locked]);

  // PG-U-02：距離間隔（500 m／1 km／目標一半）與自訂圈語音或震動提示（預設關閉；背景可播，不補播）
  const prefs = useWorkoutPrefs();
  useEffect(() => { workoutCues.reset(workoutRecorder.snapshot(), { voice: prefs.voice, haptic: prefs.haptic, locale: locale === 'zh-TW' ? 'zh-TW' : 'en', cueEvery: prefs.cueEvery }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { workoutCues.onSnapshot(s, { voice: prefs.voice, haptic: prefs.haptic, locale: locale === 'zh-TW' ? 'zh-TW' : 'en', cueEvery: prefs.cueEvery }); }, [s, prefs.voice, prefs.haptic, prefs.cueEvery, locale]);

  // 模式樣態（Style 24.6）：走路主數字＝運動時間、健走＝km/h＋建議區間、跑步＝配速＋與平均比較
  const mode = modeOfIntent(s.sport, s.intent) ?? (s.sport === 'run' ? 'run' : 'walk');
  const profile = profileOf(mode);
  const speedKmh = s.currentSpeedMs === null ? null : s.currentSpeedMs * 3.6;
  const speedText = speedKmh === null ? '—' : speedKmh.toFixed(1);
  const paceText = formatPace(s.currentPaceSPerKm).replace(' /km', '');
  const primary = s.state === 'paused' ? '—' : profile.primary === 'time' ? formatDuration(String(s.movingMs)) : profile.primary === 'speed' ? speedText : paceText;
  const primaryLabel = s.state === 'paused' ? t('rec.paused') : profile.primary === 'time' ? t('rec.movingTime') : profile.primary === 'speed' ? t('rec.speed') : t('rec.pace');
  const zone = s.state === 'recording' ? speedZone(profile, speedKmh) : null;
  // 平均：距離／運動時間（不含暫停）；不足 50 m 或 10 s 顯示 —
  const avgPace = s.distanceMm >= 50_000 && s.movingMs >= 10_000 ? Math.round(s.movingMs / 1000 / (s.distanceMm / 1_000_000)) : null;
  const speedOf = (sPerKm: number | null) => (sPerKm === null || sPerKm <= 0 ? '—' : (3600 / sPerKm).toFixed(1));
  const avg = s.sport === 'walk' ? speedOf(avgPace) : formatPace(avgPace).replace(' /km', '');
  const vsAvg = profile.primary === 'pace' && s.state === 'recording' && s.gps !== 'searching' ? paceVsAvg(s.currentPaceSPerKm, avgPace) : null;
  // 最近一段：最新完成的分段或圈（手動／自動）
  const last = [...s.splits, ...s.laps].filter((l) => !l.isPartial).sort((x, y) => y.endElapsedMs - x.endElapsedMs)[0] ?? null;
  const recent = [...s.splits, ...s.laps].filter((l) => !l.isPartial).sort((x, y) => y.endElapsedMs - x.endElapsedMs).slice(0, 5);
  const startedAt = new Date(Date.now() - s.elapsedMs).toLocaleTimeString(locale === 'zh-TW' ? 'zh-TW' : 'en', { hour: '2-digit', minute: '2-digit' });
  const goalRatio = s.goal && s.goal.kind !== 'free' && s.goal.target > 0 ? Math.min(1, s.goal.kind === 'time' ? s.elapsedMs / (s.goal.target * 1000) : s.distanceMm / s.goal.target) : 0;
  /** 計圈：距離為 0 時引擎不建圈，但按鈕必須有回應——說明原因並輕震；成功則顯示第 N 圈＋配速 */
  const onLap = async () => {
    const l = await workoutRecorder.lap();
    if (prefs.haptic) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (!l) {
      setLapNote({ text: t('rec.lapNoDistance'), tone: 'warning' });
      return;
    }
    setLapNote({ text: `${t('rec.lapAdded', { n: l.index })} · ${(l.distanceMm / 1_000_000).toFixed(2)} km · ${s.sport === 'walk' ? `${speedOf(l.paceSPerKm)} km/h` : formatPace(l.paceSPerKm)}`, tone: 'cyan' });
  };
  const finish = () => {
    Alert.alert(t('rec.finishTitle'), t('rec.finishBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('rec.finish'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setBusy(true);
            try {
              const r = await workoutRecorder.finish();
              navigation.dispatch(StackActions.replace('WorkoutSummary', { sessionId: r.meta.sessionId, celebrate: true }));
            } finally {
              setBusy(false);
            }
          })();
        },
      },
    ]);
  };

  return (
    <Screen testID="workout-record-screen">
      <View style={styles.statusRow} accessible accessibilityLabel={`${t(`rec.gps.${s.gps}` as TKey)}, ${s.state === 'paused' ? t('rec.paused') : t('rec.recording')}`} testID="record-status">
        <Chip label={t(`rec.gps.${s.gps}` as TKey)} kind={s.gps === 'ok' ? 'synced' : s.gps === 'poor' ? 'devnet' : 'offline'} />
        <Chip label={s.state === 'paused' ? (s.pauseKind === 'auto' ? t('rec.autoPaused') : t('rec.paused')) : t('rec.recording')} kind={s.state === 'paused' ? 'devnet' : 'level'} />
        <Pressable onPress={() => setLocked(true)} onLongPress={() => setLocked(false)} delayLongPress={1200} accessibilityRole="button" accessibilityLabel={locked ? t('rec.lock.unlockA11y') : t('rec.lock.lockA11y')} hitSlop={8} style={styles.lockBtn} testID={locked ? 'record-unlock' : 'record-lock'}>
          <Text variant="label" tone={locked ? 'mint' : 'secondary'}>{locked ? t('rec.lock.locked') : t('rec.lock.lock')}</Text>
        </Pressable>
      </View>
      {s.state === 'paused' && s.pauseKind === 'auto' ? (
        <Text variant="caption" tone="warning" style={styles.center} testID="record-autopause-note">
          {t('rec.autoPaused.note')}
        </Text>
      ) : null}
      {s.integrityFlags.length > 0 ? (
        <Text variant="caption" tone="warning" style={styles.center} testID="record-integrity">
          {t('rec.integrity.live', { reason: t(`wo.reason.${s.integrityFlags[0]}` as TKey) })}
        </Text>
      ) : null}
      {s.gps === 'searching' && s.state === 'recording' ? (
        <Text variant="caption" tone="warning" style={styles.center} testID="record-gps-gap">
          {t('rec.gpsGap')}
        </Text>
      ) : null}
      {/* 中段可捲動（內容依模式與資料變多）；狀態列與控制列固定 */}
      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} showsVerticalScrollIndicator={false} testID="record-body">
      <View style={styles.hero} accessible accessibilityLabel={`${primaryLabel} ${primary === '—' ? t('rec.a11y.none') : primary} ${profile.primary === 'time' ? '' : profile.primary === 'speed' ? t('rec.a11y.kmh') : t('rec.a11y.minPerKm')}`}>
        <View style={styles.modeRow}>
          <Feather name={profile.icon} size={14} color={profile.accent} />
          <Text variant="label" tone={profile.accentTone} uppercase testID="record-mode">
            {t(`wo.mode.${mode}` as TKey)}
          </Text>
        </View>
        <Text style={styles.big} numeric testID="record-primary" maxFontSizeMultiplier={1.6}>
          {primary}
        </Text>
        <Text variant="label" tone="muted" uppercase>
          {primaryLabel}
        </Text>
        {zone ? (
          <View style={[styles.zoneChip, { borderColor: zone === 'in' ? profile.accent : color.borderSubtle }]} testID="record-zone">
            <Text variant="caption" tone={zone === 'in' ? profile.accentTone : 'secondary'}>
              {t(`rec.zone.${zone}` as TKey, { lo: profile.speedZoneKmh![0], hi: profile.speedZoneKmh![1] })}
            </Text>
          </View>
        ) : null}
        {vsAvg !== null ? (
          <View style={[styles.zoneChip, { borderColor: vsAvg <= 0 ? profile.accent : color.borderSubtle }]} testID="record-vs-avg">
            <Text variant="caption" tone={vsAvg <= 0 ? profile.accentTone : 'secondary'}>
              {vsAvg < -2 ? t('rec.vsAvg.faster', { p: -vsAvg }) : vsAvg > 2 ? t('rec.vsAvg.slower', { p: vsAvg }) : t('rec.vsAvg.same')}
            </Text>
          </View>
        ) : null}
      </View>
      {/* 四格：運動時間（不含暫停）、距離、平均、最近一段；暫停中運動時間停住、顯示已暫停多久 */}
      <View style={styles.grid}>
        <View style={[styles.tile, s.state === 'paused' && styles.tilePaused]} accessible accessibilityLabel={profile.primary === 'time' ? `${t('rec.speed')} ${speedText} ${t('rec.a11y.kmh')}` : `${t('rec.a11y.time')} ${formatDuration(String(s.movingMs))}`}>
          <Text variant="displayM" numeric testID={profile.primary === 'time' ? 'record-speed' : 'record-time'}>
            {profile.primary === 'time' ? (s.state === 'paused' ? '—' : speedText) : formatDuration(String(s.movingMs))}
          </Text>
          <Text variant="caption" tone="muted" uppercase>
            {profile.primary === 'time' ? t('rec.speed') : t('rec.movingTime')}
          </Text>
          {s.pausedMs > 0 ? (
            <Text variant="caption" tone={s.state === 'paused' ? 'warning' : 'muted'} numeric testID="record-paused">
              {s.autoPausedMs > 0 ? `${t('rec.pausedFor', { t: formatDuration(String(s.pausedMs)) })} · ${t('rec.autoPausedFor', { t: formatDuration(String(s.autoPausedMs)) })}` : t('rec.pausedFor', { t: formatDuration(String(s.pausedMs)) })}
            </Text>
          ) : null}
        </View>
        <View style={styles.tile} accessible accessibilityLabel={`${t('rec.a11y.distance')} ${(s.distanceMm / 1_000_000).toFixed(2)} ${t('rec.a11y.km')}`}>
          <Text variant="displayM" numeric testID="record-distance">
            {(s.distanceMm / 1_000_000).toFixed(2)}
          </Text>
          <Text variant="caption" tone="muted" uppercase>
            {t('rec.distance')}
          </Text>
        </View>
        <View style={styles.tile}>
          <Text variant="heading1" numeric testID="record-avg">
            {avg}
          </Text>
          <Text variant="caption" tone="muted" uppercase>
            {s.sport === 'walk' ? t('rec.avgSpeed') : t('rec.avgPace')}
          </Text>
        </View>
        <View style={styles.tile}>
          <Text variant="heading1" numeric testID="record-last">
            {last ? (s.sport === 'walk' ? speedOf(last.paceSPerKm) : formatPace(last.paceSPerKm).replace(' /km', '')) : '—'}
          </Text>
          <Text variant="caption" tone="muted" uppercase>
            {last?.kind === 'split' ? t('rec.lastSplit', { n: last.index }) : last ? t('rec.lastLap', { n: last.index }) : t('rec.lastNone')}
          </Text>
        </View>
      </View>
      {s.goal && s.goal.kind !== 'free' ? (
        <View style={styles.goal}>
          <View style={styles.goalTrack} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(goalRatio * 100) }} testID="record-goal-bar">
            <View style={[styles.goalFill, { width: `${Math.round(goalRatio * 100)}%`, backgroundColor: profile.accent }, s.goalReached && styles.goalFillDone]} />
          </View>
          <Text variant="caption" tone={s.goalReached ? 'mint' : 'muted'} style={styles.center} testID="record-goal">
            {s.goalReached ? t('rec.goalReached') : t('rec.goalProgress', { target: s.goal.kind === 'time' ? t('rec.goal.min', { n: Math.round(s.goal.target / 60) }) : t('rec.goal.km', { n: s.goal.target / 1_000_000 }) })}
          </Text>
        </View>
      ) : null}
      {/* 最近分段／圈（最多 5 筆，新到舊）；沒有時提示自動分段規則 */}
      <View style={styles.splits} testID="record-splits">
        <View style={styles.splitsHead}>
          <Text variant="label" tone="muted" uppercase>
            {t('rec.splitsTitle')}
          </Text>
          <Text variant="caption" tone="muted">
            {t(`wo.mode.${mode}` as TKey)} · {t('rec.startedAt', { time: startedAt })}
          </Text>
        </View>
        {recent.length === 0 ? (
          <Text variant="caption" tone="muted">
            {t('rec.splitsEmpty')}
          </Text>
        ) : (
          recent.map((l) => (
            <View key={`${l.kind}-${l.index}`} style={styles.splitRow}>
              <Text variant="bodySmall" tone="secondary" style={styles.splitName}>
                {l.kind === 'split' ? t('rec.lastSplit', { n: l.index }) : t('rec.lastLap', { n: l.index })}
              </Text>
              <Text variant="bodySmall" numeric style={styles.splitCell}>
                {(l.distanceMm / 1_000_000).toFixed(2)} km
              </Text>
              <Text variant="bodySmall" numeric style={styles.splitCell}>
                {formatDuration(String(l.durationMs))}
              </Text>
              <Text variant="bodySmall" numeric tone={l.uncertain ? 'warning' : 'primary'} style={styles.splitCell}>
                {s.sport === 'walk' ? `${speedOf(l.paceSPerKm)} km/h` : formatPace(l.paceSPerKm)}
              </Text>
            </View>
          ))
        )}
      </View>
      {s.trackEquivalent ? (
        <View style={styles.track} testID="record-track">
          <Text variant="title" numeric testID="record-track-laps">
            {t('rec.trackLive', { laps: s.trackEquivalent.laps, rem: Math.round(s.trackEquivalent.remainderMm / 1000) })}
          </Text>
          <Text variant="caption" tone="muted">
            {t('rec.trackLiveHint', { len: s.trackEquivalent.lapMm / 1000 })}
          </Text>
        </View>
      ) : null}
      {lapNote ? (
        <Text variant="bodySmall" tone={lapNote.tone} style={styles.center} testID="record-lap-note">
          {lapNote.text}
        </Text>
      ) : null}
      {/* 即時軌跡＋速度曲線（Style 23.6）：只用記憶體內最近接受點與 5 秒窗樣本，不讀磁碟 */}
      {s.path.length >= 2 ? <RouteTrace points={s.path} height={150} layer={prefs.traceLayer} testID="record-trace" /> : null}
      <View style={styles.sparkHead}>
        <Text variant="label" tone="muted" uppercase>{s.sport === 'walk' ? t('rec.spark.speed') : t('rec.spark.pace')}</Text>
        <Text variant="caption" tone="muted" numeric>
          {s.lastAccuracyM !== null && s.state === 'recording' ? `${t('rec.gpsAccuracy', { m: Math.round(s.lastAccuracyM) })} · ` : ''}{t('rec.totalTime', { t: formatDuration(String(s.elapsedMs)) })}
        </Text>
      </View>
      <SpeedSparkline samples={s.speedSamples} sport={s.sport} accent={profile.accent} />
      </ScrollView>
      <View style={styles.controls}>
        {locked ? (
          <Pressable onLongPress={() => setLocked(false)} delayLongPress={1200} accessibilityRole="button" accessibilityLabel={t('rec.lock.unlockA11y')} style={[styles.ctl, styles.ctlSecondary, styles.ctlWide]} testID="record-locked">
            <Text variant="title">{t('rec.lock.holdToUnlock')}</Text>
          </Pressable>
        ) : s.state === 'recording' ? (
          <>
            <Pressable onPress={() => void onLap()} accessibilityRole="button" accessibilityLabel={t('rec.lap')} style={({ pressed }) => [styles.ctl, styles.ctlSecondary, pressed && styles.ctlPressed]} testID="record-lap">
              <Text variant="title">{t('rec.lap')}</Text>
            </Pressable>
            <Pressable onPress={() => void workoutRecorder.pause()} accessibilityRole="button" accessibilityLabel={t('rec.pause')} style={[styles.ctl, styles.ctlPrimary]} testID="record-pause">
              <Text variant="title" style={styles.onMint}>
                {t('rec.pause')}
              </Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable onPress={finish} disabled={busy} accessibilityRole="button" accessibilityLabel={t('rec.finish')} style={[styles.ctl, styles.ctlDanger]} testID="record-finish">
              <Text variant="title" tone="danger">
                {busy ? t('rec.finishing') : t('rec.finish')}
              </Text>
            </Pressable>
            <Pressable onPress={() => void workoutRecorder.resume()} disabled={busy} accessibilityRole="button" accessibilityLabel={t('rec.resume')} style={[styles.ctl, styles.ctlPrimary]} testID="record-resume">
              <Text variant="title" style={styles.onMint}>
                {t('rec.resume')}
              </Text>
            </Pressable>
          </>
        )}
      </View>
      {feedback ? <WorkoutActionFeedback key={feedback.id} mode={mode} action={feedback.action} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  track: { alignItems: 'center', marginTop: space.s },
  splits: { marginTop: space.m, padding: space.s, borderRadius: radius.m, backgroundColor: color.surface, borderWidth: 1, borderColor: color.borderSubtle },
  splitsHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.xxs },
  splitRow: { flexDirection: 'row', alignItems: 'center', minHeight: 32 },
  splitName: { flex: 1.2 },
  splitCell: { flex: 1, textAlign: 'right' },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space.s },
  hero: { alignItems: 'center', marginTop: space.l },
  modeRow: { flexDirection: 'row', alignItems: 'center', gap: space.xxs, marginBottom: space.xxs },
  zoneChip: { marginTop: space.xs, paddingHorizontal: space.s, minHeight: 28, justifyContent: 'center', borderRadius: radius.l, borderWidth: 1, backgroundColor: color.surface },
  big: { fontSize: 88, lineHeight: 96, fontWeight: '700', color: color.textPrimary, fontVariant: ['tabular-nums'] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s, marginTop: space.xl },
  tile: { width: '48%', flexGrow: 1, minHeight: 88, alignItems: 'center', justifyContent: 'center', paddingVertical: space.s, borderRadius: radius.m, backgroundColor: color.elevated },
  tilePaused: { borderWidth: 1, borderColor: color.warning },
  goal: { marginTop: space.m },
  goalTrack: { height: 6, borderRadius: 3, backgroundColor: color.elevated, overflow: 'hidden' },
  goalFill: { height: 6, backgroundColor: color.cyan },
  goalFillDone: { backgroundColor: color.mint },
  center: { textAlign: 'center', marginTop: space.xs },
  lockBtn: { marginLeft: 'auto', minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center' },
  ctlWide: { flex: 1 },
  body: { flex: 1, marginTop: space.xs },
  bodyContent: { paddingBottom: space.m },
  controls: { flexDirection: 'row', gap: space.m, marginTop: space.s, marginBottom: space.l },
  ctl: { flex: 1, minHeight: 64, borderRadius: radius.l, alignItems: 'center', justifyContent: 'center', minWidth: layout.minTouchTarget },
  ctlPrimary: { backgroundColor: color.mint },
  ctlPressed: { opacity: 0.7 },
  sparkHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space.m, marginBottom: space.xxs },
  ctlSecondary: { borderWidth: 1, borderColor: color.borderSubtle, backgroundColor: color.surface },
  ctlDanger: { borderWidth: 1, borderColor: color.danger, backgroundColor: color.surface },
  onMint: { color: color.onMint },
});
