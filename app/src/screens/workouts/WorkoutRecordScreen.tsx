import { ensureWorkoutChannel, setWorkoutReturnTarget, type WorkoutChannelState } from '@/services/workouts/notificationChannel';
import { Feather } from '@expo/vector-icons';
import { StackActions, useNavigation } from '@react-navigation/native';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { LinearGradient } from 'expo-linear-gradient';
import { Alert, Animated, AppState, BackHandler, Easing, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Chip, InlineState, Screen } from '@/components';
import { RouteTrace } from '@/components/RouteTrace';
import { SpeedSparkline } from '@/components/SpeedSparkline';
import { routeAppearanceOf } from '@/domain/appearance';
import { WorkoutActionFeedback, type WorkoutAction } from '@/components/WorkoutActionMotion';
import { paceVsAvg, profileOf, speedZone } from '@/domain/modes';
import { formatDuration, formatPace } from '@/domain/workouts';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { useT, type TKey } from '@/i18n';
import { workoutRecorder } from '@/services/workouts/WorkoutRecorder';
import { modeOfIntent, useWorkoutPrefs } from '@/state/workoutPrefsStore';
import { color, layout, radius, space, Text } from '@/theme';
import { useRecorder } from './useRecorder';
import { apiErrorText } from '@/services/api/errorText';

/**
 * 記錄頁（Style 23）：走路主顯示 km/h、跑步主顯示 min/km；時間／距離次要；GPS 與暫停狀態始終可見；
 * Lap／Pause ≥ 48dp；Finish 只在暫停頁並需確認。動作切換播放短暫回饋，穩定記錄中不做循環裝飾動畫。
 *
 * 2026-09-19 第二輪 review：
 * - 精簡／詳細兩種顯示（review 9）：預設只留配速、距離、運動時間、暫停／計圈；分段表、軌跡、速度曲線、配速比較與定位診斷只在詳細模式；GPS 有問題時診斷列自動出現。
 * - 配速過期（review 3）顯示「—」與「定位恢復中」，距離不動。
 * - 儲存異常（review 5）：storage.failing 時顯示「正在重試（N 點待存）」；finish 寫入失敗停在本頁並可重試。
 * - 語音／震動提示改由 cueController 以 session 驅動（review 7），本頁不再負責。
 * - 螢幕常亮遵守偏好且暫停中允許休眠；達標震動遵守震動偏好（review 10）。
 */
