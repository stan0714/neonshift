import { StackActions, useNavigation } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import * as Haptics from 'expo-haptics';
import { Alert, BackHandler, Pressable, StyleSheet, View } from 'react-native';

import { Chip, Screen } from '@/components';
import { formatDuration, formatPace } from '@/domain/workouts';
import { useT, type TKey } from '@/i18n';
import { workoutCues } from '@/services/workouts/WorkoutCues';
import { workoutRecorder } from '@/services/workouts/WorkoutRecorder';
import { useWorkoutPrefs } from '@/state/workoutPrefsStore';
import { color, layout, radius, space, Text } from '@/theme';
import { useRecorder } from './useRecorder';

/**
 * 記錄頁（Style 23）：走路主顯示 km/h、跑步主顯示 min/km；時間／距離次要；GPS 與暫停狀態始終可見；
 * Lap／Pause ≥ 48dp；Finish 只在暫停頁並需確認。記錄中不做裝飾動畫。
 */
export function WorkoutRecordScreen() {
  const { t } = useT();
  const navigation = useNavigation();
  const s = useRecorder();
  const [busy, setBusy] = useState(false);
  const [lapNote, setLapNote] = useState<string | null>(null);
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

  // PG-U-02：每公里／自訂圈語音或震動提示（預設關閉；背景／通話不搶播）
  const { locale } = useT();
  const prefs = useWorkoutPrefs();
  useEffect(() => { workoutCues.reset(workoutRecorder.snapshot()); }, []);
  useEffect(() => { workoutCues.onSnapshot(s, { voice: prefs.voice, haptic: prefs.haptic, locale: locale === 'zh-TW' ? 'zh-TW' : 'en' }); }, [s, prefs.voice, prefs.haptic, locale]);

  const primary = s.sport === 'walk' ? (s.currentSpeedMs === null ? '—' : (s.currentSpeedMs * 3.6).toFixed(1)) : formatPace(s.currentPaceSPerKm).replace(' /km', '');
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
              navigation.dispatch(StackActions.replace('WorkoutSummary', { sessionId: r.meta.sessionId }));
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
        <Chip label={s.state === 'paused' ? t('rec.paused') : t('rec.recording')} kind={s.state === 'paused' ? 'devnet' : 'level'} />
        <Pressable onPress={() => setLocked(true)} onLongPress={() => setLocked(false)} delayLongPress={1200} accessibilityRole="button" accessibilityLabel={locked ? t('rec.lock.unlockA11y') : t('rec.lock.lockA11y')} hitSlop={8} style={styles.lockBtn} testID={locked ? 'record-unlock' : 'record-lock'}>
          <Text variant="label" tone={locked ? 'mint' : 'secondary'}>{locked ? t('rec.lock.locked') : t('rec.lock.lock')}</Text>
        </Pressable>
      </View>
      {s.gps === 'searching' && s.state === 'recording' ? (
        <Text variant="caption" tone="warning" style={styles.center} testID="record-gps-gap">
          {t('rec.gpsGap')}
        </Text>
      ) : null}
      <View style={styles.hero} accessible accessibilityLabel={`${s.sport === 'walk' ? t('rec.speed') : t('rec.pace')} ${primary === '—' ? t('rec.a11y.none') : primary} ${s.sport === 'walk' ? t('rec.a11y.kmh') : t('rec.a11y.minPerKm')}`}>
        <Text style={styles.big} numeric testID="record-primary" maxFontSizeMultiplier={1.6}>
          {primary}
        </Text>
        <Text variant="label" tone="muted" uppercase>
          {s.sport === 'walk' ? t('rec.speed') : t('rec.pace')}
        </Text>
      </View>
      <View style={styles.secondary}>
        <View style={styles.metric} accessible accessibilityLabel={`${t('rec.a11y.time')} ${formatDuration(String(s.elapsedMs))}`}>
          <Text variant="displayM" numeric testID="record-time">
            {formatDuration(String(s.elapsedMs))}
          </Text>
          <Text variant="caption" tone="muted">
            {t('rec.time')}
          </Text>
        </View>
        <View style={styles.metric} accessible accessibilityLabel={`${t('rec.a11y.distance')} ${(s.distanceMm / 1_000_000).toFixed(2)} ${t('rec.a11y.km')}`}>
          <Text variant="displayM" numeric testID="record-distance">
            {(s.distanceMm / 1_000_000).toFixed(2)}
          </Text>
          <Text variant="caption" tone="muted">
            {t('rec.distance')}
          </Text>
        </View>
      </View>
      {s.goal && s.goal.kind !== 'free' ? (
        <Text variant="caption" tone={s.goalReached ? 'mint' : 'muted'} style={styles.center} testID="record-goal">
          {s.goalReached ? t('rec.goalReached') : t('rec.goalProgress', { target: s.goal.kind === 'time' ? t('rec.goal.min', { n: Math.round(s.goal.target / 60) }) : t('rec.goal.km', { n: s.goal.target / 1_000_000 }) })}
        </Text>
      ) : null}
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
        <Text variant="bodySmall" tone="cyan" style={styles.center}>
          {lapNote}
        </Text>
      ) : null}
      <View style={styles.controls}>
        {locked ? (
          <Pressable onLongPress={() => setLocked(false)} delayLongPress={1200} accessibilityRole="button" accessibilityLabel={t('rec.lock.unlockA11y')} style={[styles.ctl, styles.ctlSecondary, styles.ctlWide]} testID="record-locked">
            <Text variant="title">{t('rec.lock.holdToUnlock')}</Text>
          </Pressable>
        ) : s.state === 'recording' ? (
          <>
            <Pressable onPress={() => void workoutRecorder.lap().then((l) => l && setLapNote(t('rec.lapAdded', { n: l.index })))} accessibilityRole="button" accessibilityLabel={t('rec.lap')} style={[styles.ctl, styles.ctlSecondary]} testID="record-lap">
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  track: { alignItems: 'center', marginTop: space.s },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space.s },
  hero: { alignItems: 'center', marginTop: space.xl * 2 },
  big: { fontSize: 88, lineHeight: 96, fontWeight: '700', color: color.textPrimary, fontVariant: ['tabular-nums'] },
  secondary: { flexDirection: 'row', justifyContent: 'space-around', marginTop: space.xl },
  metric: { alignItems: 'center' },
  center: { textAlign: 'center', marginTop: space.m },
  lockBtn: { marginLeft: 'auto', minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center' },
  ctlWide: { flex: 1 },
  controls: { flexDirection: 'row', gap: space.m, marginTop: 'auto', marginBottom: space.l },
  ctl: { flex: 1, minHeight: 64, borderRadius: radius.l, alignItems: 'center', justifyContent: 'center', minWidth: layout.minTouchTarget },
  ctlPrimary: { backgroundColor: color.mint },
  ctlSecondary: { borderWidth: 1, borderColor: color.borderSubtle, backgroundColor: color.surface },
  ctlDanger: { borderWidth: 1, borderColor: color.danger, backgroundColor: color.surface },
  onMint: { color: color.onMint },
});
