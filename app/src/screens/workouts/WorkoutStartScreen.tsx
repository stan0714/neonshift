import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { Animated, Easing, Linking, Modal, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';

import { Button, InlineState, Screen, Surface } from '@/components';
import { ShoeHero } from '@/components/ShoeHero';
import { SPLIT_KM_MM, SPLIT_MILE_MM, TRACK_LAP_MAX_M, TRACK_LAP_MIN_M } from '@/domain/gps/engine';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { useT, type TKey } from '@/i18n';
import type { WorkoutGoal } from '@/services/api/ApiClient';
import { workoutRecorder } from '@/services/workouts/WorkoutRecorder';
import { useDashboardStore } from '@/state/dashboardStore';
import { FREE_GOAL, GOAL_VERSION, modeToSport, useWorkoutPrefs, type WorkoutMode } from '@/state/workoutPrefsStore';
import { color, glowStyle, radius, space, Text } from '@/theme';

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

/** 底部面板（Style 24.5）：scrim＋貼底 Surface；關閉走 onRequestClose（返回鍵）與 scrim 點擊 */
function Sheet({ visible, onClose, title, children, testID }: { visible: boolean; onClose: () => void; title: string; children: React.ReactNode; testID: string }) {
  const { t } = useT();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('common.close')} testID={`${testID}-scrim`}>
        <Pressable style={styles.sheetWrap} onPress={() => {}}>
          <Surface hero style={styles.sheet} testID={testID}>
            <View style={styles.sheetHead}>
              <Text variant="heading2">{title}</Text>
              <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t('common.close')} hitSlop={12} style={styles.sheetClose} testID={`${testID}-close`}>
                <Feather name="x" size={22} color={color.textSecondary} />
              </Pressable>
            </View>
            <ScrollView style={styles.sheetBody} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {children}
            </ScrollView>
          </Surface>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** 背景：抽象街區格線＋一條路線（不畫真實地圖；地圖供應商未定） */
function Backdrop() {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 320 320" preserveAspectRatio="xMidYMid slice" style={StyleSheet.absoluteFill} pointerEvents="none">
      {[40, 100, 160, 220, 280].map((y) => (
        <Line key={`h${y}`} x1="0" y1={y} x2="320" y2={y + 18} stroke={color.borderSubtle} strokeOpacity={0.45} />
      ))}
      {[30, 90, 150, 210, 270].map((x) => (
        <Line key={`v${x}`} x1={x} y1="0" x2={x - 22} y2="320" stroke={color.borderSubtle} strokeOpacity={0.45} />
      ))}
      <Path d="M28 236 C70 214 96 262 138 232 S206 150 250 168 S300 118 318 96" fill="none" stroke={color.mint} strokeOpacity={0.28} strokeWidth={3} strokeLinecap="round" />
    </Svg>
  );
}

export const COUNTDOWN_FROM = 3;
export const COUNTDOWN_TICK_MS = 1000;

/**
 * 3–2–1 倒數（Style 24.5；PG-U-01「倒數可跳過」）：點一下任何地方立即開始；返回鍵取消。
 * 每格一次 haptic（震動提示開啟時）與語音（語音提示開啟時）；減少動態時不縮放。
 */