export function WorkoutRecordScreen() {
  const { t, locale } = useT();
  const [notificationState, setNotificationState] = useState<WorkoutChannelState | null>(null);
  useEffect(() => {
    const check = () => {
      setNotificationState(ensureWorkoutChannel({ name: t('rec.notif.channelName'), description: t('rec.notif.channelDesc') }));
      setWorkoutReturnTarget();
    };
    check();
    const delayed = setTimeout(check, 1000);
    const sub = AppState.addEventListener('change', state => { if (state === 'active') check(); });
    return () => { clearTimeout(delayed); sub.remove(); };
  // Translation callback is recreated per render; only locale changes require a refresh.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);
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
      if (useWorkoutPrefs.getState().haptic) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
  }, [s.goalReached, goalNotified]);

  // PG-U-02：操作鎖（明確長按解鎖；不阻擋系統返回——返回後記錄仍由前景服務持續，可自 Workouts 清單回來）
  const [locked, setLocked] = useState(false);
  // review 10：常亮遵守偏好；只在 recording 時常亮，暫停中允許休眠省電；離開畫面解除
  const keepAwakePref = useWorkoutPrefs((p) => p.keepAwake);
  useEffect(() => {
    const tag = 'workout-record';
    if (keepAwakePref && s.state === 'recording') {
      void activateKeepAwakeAsync(tag).catch(() => {});
      return () => { void deactivateKeepAwake(tag).catch(() => {}); };
    }
    return undefined;
  }, [keepAwakePref, s.state]);
  useEffect(() => {
    // 記錄中未鎖定時攔返回鍵（避免誤觸）；鎖定時放行系統返回（緊急操作不可被阻擋）
    const sub = BackHandler.addEventListener('hardwareBackPress', () => !locked && (s.state === 'recording' || s.state === 'paused'));
    return () => sub.remove();
  }, [s.state, locked]);

  // PG-U-02 的距離提示改由 services/workouts/cueController 以 session 驅動（review 7），離開本頁仍會播、返回不重設基準
  const prefs = useWorkoutPrefs();
  const traceLayer = useMemo(() => routeAppearanceOf(s.sessionId ? workoutRecorder.localStore().readMeta(s.sessionId)?.routeAppearance : null).layer, [s.sessionId]);
  const detail = prefs.detailView;
  // GPS 有問題時即使精簡模式也把診斷列展開（review 9）
  const showDiag = detail || !!s.gpsIssue || s.gps !== 'ok' || s.paceStale || s.gpsRestarts > 0 || s.gpsFallback;
  const [finishFailed, setFinishFailed] = useState<string | null>(null);

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
  const onFire = vsAvg !== null && vsAvg < -2 && s.gps === 'ok';
  // 最近一段：最新完成的分段或圈（手動／自動）
  const last = [...s.splits, ...s.laps].filter((l) => !l.isPartial).sort((x, y) => y.endElapsedMs - x.endElapsedMs)[0] ?? null;
  const recent = [...s.splits, ...s.laps].filter((l) => !l.isPartial).sort((x, y) => y.endElapsedMs - x.endElapsedMs).slice(0, 5);
  const startedAt = new Date(Date.now() - s.elapsedMs).toLocaleTimeString(locale === 'zh-TW' ? 'zh-TW' : 'en', { hour: '2-digit', minute: '2-digit' });
  // review 2：時間目標以運動時間（不含暫停）計，與主時間一致
  const goalCompletion = s.goal && s.goal.kind !== 'free' && s.goal.target > 0 ? (s.goal.kind === 'time' ? s.movingMs / (s.goal.target * 1000) : s.distanceMm / s.goal.target) : 0;
  const goalRatio = Math.min(1, goalCompletion);
  const goalExtra = s.goal?.kind === 'time'
    ? formatDuration(String(Math.max(0, s.movingMs - s.goal.target * 1000)))
    : `${(Math.max(0, s.distanceMm - (s.goal?.target ?? 0)) / 1_000_000).toFixed(2)} km`;
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
            setFinishFailed(null);
            try {
              const r = await workoutRecorder.finish();
              navigation.dispatch(StackActions.replace('WorkoutSummary', { sessionId: r.meta.sessionId, celebrate: true }));
            } catch (e) {
              // review 5：本機寫入失敗——摘要仍在 recorder 手上，留在本頁提供重試，不要卡在「結束中」
              setFinishFailed(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          })();
        },
      },
    ]);
  };

  const retryFinish = async () => {
    setBusy(true);
    try {
      const r = await workoutRecorder.retryFinish();
      navigation.dispatch(StackActions.replace('WorkoutSummary', { sessionId: r.meta.sessionId, celebrate: true }));
    } catch (e) {
      setFinishFailed(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen testID="workout-record-screen">
      <View style={styles.statusRow} accessible accessibilityLabel={`${t(`rec.gps.${s.gps}` as TKey)}, ${s.state === 'paused' ? t('rec.paused') : t('rec.recording')}`} testID="record-status">
        <Chip label={t(`rec.gps.${s.gps}` as TKey)} kind={s.gps === 'ok' ? 'synced' : s.gps === 'poor' ? 'devnet' : 'offline'} />
        <Chip label={s.state === 'paused' ? (s.pauseKind === 'auto' ? t('rec.autoPaused') : t('rec.paused')) : t('rec.recording')} kind={s.state === 'paused' ? 'devnet' : 'level'} />
        <Pressable onPress={() => void prefs.set({ detailView: !detail })} accessibilityRole="button" accessibilityState={{ selected: detail }} accessibilityLabel={t('rec.detailView')} hitSlop={8} style={[styles.lockBtn, detail && styles.lockBtnOn]} testID="record-detail-toggle">
          <Feather name={detail ? 'list' : 'minimize-2'} size={16} color={detail ? color.mint : color.textSecondary} />
          <Text variant="label" tone={detail ? 'mint' : 'secondary'}>{detail ? t('rec.detail.hide') : t('rec.detail.show')}</Text>
        </Pressable>
        <Pressable onPress={() => setLocked(true)} onLongPress={() => setLocked(false)} delayLongPress={1200} accessibilityRole="button" accessibilityLabel={locked ? t('rec.lock.unlockA11y') : t('rec.lock.lockA11y')} hitSlop={8} style={[styles.lockBtn, locked && styles.lockBtnOn]} testID={locked ? 'record-unlock' : 'record-lock'}>
          <Feather name={locked ? 'lock' : 'unlock'} size={16} color={locked ? color.mint : color.textSecondary} />
          <Text variant="label" tone={locked ? 'mint' : 'secondary'}>{locked ? t('rec.lock.locked') : t('rec.lock.lock')}</Text>
        </Pressable>
      </View>
      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} showsVerticalScrollIndicator={false} testID="record-body">
      {notificationState && (notificationState.silenced || !notificationState.appNotificationsEnabled) ? <InlineState kind="warning" title={t('rec.notif.silencedTitle')} body={t(notificationState.appNotificationsEnabled ? 'rec.notif.silencedBody' : 'rec.notif.disabledBody')} action={{ label: t('rec.permissionOpen'), onPress: () => void Linking.openSettings() }} testID="record-notification-warning" /> : null}
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
      {s.gps === 'searching' && s.state === 'recording' && !s.gpsIssue ? (
        <Text variant="caption" tone="warning" style={styles.center} testID="record-gps-gap">
          {t('rec.gpsGap')}
        </Text>
      ) : s.paceStale && s.state === 'recording' && !s.gpsIssue ? (
        <Text variant="caption" tone="warning" style={styles.center} testID="record-pace-stale">
          {t('rec.paceStale')}
        </Text>
      ) : null}
      {s.storage.failing ? (
        <Text variant="caption" tone="warning" style={styles.center} testID="record-storage-failing">
          {t('rec.storage.failing', { n: s.storage.pendingPoints })}
        </Text>
      ) : null}
      {finishFailed !== null || s.finishError !== null ? (
        <InlineState kind="error" title={t('rec.finishFailed.title')} body={t('rec.finishFailed.body', { message: apiErrorText(t, finishFailed ?? s.finishError ?? '') })} action={{ label: busy ? t('rec.finishing') : t('rec.finishFailed.retry'), onPress: () => void retryFinish() }} testID="record-finish-failed" />
      ) : null}
      {/* 定位診斷：詳細模式或 GPS 有狀況時顯示「收到幾筆／採用幾筆／精度」（實機回饋：戶外跑道 14 分鐘 0 km 沒有任何提示） */}
      {s.state === 'recording' && showDiag ? (
        <Text variant="caption" tone="muted" style={styles.center} testID="record-gps-diag">
          {[t('rec.gpsDiag', { fixes: s.fixes, accepted: s.accepted, acc: s.lastAccuracyM === null ? '—' : String(Math.round(s.lastAccuracyM)) }), s.gpsRestarts > 0 ? t('rec.gpsDiag.restarted', { n: s.gpsRestarts }) : null, s.gpsFallback ? t('rec.gpsDiag.fallback') : null].filter(Boolean).join(' · ')}
        </Text>
      ) : null}
      {s.gpsIssue ? (
        <InlineState
          kind="warning"
          title={t(s.gpsIssue.kind === 'no_fix' ? 'rec.gpsIssue.noFixTitle' : 'rec.gpsIssue.weakTitle')}
          body={t(s.gpsIssue.kind === 'no_fix' ? 'rec.gpsIssue.noFixBody' : 'rec.gpsIssue.weakBody', { s: Math.round(s.gpsIssue.sinceMs / 1000), acc: s.lastAccuracyM === null ? '—' : String(Math.round(s.lastAccuracyM)) })}
          action={s.gpsIssue.kind === 'no_fix' ? { label: t('rec.gpsIssue.openSettings'), onPress: () => void Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS').catch(() => Linking.openSettings()) } : undefined}
          testID={`record-gps-issue-${s.gpsIssue.kind}`}
        />
      ) : null}
      {/* 中段可捲動（內容依模式與資料變多）；狀態列與控制列固定 */}
      <View style={[styles.hero, onFire && styles.heroFire]} accessible accessibilityLabel={`${primaryLabel} ${primary === '—' ? t('rec.a11y.none') : primary} ${profile.primary === 'time' ? '' : profile.primary === 'speed' ? t('rec.a11y.kmh') : t('rec.a11y.minPerKm')}${onFire ? `, ${t('rec.energy.title')}, ${t('rec.vsAvg.faster', { p: -vsAvg! })}` : ''}`}>
        {onFire ? <View pointerEvents="none" style={styles.energyBackdrop} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID="record-energy">
          <LinearGradient colors={[color.warning, color.danger, color.surface]} start={{ x: 1, y: 0 }} end={{ x: 0, y: 1 }} style={styles.energyWash} />
          <Feather name="zap" size={160} color={color.warning} style={styles.energyBolt} />
          <View style={styles.energyStreak} />
        </View> : null}
        {onFire ? <View style={styles.energyLabel}><Feather name="zap" size={16} color={color.warning} /><Text variant="label" tone="warning" uppercase>{t('rec.energy.title')}</Text></View> : null}
        <View style={styles.modeRow}>
          <Feather name={profile.icon} size={14} color={profile.accent} />
          <Text variant="label" tone={profile.accentTone} uppercase testID="record-mode">
            {t(`wo.mode.${mode}` as TKey)}
          </Text>
        </View>
        <Text style={[styles.big, onFire && styles.bigFire]} numeric testID="record-primary" maxFontSizeMultiplier={1.6}>
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
        {vsAvg !== null && detail ? (
          <View style={[styles.zoneChip, { borderColor: onFire ? color.warning : vsAvg <= 0 ? profile.accent : color.borderSubtle }, onFire && styles.energyComparison]} testID="record-vs-avg">
            <Text variant="caption" tone={onFire ? 'warning' : vsAvg <= 0 ? profile.accentTone : 'secondary'}>
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
        <View style={[styles.goal, s.goalReached && styles.goalAchieved]}>
          {s.goalReached ? <>
            <LinearGradient pointerEvents="none" colors={[color.elevated, color.surface]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: radius.l }]} />
            <View style={styles.achievementHeader} testID="record-goal-achievement">
              <View style={styles.achievementMedal}><Feather name="award" size={28} color={color.warning} /></View>
              <View style={styles.achievementCopy}>
                <Text variant="label" tone="mint" uppercase>{t('rec.goalVictory.eyebrow')}</Text>
                <Text variant="heading2">{t('rec.goalVictory.title')}</Text>
              </View>
              <Feather name="check-circle" size={24} color={color.mint} />
            </View>
            <View style={styles.achievementStats}>
              <View style={styles.achievementCopy}><Text variant="displayM" numeric tone="mint" testID="record-goal-percent">{Math.floor(goalCompletion * 100)}%</Text><Text variant="caption" tone="secondary">{t('rec.goalVictory.completed')}</Text></View>
              <View style={styles.achievementExtra}><Text variant="heading2" numeric testID="record-goal-extra">+{goalExtra}</Text><Text variant="caption" tone="secondary">{t('rec.goalVictory.extra')}</Text></View>
            </View>
          </> : null}
          <View style={styles.goalTrack} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(goalRatio * 100) }} testID="record-goal-bar">
            <View style={[styles.goalFill, { width: `${Math.round(goalRatio * 100)}%`, backgroundColor: profile.accent }, s.goalReached && styles.goalFillDone]} />
          </View>
          <Text variant="caption" tone={s.goalReached ? 'mint' : 'muted'} style={styles.center} testID="record-goal">
            {s.goalReached ? t('rec.goalReached') : t('rec.goalProgress', { target: s.goal.kind === 'time' ? t('rec.goal.minMoving', { n: Math.round(s.goal.target / 60) }) : t('rec.goal.km', { n: s.goal.target / 1_000_000 }) })}
          </Text>
        </View>
      ) : null}
      {/* 最近分段／圈（最多 5 筆，新到舊）；沒有時提示自動分段規則——詳細模式 */}
      {detail ? <View style={styles.splits} testID="record-splits">
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
      </View> : null}
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
      {/* 即時軌跡＋速度曲線（Style 23.6）：只用記憶體內最近接受點與 5 秒窗樣本，不讀磁碟——詳細模式 */}
      {detail && s.path.length >= 2 ? <RouteTrace points={s.path} height={150} layer={traceLayer} testID="record-trace" /> : null}
      {detail ? <>
        <View style={styles.sparkHead}>
          <Text variant="label" tone="muted" uppercase>{s.sport === 'walk' ? t('rec.spark.speed') : t('rec.spark.pace')}</Text>
          <Text variant="caption" tone="muted" numeric>
            {s.lastAccuracyM !== null && s.state === 'recording' ? `${t('rec.gpsAccuracy', { m: Math.round(s.lastAccuracyM) })} · ` : ''}{t('rec.totalTime', { t: formatDuration(String(s.elapsedMs)) })}
          </Text>
        </View>
        <SpeedSparkline samples={s.speedSamples} sport={s.sport} accent={profile.accent} />
      </> : (
        <Text variant="caption" tone="muted" style={styles.center} numeric testID="record-total-time">
          {t('rec.totalTime', { t: formatDuration(String(s.elapsedMs)) })}
        </Text>
      )}
      </ScrollView>
      <Text variant="caption" tone={s.state === 'paused' ? 'warning' : 'muted'} style={styles.center} testID="record-control-hint">
        {t(s.state === 'finishing' ? 'rec.finishing' : s.state === 'paused' ? 'rec.flow.paused' : 'rec.flow.recording')}
      </Text>
      <View style={styles.controls}>
        {locked ? (
          <View style={[styles.ctl, styles.ctlWide, styles.ctlPlaceholder]} testID="record-locked" />
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
      {locked ? (
        <Pressable style={styles.lockOverlay} onPress={() => {}} accessibilityLabel={t('rec.lock.overlayHint')} testID="record-lock-overlay">
          <HoldToUnlock onUnlock={() => setLocked(false)} />
        </Pressable>
      ) : null}
      {feedback ? <WorkoutActionFeedback key={feedback.id} mode={mode} action={feedback.action} /> : null}
    </Screen>
  );
}

