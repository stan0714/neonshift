import { useNavigation } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';

import { Button, InlineState, Screen, Surface } from '@/components';
import { SPLIT_KM_MM, SPLIT_MILE_MM, TRACK_LAP_MAX_M, TRACK_LAP_MIN_M } from '@/domain/gps/engine';
import { useT, type TKey } from '@/i18n';
import { FREE_GOAL, GOAL_VERSION, modeToSport, useWorkoutPrefs, type WorkoutMode } from '@/state/workoutPrefsStore';
import type { WorkoutGoal } from '@/services/api/ApiClient';
import { workoutRecorder } from '@/services/workouts/WorkoutRecorder';
import { color, radius, space, Text } from '@/theme';

type Seg<T extends string> = { value: T; label: string };
function Segmented<T extends string>({ items, value, onChange, testID }: { items: Seg<T>[]; value: T; onChange: (v: T) => void; testID: string }) {
  return (
    <View style={styles.segment} accessibilityRole="radiogroup">
      {items.map((it) => (
        <Pressable key={it.value} onPress={() => onChange(it.value)} accessibilityRole="radio" accessibilityState={{ selected: value === it.value }} style={[styles.segmentItem, value === it.value && styles.segmentOn]} testID={`${testID}-${it.value}`}>
          <Text variant="bodySmall" tone={value === it.value ? undefined : 'secondary'} style={value === it.value && styles.segmentOnText}>
            {it.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

type TrackChoice = 'off' | '400' | '200' | 'custom';
/** 跑道模式圈長（公尺）；自訂值需在 TRACK_LAP_MIN_M～TRACK_LAP_MAX_M 內，否則 null */
export function trackLapMetersOf(choice: TrackChoice, custom: string): number | null {
  if (choice === 'off') return null;
  const m = choice === 'custom' ? Number(custom.trim()) : Number(choice);
  return Number.isInteger(m) && m >= TRACK_LAP_MIN_M && m <= TRACK_LAP_MAX_M ? m : null;
}

type GoalChoice = 'free' | 'time' | 'distance';
const TIME_PRESETS = [10, 20, 30] as const; // 分鐘（可獎勵目標模板初版）
const DIST_PRESETS = [1, 3, 5] as const; // 公里
export function goalOf(kind: GoalChoice, timeMin: number, distKm: number): WorkoutGoal {
  if (kind === 'time') return { kind: 'time', target: timeMin * 60, unit: 's', version: GOAL_VERSION };
  if (kind === 'distance') return { kind: 'distance', target: Math.round(distKm * 1_000_000), unit: 'mm', version: GOAL_VERSION };
  return FREE_GOAL;
}

/** 開始頁（Style 23／24；PG-U-01）：三模式（走路／健走／跑步，開始後固定）、目標（自由／時間／距離，快照存入 session、達標只提醒）、最近模式預設；戶外／室內、自動圈、分段單位與跑道模式（PG-R-12）；室內不啟用 GPS */
export function WorkoutStartScreen() {
  const { t } = useT();
  const navigation = useNavigation();
  const prefs = useWorkoutPrefs();
  const [mode, setMode] = useState<WorkoutMode>(prefs.mode);
  const [goalKind, setGoalKind] = useState<GoalChoice>(prefs.goal.kind);
  const [timeMin, setTimeMin] = useState<number>(prefs.goal.kind === 'time' ? Math.round(prefs.goal.target / 60) : 20);
  const [distKm, setDistKm] = useState<number>(prefs.goal.kind === 'distance' ? prefs.goal.target / 1_000_000 : 3);
  useEffect(() => {
    if (prefs.loaded) return;
    void prefs.load().then((p) => { setMode(p.mode); setGoalKind(p.goal.kind); if (p.goal.kind === 'time') setTimeMin(Math.round(p.goal.target / 60)); if (p.goal.kind === 'distance') setDistKm(p.goal.target / 1_000_000); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { sport, intent } = modeToSport(mode);
  const [env, setEnv] = useState<'outdoor' | 'indoor'>('outdoor');
  const [autoLap, setAutoLap] = useState<'off' | '400' | '1000'>('off');
  const [units, setUnits] = useState<'km' | 'mi'>('km');
  const [track, setTrack] = useState<TrackChoice>('off');
  const [trackCustom, setTrackCustom] = useState('');
  const [trackConfirmed, setTrackConfirmed] = useState(false);
  const trackLapM = trackLapMetersOf(track, trackCustom);
  // 跑道模式：圈長有效且使用者已核對才可開始（400 m 不是所有跑道線的實際長度）
  const trackBlocked = track !== 'off' && (trackLapM === null || !trackConfirmed);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ kind: 'permission' | 'generic'; message?: string } | null>(null);

  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (!(await workoutRecorder.ensurePermission())) {
        setErr({ kind: 'permission' });
        return;
      }
      const goal = goalOf(goalKind, timeMin, distKm);
      await prefs.set({ mode, goal }); // 最近模式與目標（快速開始用）
      await workoutRecorder.start({ sport, intent, goal, environment: env, autoLapMm: autoLap === 'off' ? null : Number(autoLap) * 1000, trackLapMm: trackLapM === null ? null : trackLapM * 1000, splitLengthMm: units === 'km' ? SPLIT_KM_MM : SPLIT_MILE_MM });
      navigation.navigate('WorkoutRecord');
    } catch (e) {
      setErr({ kind: 'generic', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll testID="workout-start-screen">
      <Text variant="label" tone="muted" uppercase>
        {t('rec.mode')}
      </Text>
      <Segmented items={(['walk', 'brisk', 'run'] as const).map((m) => ({ value: m, label: t(`wo.mode.${m}` as TKey) }))} value={mode} onChange={setMode} testID="start-mode" />
      <Text variant="caption" tone="muted" style={styles.mtXs}>
        {t(`rec.modeHint.${mode}` as TKey)}
      </Text>
      <Text variant="label" tone="muted" uppercase style={styles.mt}>
        {t('rec.goal')}
      </Text>
      <Segmented items={(['free', 'time', 'distance'] as const).map((g) => ({ value: g, label: t(`rec.goal.${g}` as TKey) }))} value={goalKind} onChange={setGoalKind} testID="start-goal" />
      {goalKind === 'time' ? <Segmented items={TIME_PRESETS.map((m) => ({ value: String(m), label: t('rec.goal.min', { n: m }) }))} value={String(timeMin)} onChange={(v) => setTimeMin(Number(v))} testID="start-goal-time" /> : null}
      {goalKind === 'distance' ? <Segmented items={DIST_PRESETS.map((k) => ({ value: String(k), label: t('rec.goal.km', { n: k }) }))} value={String(distKm)} onChange={(v) => setDistKm(Number(v))} testID="start-goal-dist" /> : null}
      {goalKind !== 'free' ? (
        <Text variant="caption" tone="muted" style={styles.mtXs}>
          {t('rec.goalHint')}
        </Text>
      ) : null}
      <Text variant="label" tone="muted" uppercase style={styles.mt}>
        {t('rec.env')}
      </Text>
      <Segmented items={[{ value: 'outdoor', label: t('rec.env.outdoor') }, { value: 'indoor', label: t('rec.env.indoor') }]} value={env} onChange={setEnv} testID="start-env" />
      {env === 'indoor' ? <InlineState kind="info" title={t('rec.indoorHint')} action={{ label: t('wo.import'), onPress: () => navigation.navigate('Workouts') }} testID="start-indoor" /> : null}
      <Surface style={styles.card}>
        <Text variant="label" tone="muted" uppercase>
          {t('rec.autoLap')}
        </Text>
        <Segmented items={(['off', '400', '1000'] as const).map((v) => ({ value: v, label: t(`rec.autoLap.${v}` as TKey) }))} value={autoLap} onChange={setAutoLap} testID="start-autolap" />
        <View style={styles.row}>
          <Text variant="bodySmall" style={styles.rowLabel}>
            {t('rec.cue.voice')}
          </Text>
          <Switch value={prefs.voice} onValueChange={(v) => void prefs.set({ voice: v })} trackColor={{ true: color.mint, false: color.borderSubtle }} thumbColor={color.textPrimary} accessibilityLabel={t('rec.cue.voice')} testID="start-cue-voice" />
        </View>
        <View style={styles.row}>
          <Text variant="bodySmall" style={styles.rowLabel}>
            {t('rec.cue.haptic')}
          </Text>
          <Switch value={prefs.haptic} onValueChange={(v) => void prefs.set({ haptic: v })} trackColor={{ true: color.mint, false: color.borderSubtle }} thumbColor={color.textPrimary} accessibilityLabel={t('rec.cue.haptic')} testID="start-cue-haptic" />
        </View>
        <Text variant="caption" tone="muted">
          {t('rec.cue.hint')}
        </Text>
        <Text variant="label" tone="muted" uppercase style={styles.mt}>
          {t('rec.units')}
        </Text>
        <Segmented items={[{ value: 'km', label: t('rec.units.km') }, { value: 'mi', label: t('rec.units.mi') }]} value={units} onChange={setUnits} testID="start-units" />
      </Surface>
      <Surface style={styles.card} testID="start-track-card">
        <Text variant="label" tone="muted" uppercase>
          {t('rec.track')}
        </Text>
        <Segmented items={(['off', '400', '200', 'custom'] as const).map((v) => ({ value: v, label: t(`rec.track.${v}` as TKey) }))} value={track} onChange={(v) => { setTrack(v); setTrackConfirmed(false); }} testID="start-track" />
        {track === 'custom' ? (
          <TextInput value={trackCustom} onChangeText={(v) => { setTrackCustom(v.replace(/[^0-9]/g, '')); setTrackConfirmed(false); }} keyboardType="number-pad" maxLength={4} placeholder={t('rec.track.customPlaceholder')} placeholderTextColor={color.textMuted} style={styles.input} accessibilityLabel={t('rec.track.custom')} testID="start-track-custom-input" />
        ) : null}
        {track !== 'off' ? (
          <>
            <Text variant="caption" tone="muted" style={styles.mtXs}>
              {trackLapM === null ? t('rec.track.invalid', { min: TRACK_LAP_MIN_M, max: TRACK_LAP_MAX_M }) : t('rec.track.hint', { len: trackLapM })}
            </Text>
            <View style={styles.row}>
              <Text variant="bodySmall" style={styles.rowLabel}>
                {t('rec.track.confirm')}
              </Text>
              <Switch value={trackConfirmed} onValueChange={setTrackConfirmed} disabled={trackLapM === null} trackColor={{ true: color.mint, false: color.borderSubtle }} thumbColor={color.textPrimary} accessibilityLabel={t('rec.track.confirm')} testID="start-track-confirm" />
            </View>
          </>
        ) : null}
      </Surface>
      {err?.kind === 'permission' ? <InlineState kind="warning" title={t('rec.permissionTitle')} body={t('rec.permissionBody')} action={{ label: t('rec.permissionOpen'), onPress: () => void Linking.openSettings() }} testID="start-permission" /> : null}
      {err?.kind === 'generic' ? <InlineState kind="error" title={t('rec.err', { message: err.message ?? '' })} testID="start-error" /> : null}
      <Button label={t('rec.go')} style={styles.mt} onPress={() => void go()} loading={busy} loadingLabel={t('rec.starting')} disabled={busy || env === 'indoor' || trackBlocked} disabledReason={env === 'indoor' ? t('rec.indoorHint') : trackBlocked ? t('rec.track.blocked') : undefined} testID="start-go" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  mt: { marginTop: space.m },
  mtXs: { marginTop: space.xs },
  card: { marginTop: space.m },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.xs, minHeight: 48 },
  rowLabel: { flex: 1, marginRight: space.s },
  input: { marginTop: space.xs, minHeight: 48, borderWidth: 1, borderColor: color.borderSubtle, borderRadius: radius.m, paddingHorizontal: space.s, color: color.textPrimary, fontSize: 18, backgroundColor: color.elevated },
  segment: { flexDirection: 'row', borderWidth: 1, borderColor: color.borderSubtle, borderRadius: radius.m, overflow: 'hidden', marginTop: space.xs },
  segmentItem: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { backgroundColor: color.mint },
  segmentOnText: { color: color.onMint },
});