function Countdown({ visible, voice, haptic, locale, onDone, onCancel }: { visible: boolean; voice: boolean; haptic: boolean; locale: 'zh-TW' | 'en'; onDone: () => void; onCancel: () => void }) {
  const { t } = useT();
  const reduceMotion = useReduceMotion();
  const [n, setN] = useState(COUNTDOWN_FROM);
  const scale = useRef(new Animated.Value(1)).current;
  const done = useRef(false);
  useEffect(() => {
    if (!visible) return;
    done.current = false;
    setN(COUNTDOWN_FROM);
    let current = COUNTDOWN_FROM;
    const tick = () => {
      if (haptic) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      if (voice) Speech.speak(String(current), { language: locale });
      if (!reduceMotion) {
        scale.setValue(1.35);
        Animated.timing(scale, { toValue: 1, duration: 500, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      }
    };
    tick();
    const id = setInterval(() => {
      current -= 1;
      if (current <= 0) {
        clearInterval(id);
        if (!done.current) {
          done.current = true;
          onDone();
        }
        return;
      }
      setN(current);
      tick();
    }, COUNTDOWN_TICK_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const skip = () => {
    if (done.current) return;
    done.current = true;
    onDone();
  };
  return (
    <Modal visible={visible} transparent={false} animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <Pressable style={styles.countdown} onPress={skip} accessibilityRole="button" accessibilityLabel={t('rec.countdown.skip')} accessibilityHint={t('rec.countdown.hint')} testID="start-countdown">
        <Animated.Text style={[styles.countdownNumber, { transform: [{ scale }] }]} accessibilityLiveRegion="assertive" maxFontSizeMultiplier={1.2} testID="start-countdown-number">
          {n}
        </Animated.Text>
        <Text variant="title" tone="secondary" style={styles.center}>
          {t('rec.countdown.skip')}
        </Text>
      </Pressable>
    </Modal>
  );
}

const fmtDist = (km: number) => km.toFixed(2);
const fmtTime = (min: number) => `${String(min).padStart(2, '0')}:00`;

/**
 * 開始頁（Style 24.5，參考 Nike Run Club 的版面；PG-U-01／R-12）：
 * 標題＋模式文字 tab（走路／健走／跑步，開始後固定）→ 中央大目標數字（點一下改目標）→ 鞋子／GPS 兩顆圓形 chip →
 * 齒輪（進階設定面板）＋大圓 START ＋ 語音提示開關 → 目標種類 pill（面板：距離／時間／自由＋清除）。
 * 目標快照存入 session、達標只提醒；室內不啟用 GPS。
 */
export function WorkoutStartScreen() {
  const { t, locale } = useT();
  const navigation = useNavigation();
  const prefs = useWorkoutPrefs();
  const shoeLevel = useDashboardStore((s) => (s.profile?.shoeLevel ?? 1) as 1 | 2 | 3 | 4 | 5);
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
  const [sheet, setSheet] = useState<'goal' | 'settings' | null>(null);
  const [counting, setCounting] = useState(false);

  /** 按下 START：先確認定位權限，再進 3–2–1 倒數；倒數結束（或點一下略過）才真正開始記錄 */
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (!(await workoutRecorder.ensurePermission())) {
        setErr({ kind: 'permission' });
        return;
      }
      setCounting(true);
    } finally {
      setBusy(false);
    }
  };
  const begin = async () => {
    setCounting(false);
    setBusy(true);
    try {
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

  const startDisabled = busy || env === 'indoor' || trackBlocked;
  const disabledReason = env === 'indoor' ? t('rec.indoorHint') : trackBlocked ? t('rec.track.blocked') : undefined;
  const goalValue = goalKind === 'distance' ? fmtDist(distKm) : goalKind === 'time' ? fmtTime(timeMin) : t('rec.goal.freeBig');
  const goalUnit = goalKind === 'distance' ? t('rec.goal.unit.km') : goalKind === 'time' ? t('rec.goal.unit.min') : t('rec.goal.freeHint');
  const goalA11y = goalKind === 'distance' ? t('rec.goal.km', { n: distKm }) : goalKind === 'time' ? t('rec.goal.min', { n: timeMin }) : t('rec.goal.free');

  return (
    <Screen testID="workout-start-screen">
      <Text variant="displayM">{t(`wo.mode.${mode}` as TKey)}</Text>
      <View style={styles.tabs} accessibilityRole="tablist">
        {(['walk', 'brisk', 'run'] as const).map((m) => (
          <Pressable key={m} onPress={() => setMode(m)} accessibilityRole="tab" accessibilityState={{ selected: mode === m }} style={styles.tab} testID={`start-mode-${m}`}>
            <Text variant="title" tone={mode === m ? undefined : 'muted'}>
              {t(`wo.mode.${m}` as TKey)}
            </Text>
            <View style={[styles.tabLine, mode === m && styles.tabLineOn]} />
          </Pressable>
        ))}
      </View>
      <Text variant="caption" tone="muted" style={styles.mtXs} testID="start-mode-hint">
        {t(`rec.modeHint.${mode}` as TKey)}
      </Text>

      <Pressable style={styles.hero} onPress={() => setSheet('goal')} accessibilityRole="button" accessibilityLabel={t('rec.goal.a11y', { goal: goalA11y })} accessibilityHint={t('rec.goal.a11yHint')} testID="start-goal-hero">
        <Backdrop />
        <Text style={styles.bigNumber} numeric maxFontSizeMultiplier={1.4} testID="start-goal-value">
          {goalValue}
        </Text>
        <View style={styles.underline} />
        <Text variant="title" tone="secondary" style={styles.center} testID="start-goal-unit">
          {goalUnit}
        </Text>
        {goalKind !== 'free' ? (
          <Text variant="caption" tone="muted" style={[styles.center, styles.mtXs]}>
            {t('rec.goalHint')}
          </Text>
        ) : null}
      </Pressable>

      <View style={styles.chipRow}>
        <Pressable onPress={() => navigation.navigate('Main', { screen: 'Gear' })} style={styles.roundChip} accessibilityRole="button" accessibilityLabel={t('rec.shoe', { n: shoeLevel })} testID="start-shoe">
          <ShoeHero level={shoeLevel} size={64} badge={false} active={false} />
        </Pressable>
        <Pressable onPress={() => setEnv(env === 'outdoor' ? 'indoor' : 'outdoor')} style={[styles.roundChip, env === 'outdoor' && styles.roundChipOn]} accessibilityRole="switch" accessibilityState={{ checked: env === 'outdoor' }} accessibilityLabel={t('rec.env.outdoor')} accessibilityHint={t('rec.env.toggleHint')} testID="start-env">
          <Feather name={env === 'outdoor' ? 'radio' : 'wifi-off'} size={24} color={env === 'outdoor' ? color.mint : color.textMuted} />
          <Text variant="caption" tone={env === 'outdoor' ? 'primary' : 'muted'} testID="start-env-label">
            {env === 'outdoor' ? t('rec.env.gpsOn') : t('rec.env.indoor')}
          </Text>
        </Pressable>
      </View>

      <View style={styles.controls}>
        <Pressable onPress={() => setSheet('settings')} style={styles.sideButton} accessibilityRole="button" accessibilityLabel={t('rec.settings')} testID="start-settings">
          <Feather name="settings" size={26} color={color.textPrimary} />
        </Pressable>
        <Pressable onPress={() => void go()} disabled={startDisabled} accessibilityRole="button" accessibilityLabel={busy ? t('rec.starting') : t('rec.go')} accessibilityState={{ disabled: startDisabled, busy }} style={({ pressed }) => [styles.startButton, !startDisabled && glowStyle('hero', color.mint), startDisabled && styles.startDisabled, pressed && !startDisabled && styles.startPressed]} testID="start-go">
          <Text style={[styles.startLabel, startDisabled && styles.startLabelDisabled]} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.3} uppercase>
            {busy ? t('rec.starting') : t('rec.go')}
          </Text>
        </Pressable>
        <Pressable onPress={() => void prefs.set({ voice: !prefs.voice })} style={styles.sideButton} accessibilityRole="switch" accessibilityState={{ checked: prefs.voice }} accessibilityLabel={t('rec.cue.voice')} testID="start-cue-voice">
          <Feather name={prefs.voice ? 'volume-2' : 'volume-x'} size={26} color={prefs.voice ? color.mint : color.textPrimary} />
        </Pressable>
      </View>

      <Pressable onPress={() => setSheet('goal')} style={styles.pill} accessibilityRole="button" accessibilityLabel={t('rec.goal')} testID="start-goal-pill">
        <Text variant="title">{t(`rec.goal.${goalKind}` as TKey)}</Text>
        <Feather name="chevron-up" size={18} color={color.textSecondary} />
      </Pressable>
      {disabledReason ? (
        <Text variant="caption" tone="muted" style={[styles.center, styles.mtXs]} testID="start-disabled-reason">
          {disabledReason}
        </Text>
      ) : null}
      {env === 'indoor' ? <InlineState kind="info" title={t('rec.indoorHint')} action={{ label: t('wo.import'), onPress: () => navigation.navigate('Workouts') }} testID="start-indoor" /> : null}
      {err?.kind === 'permission' ? <InlineState kind="warning" title={t('rec.permissionTitle')} body={t('rec.permissionBody')} action={{ label: t('rec.permissionOpen'), onPress: () => void Linking.openSettings() }} testID="start-permission" /> : null}
      {err?.kind === 'generic' ? <InlineState kind="error" title={t('rec.err', { message: err.message ?? '' })} testID="start-error" /> : null}

      <Countdown visible={counting} voice={prefs.voice} haptic={prefs.haptic} locale={locale === 'zh-TW' ? 'zh-TW' : 'en'} onDone={() => void begin()} onCancel={() => setCounting(false)} />

      <Sheet visible={sheet === 'goal'} onClose={() => setSheet(null)} title={t('rec.goal')} testID="start-goal-sheet">
        {(['distance', 'time', 'free'] as const).map((g) => (
          <View key={g}>
            <Pressable onPress={() => setGoalKind(g)} style={styles.sheetRow} accessibilityRole="radio" accessibilityState={{ selected: goalKind === g }} testID={`start-goal-${g}`}>
              <Text variant="heading2" tone={goalKind === g ? undefined : 'muted'}>
                {t(`rec.goal.${g}` as TKey)}
              </Text>
              {goalKind === g ? <Feather name="check" size={22} color={color.mint} /> : null}
            </Pressable>
            {g === 'distance' && goalKind === 'distance' ? <Segmented items={DIST_PRESETS.map((k) => ({ value: String(k), label: t('rec.goal.km', { n: k }) }))} value={String(distKm)} onChange={(v) => setDistKm(Number(v))} testID="start-goal-dist" /> : null}
            {g === 'time' && goalKind === 'time' ? <Segmented items={TIME_PRESETS.map((m) => ({ value: String(m), label: t('rec.goal.min', { n: m }) }))} value={String(timeMin)} onChange={(v) => setTimeMin(Number(v))} testID="start-goal-time" /> : null}
          </View>
        ))}
        <Text variant="caption" tone="muted" style={styles.mt}>
          {t('rec.goalHint')}
        </Text>
        <View style={styles.sheetActions}>
          <Button label={t('rec.goal.clear')} variant="secondary" onPress={() => setGoalKind('free')} style={styles.flex} testID="start-goal-clear" />
          <Button label={t('common.done')} onPress={() => setSheet(null)} style={styles.flex} testID="start-goal-done" />
        </View>
      </Sheet>

      <Sheet visible={sheet === 'settings'} onClose={() => setSheet(null)} title={t('rec.settings')} testID="start-settings-sheet">
        <Text variant="label" tone="muted" uppercase>
          {t('rec.env')}
        </Text>
        <Segmented items={[{ value: 'outdoor', label: t('rec.env.outdoor') }, { value: 'indoor', label: t('rec.env.indoor') }]} value={env} onChange={setEnv} testID="start-env" />
        <Text variant="label" tone="muted" uppercase style={styles.mt}>
          {t('rec.autoLap')}
        </Text>
        <Segmented items={(['off', '400', '1000'] as const).map((v) => ({ value: v, label: t(`rec.autoLap.${v}` as TKey) }))} value={autoLap} onChange={setAutoLap} testID="start-autolap" />
        <Text variant="label" tone="muted" uppercase style={styles.mt}>
          {t('rec.units')}
        </Text>
        <Segmented items={[{ value: 'km', label: t('rec.units.km') }, { value: 'mi', label: t('rec.units.mi') }]} value={units} onChange={setUnits} testID="start-units" />
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
          {t('rec.track')}
        </Text>
        <View testID="start-track-card">
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
        </View>
        <View style={styles.sheetActions}>
          <Button label={t('common.done')} onPress={() => setSheet(null)} style={styles.flex} testID="start-settings-done" />
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  mt: { marginTop: space.m },
  flex: { flex: 1 },
  mtXs: { marginTop: space.xs },
  center: { textAlign: 'center' },
  countdown: { flex: 1, backgroundColor: color.canvas, alignItems: 'center', justifyContent: 'center', gap: space.xl },
  countdownNumber: { fontSize: 200, lineHeight: 220, fontWeight: '800', fontStyle: 'italic', color: color.mint, fontVariant: ['tabular-nums'], textAlign: 'center' },
  tabs: { flexDirection: 'row', marginTop: space.s },
  tab: { marginRight: space.l, paddingVertical: space.xs, minHeight: 48, justifyContent: 'center' },
  tabLine: { height: 2, marginTop: space.xxs, backgroundColor: 'transparent', borderRadius: 1 },
  tabLineOn: { backgroundColor: color.mint },
  hero: { flex: 1, minHeight: 200, alignItems: 'center', justifyContent: 'center', marginTop: space.s, borderRadius: radius.l, overflow: 'hidden' },
  bigNumber: { fontSize: 88, lineHeight: 96, fontWeight: '800', fontStyle: 'italic', letterSpacing: -2, color: color.textPrimary, fontVariant: ['tabular-nums'], textAlign: 'center' },
  underline: { width: 160, height: 3, backgroundColor: color.textPrimary, marginTop: space.xxs, marginBottom: space.s, borderRadius: 2 },
  chipRow: { flexDirection: 'row', justifyContent: 'center', gap: space.l, marginTop: space.s },
  roundChip: { width: 84, height: 84, borderRadius: 42, backgroundColor: color.surface, borderWidth: 1, borderColor: color.borderSubtle, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  roundChipOn: { borderColor: color.borderActive },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.l },
  sideButton: { width: 64, height: 64, borderRadius: 32, backgroundColor: color.surface, borderWidth: 1, borderColor: color.borderSubtle, alignItems: 'center', justifyContent: 'center' },
  startButton: { width: 168, height: 168, borderRadius: 84, backgroundColor: color.mint, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.m },
  startPressed: { opacity: 0.85 },
  startDisabled: { backgroundColor: color.elevated, borderWidth: 1, borderColor: color.borderSubtle },
  startLabel: { width: '100%', textAlign: 'center', fontSize: 32, lineHeight: 40, fontWeight: '800', fontStyle: 'italic', letterSpacing: 1, color: color.onMint },
  startLabelDisabled: { color: color.textMuted },
  pill: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: space.xxs, marginTop: space.m, minHeight: 48, paddingHorizontal: space.l, borderRadius: radius.xl, backgroundColor: color.surface, borderWidth: 1, borderColor: color.borderSubtle },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.xs, minHeight: 48 },
  rowLabel: { flex: 1, marginRight: space.s },
  input: { marginTop: space.xs, minHeight: 48, borderWidth: 1, borderColor: color.borderSubtle, borderRadius: radius.m, paddingHorizontal: space.s, color: color.textPrimary, fontSize: 18, backgroundColor: color.elevated },
  segment: { flexDirection: 'row', borderWidth: 1, borderColor: color.borderSubtle, borderRadius: radius.m, overflow: 'hidden', marginTop: space.xs },
  segmentItem: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { backgroundColor: color.mint },
  segmentOnText: { color: color.onMint },
  scrim: { flex: 1, backgroundColor: color.scrim, justifyContent: 'flex-end' },
  sheetWrap: { width: '100%', maxHeight: '100%' },
  sheet: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, paddingBottom: space.xxl, maxHeight: '88%' },
  sheetBody: { flexGrow: 0 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.xs },
  sheetClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  sheetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 56, borderBottomWidth: 1, borderBottomColor: color.borderSubtle },
  sheetActions: { flexDirection: 'row', gap: space.s, marginTop: space.l },
});