/** 長按解鎖列（實機回饋：按住時看不出「正在 HOLD」）：按下即開始 1.2 s 進度填滿＋文案「繼續按住…」，放開歸零，滿格解鎖並震動 */
const HOLD_MS = 1200;
function HoldToUnlock({ onUnlock }: { onUnlock: () => void }) {
  const { t, locale } = useT();
  const reduced = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const [holding, setHolding] = useState(false);
  const anim = useRef<Animated.CompositeAnimation | null>(null);
  const start = () => {
    setHolding(true);
    void Haptics.selectionAsync().catch(() => {});
    anim.current?.stop();
    progress.setValue(0);
    anim.current = Animated.timing(progress, { toValue: 1, duration: HOLD_MS, easing: Easing.linear, useNativeDriver: false });
    anim.current.start();
  };
  const cancel = () => {
    setHolding(false);
    anim.current?.stop();
    Animated.timing(progress, { toValue: 0, duration: reduced ? 0 : 160, useNativeDriver: false }).start();
  };
  const done = () => {
    setHolding(false);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    onUnlock();
  };
  return (
    <Pressable onPressIn={start} onPressOut={cancel} onLongPress={done} delayLongPress={HOLD_MS} accessibilityRole="button" accessibilityLabel={t('rec.lock.unlockA11y')} accessibilityState={{ busy: holding }} style={[styles.lockBar, holding && styles.lockBarHolding]} testID="record-lock-overlay-unlock">
      <Animated.View pointerEvents="none" style={[styles.lockFill, { width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} testID="record-lock-hold-fill" />
      <Feather name={holding ? 'unlock' : 'lock'} size={18} color={color.mint} />
      <Text variant="title">{holding ? t('rec.lock.holding') : t('rec.lock.holdToUnlock')}</Text>
    </Pressable>
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
  hero: { alignItems: 'center', marginTop: space.l, paddingVertical: space.s, borderWidth: 1, borderColor: 'transparent', borderRadius: radius.xl },
  heroFire: { borderColor: color.warning, backgroundColor: color.surface },
  energyBackdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, overflow: 'hidden', borderRadius: radius.xl },
  energyWash: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, opacity: 0.16 },
  energyBolt: { position: 'absolute', right: -space.l, top: space.l, opacity: 0.12, transform: [{ rotate: '12deg' }] },
  energyStreak: { position: 'absolute', left: space.l, top: space.xl, bottom: space.xl, width: 3, borderRadius: radius.s, backgroundColor: color.warning, opacity: 0.6, transform: [{ rotate: '18deg' }] },
  energyLabel: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginBottom: space.xs },
  energyComparison: { backgroundColor: color.surface },
  bigFire: { color: color.warning },
  goalAchieved: { borderWidth: 1, borderColor: color.mint, borderRadius: radius.l, padding: space.m },
  achievementHeader: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  achievementMedal: { width: 48, height: 48, borderRadius: radius.m, backgroundColor: color.elevated, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: color.warning },
  achievementCopy: { flex: 1 },
  achievementStats: { flexDirection: 'row', alignItems: 'center', gap: space.s, marginVertical: space.m },
  achievementExtra: { flex: 1, alignItems: 'flex-end' },
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
  lockBtn: { marginLeft: 'auto', minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: space.xxs, paddingHorizontal: space.s, borderRadius: radius.xl, borderWidth: 1, borderColor: color.borderSubtle },
  lockBtnOn: { borderColor: color.mint },
  lockOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'flex-end', zIndex: 20 },
  lockBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs, minHeight: 64, marginHorizontal: layout.screenPaddingX, marginBottom: space.l, borderRadius: radius.xl, borderWidth: 1, borderColor: color.mint, backgroundColor: color.surface, overflow: 'hidden' },
  lockBarHolding: { borderWidth: 2 },
  lockFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: color.mint, opacity: 0.28 },
  ctlWide: { flex: 1 },
  ctlPlaceholder: { opacity: 0 },
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
