import { StackActions, useNavigation } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import * as Haptics from 'expo-haptics';
import { Alert, BackHandler, Pressable, StyleSheet, View } from 'react-native';

import { Chip, Screen } from '@/components';
import { formatDuration, formatPace } from '@/domain/workouts';
import { useT, type TKey } from '@/i18n';
import { workoutRecorder } from '@/services/workouts/WorkoutRecorder';
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

  useEffect(() => {
    // 記錄中不讓返回鍵離開（避免誤觸）；用 Finish 結束
    const sub = BackHandler.addEventListener('hardwareBackPress', () => s.state === 'recording' || s.state === 'paused');
    return () => sub.remove();
  }, [s.state]);

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
      <View style={styles.statusRow}>
        <Chip label={t(`rec.gps.${s.gps}` as TKey)} kind={s.gps === 'ok' ? 'synced' : s.gps === 'poor' ? 'devnet' : 'offline'} />
        <Chip label={s.state === 'paused' ? t('rec.paused') : t('rec.recording')} kind={s.state === 'paused' ? 'devnet' : 'level'} />
      </View>
      <View style={styles.hero}>
        <Text style={styles.big} numeric testID="record-primary">
          {primary}
        </Text>
        <Text variant="label" tone="muted" uppercase>
          {s.sport === 'walk' ? t('rec.speed') : t('rec.pace')}
        </Text>
      </View>
      <View style={styles.secondary}>
        <View style={styles.metric}>
          <Text variant="displayM" numeric testID="record-time">
            {formatDuration(String(s.elapsedMs))}
          </Text>
          <Text variant="caption" tone="muted">
            {t('rec.time')}
          </Text>
        </View>
        <View style={styles.metric}>
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
        {s.state === 'recording' ? (
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
  controls: { flexDirection: 'row', gap: space.m, marginTop: 'auto', marginBottom: space.l },
  ctl: { flex: 1, minHeight: 64, borderRadius: radius.l, alignItems: 'center', justifyContent: 'center', minWidth: layout.minTouchTarget },
  ctlPrimary: { backgroundColor: color.mint },
  ctlSecondary: { borderWidth: 1, borderColor: color.borderSubtle, backgroundColor: color.surface },
  ctlDanger: { borderWidth: 1, borderColor: color.danger, backgroundColor: color.surface },
  onMint: { color: color.onMint },
});
