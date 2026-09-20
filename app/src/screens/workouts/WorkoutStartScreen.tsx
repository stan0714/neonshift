import { useAppearance } from '@/hooks/useAppearance';
import { RouteAppearancePicker } from '@/components/RouteAppearancePicker';
import { Feather } from '@expo/vector-icons';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { Animated, Easing, Linking, Modal, PermissionsAndroid, Platform, Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';

import { Button, InlineState, Screen, Sheet } from '@/components';
import { ShoeHero } from '@/components/ShoeHero';
import { WorkoutActionArt } from '@/components/WorkoutActionMotion';
import { SPLIT_KM_MM, SPLIT_MILE_MM, TRACK_LAP_MAX_M, TRACK_LAP_MIN_M } from '@/domain/gps/engine';
import { profileOf, snapPreset } from '@/domain/modes';
import { formatDuration } from '@/domain/workouts';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { useT, type TKey } from '@/i18n';
import type { WorkoutGoal } from '@/services/api/ApiClient';
import { ensureWorkoutChannel, type WorkoutChannelState } from '@/services/workouts/notificationChannel';
import { workoutRecorder } from '@/services/workouts/WorkoutRecorder';
import { appearanceLevel, highestOwnedLevel, resolveTraceLayer, shoeSnapshotOf } from '@/domain/appearance';
import { useAppearanceStore } from '@/state/appearanceStore';
import { useDashboardStore } from '@/state/dashboardStore';
import { useWalletStore } from '@/state/walletStore';
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

/** 目標可自訂範圍（實機回饋：不應只能選預設）：距離 0.5～100 km（0.1 km 精度、±0.5 步進）、時間 1～600 分（±5 步進） */
export const GOAL_RANGE = { distKm: { min: 0.5, max: 100, step: 0.5 }, timeMin: { min: 1, max: 600, step: 5 } } as const;
const clampGoal = (v: number, r: { min: number; max: number }) => Math.min(r.max, Math.max(r.min, v));

/** 預設 Segmented 下方的 −／數值輸入／＋ 列；輸入框失焦或按鈕時才寫回（保留使用者打到一半的字） */
function Stepper({ value, onChange, range, decimals, unit, testID }: { value: number; onChange: (v: number) => void; range: { min: number; max: number; step: number }; decimals: number; unit: string; testID: string }) {
  const { t } = useT();
  const [text, setText] = useState(String(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setText(decimals ? String(Number(value.toFixed(decimals))) : String(value)); }, [value, editing, decimals]);
  const commit = () => {
    setEditing(false);
    const n = Number(text.replace(/[^0-9.]/g, ''));
    if (Number.isFinite(n) && n > 0) onChange(clampGoal(Number(n.toFixed(decimals)), range));
    else setText(String(value));
  };
  const bump = (dir: -1 | 1) => onChange(clampGoal(Number((value + dir * range.step).toFixed(decimals)), range));
  return (
    <View style={styles.stepper} testID={testID}>
      <Pressable onPress={() => bump(-1)} disabled={value <= range.min} style={[styles.stepBtn, value <= range.min && styles.stepBtnOff]} accessibilityRole="button" accessibilityLabel={t('rec.goal.decrease')} testID={`${testID}-minus`}>
        <Feather name="minus" size={22} color={value <= range.min ? color.textMuted : color.textPrimary} />
      </Pressable>
      <View style={styles.stepMid}>
        <TextInput value={text} onChangeText={setText} onFocus={() => setEditing(true)} onBlur={commit} onSubmitEditing={commit} keyboardType={decimals ? 'decimal-pad' : 'number-pad'} maxLength={6} selectTextOnFocus style={styles.stepInput} accessibilityLabel={t('rec.goal.customLabel')} testID={`${testID}-input`} />
        <Text variant="bodySmall" tone="secondary">{unit}</Text>
      </View>
      <Pressable onPress={() => bump(1)} disabled={value >= range.max} style={[styles.stepBtn, value >= range.max && styles.stepBtnOff]} accessibilityRole="button" accessibilityLabel={t('rec.goal.increase')} testID={`${testID}-plus`}>
        <Feather name="plus" size={22} color={value >= range.max ? color.textMuted : color.textPrimary} />
      </Pressable>
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
export function goalOf(kind: GoalChoice, timeMin: number, distKm: number): WorkoutGoal {
  if (kind === 'time') return { kind: 'time', target: timeMin * 60, unit: 's', version: GOAL_VERSION };
  if (kind === 'distance') return { kind: 'distance', target: Math.round(distKm * 1_000_000), unit: 'mm', version: GOAL_VERSION };
  return FREE_GOAL;
}


/** 背景：抽象街區格線＋一條路線（不畫真實地圖；地圖供應商未定） */
function Backdrop({ accent, variant }: { accent: string; variant: 'walk' | 'brisk' | 'run' }) {
  // 三模式不同路線形狀：走路＝公園小圈、健走＝河濱來回、跑步＝長距離折線
  const path = variant === 'walk' ? 'M60 230 C40 170 120 130 170 160 S250 230 200 262 S80 280 60 230' : variant === 'brisk' ? 'M20 250 C90 190 140 210 200 150 S280 90 318 60 M318 70 C260 110 220 170 150 200 S60 240 24 262' : 'M28 236 C70 214 96 262 138 232 S206 150 250 168 S300 118 318 96';
  return (
    <Svg width="100%" height="100%" viewBox="0 0 320 320" preserveAspectRatio="xMidYMid slice" style={StyleSheet.absoluteFill} pointerEvents="none">
      {[40, 100, 160, 220, 280].map((y) => (
        <Line key={`h${y}`} x1="0" y1={y} x2="320" y2={y + 18} stroke={color.borderSubtle} strokeOpacity={0.45} />
      ))}
      {[30, 90, 150, 210, 270].map((x) => (
        <Line key={`v${x}`} x1={x} y1="0" x2={x - 22} y2="320" stroke={color.borderSubtle} strokeOpacity={0.45} />
      ))}
      <Path d={path} fill="none" stroke={accent} strokeOpacity={0.32} strokeWidth={3} strokeLinecap="round" />
    </Svg>
  );
}

export const COUNTDOWN_FROM = 3;
export const COUNTDOWN_TICK_MS = 1000;

/**
 * 3–2–1 倒數（Style 24.5；PG-U-01「倒數可跳過」）：點一下任何地方立即開始；返回鍵取消。
 * 每格一次 haptic（震動提示開啟時）與語音（語音提示開啟時）；減少動態時不縮放。
 */
function Countdown({ mode, visible, voice, haptic, locale, onDone, onCancel }: { mode: WorkoutMode; visible: boolean; voice: boolean; haptic: boolean; locale: 'zh-TW' | 'en'; onDone: () => void; onCancel: () => void }) {
  const { t } = useT();
  const reduceMotion = useReduceMotion();
  const [n, setN] = useState(COUNTDOWN_FROM);
  const scale = useRef(new Animated.Value(1)).current;
  const done = useRef(false);
  useEffect(() => {
    if (reduceMotion) { scale.stopAnimation(); scale.setValue(1); }
    return () => scale.stopAnimation();
  }, [reduceMotion, scale]);
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
        <WorkoutActionArt key={`${mode}-${n}`} mode={mode} action="start">
        <Animated.Text style={[styles.countdownNumber, { color: profileOf(mode).accent, fontSize: 96, lineHeight: 110, transform: [{ scale }] }]} accessibilityLiveRegion="assertive" maxFontSizeMultiplier={1.2} testID="start-countdown-number">
          {n}
        </Animated.Text>
        </WorkoutActionArt>
        <Text variant="heading2" style={styles.center}>{t(`rec.motion.${mode}.start` as TKey)}</Text>
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
  const { level: shoeLevel } = useAppearance();
  const [mode, setMode] = useState<WorkoutMode>(prefs.mode);
  const [goalKind, setGoalKind] = useState<GoalChoice>(prefs.goal.kind);
  const [timeMin, setTimeMin] = useState<number>(prefs.goal.kind === 'time' ? Math.round(prefs.goal.target / 60) : 20);
  const [distKm, setDistKm] = useState<number>(prefs.goal.kind === 'distance' ? prefs.goal.target / 1_000_000 : 3);
  useEffect(() => {
    if (prefs.loaded) return;
    void prefs.load().then((p) => { setMode(p.mode); setGoalKind(p.goal.kind); if (p.goal.kind === 'time') setTimeMin(Math.round(p.goal.target / 60)); if (p.goal.kind === 'distance') setDistKm(p.goal.target / 1_000_000); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // review 6：已有進行中的運動 → 直接回到該 session，不在這裡再開一場（recorder 也會擋，但使用者不該看到錯誤）
  useEffect(() => {
    if (workoutRecorder.active()) navigation.navigate('WorkoutRecord');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { sport, intent } = modeToSport(mode);
  const profile = profileOf(mode);
  const [env, setEnv] = useState<'outdoor' | 'indoor'>('outdoor');
  const [autoLap, setAutoLap] = useState<'off' | '400' | '1000'>(profile.autoLapDefault);
  /** 換模式：目標預設值對齊新模式選項、自動圈改為該模式預設 */
  const changeMode = (m: WorkoutMode) => {
    const next = profileOf(m);
    setMode(m);
    // 只在目前值是舊模式的預設時才對齊新模式；使用者自訂的值保留
    setTimeMin((v) => (profile.timePresets.includes(v) ? snapPreset(v, next.timePresets) : v));
    setDistKm((v) => (profile.distPresets.includes(v) ? snapPreset(v, next.distPresets) : v));
    setAutoLap(next.autoLapDefault);
  };
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
  // 開始前 GPS 就緒指示（實機回饋：無 SIM 的 Seeker 冷開機定位要 1–2 分鐘，直接開跑會 0 km）：戶外＋頁面聚焦時預熱定位並顯示精度
  const focused = useIsFocused();
  const [gpsReady, setGpsReady] = useState<{ acc: number } | null>(null);
  useEffect(() => {
    if (env !== 'outdoor' || !focused || counting) { setGpsReady(null); return; }
    let sub: { remove: () => void } | null = null;
    let cancelled = false;
    (async () => {
      const perm = await Location.getForegroundPermissionsAsync().catch(() => null);
      if (!perm?.granted || cancelled) return;
      const created = await Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, timeInterval: 2000, distanceInterval: 0 }, (l) => {
        if (!cancelled) setGpsReady({ acc: l.coords.accuracy ?? Number.POSITIVE_INFINITY });
      }).catch(() => null);
      // 訂閱建立完成前就已離開／開始倒數：立刻移除，不讓預熱訂閱與記錄用的定位任務並存
      if (cancelled) created?.remove();
      else sub = created;
    })();
    return () => { cancelled = true; sub?.remove(); };
  }, [env, focused, counting]);
  const gpsReadyState = env !== 'outdoor' ? null : gpsReady === null ? 'searching' : gpsReady.acc <= 20 ? 'ready' : 'weak';
  const [channel, setChannel] = useState<WorkoutChannelState | null>(null);

  /** 按下 START：先確認定位權限，再進 3–2–1 倒數；倒數結束（或點一下略過）才真正開始記錄 */
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (!(await workoutRecorder.ensurePermission())) {
        setErr({ kind: 'permission' });
        return;
      }
      // Android 13+：沒有通知權限就看不到「記錄中」常駐通知（實機回饋：退到背景後不知道 App 還在跑）；拒絕仍可記錄
      if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
        await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(() => null);
      }
      // 頻道先以 DEFAULT 建好，常駐通知才會有狀態列圖示、不落在靜音區；被使用者靜音或關閉通知 → 提示（仍可記錄）
      setChannel(ensureWorkoutChannel({ name: t('rec.notif.channelName'), description: t('rec.notif.channelDesc') }));
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
      const modeName = t(`wo.mode.${mode}` as TKey);
      workoutRecorder.setForegroundText((snap) => ({
        title: snap.state === 'paused' ? t('rec.notif.paused', { mode: modeName }) : t('rec.notif.recording', { mode: modeName }),
        body: t('rec.notif.body', { km: (snap.distanceMm / 1_000_000).toFixed(2), time: formatDuration(String(snap.elapsedMs)) }),
      }));
      // PG-LINK-01：記下開始時的跑鞋外觀（未綁定玩家 → null 未指定）；PG-LINK-02：綁定玩家
      const owner = useWalletStore.getState().session?.address ?? null;
      const shoeSnapshot = shoeSnapshotOf(owner, useDashboardStore.getState().profile, useAppearanceStore.getState().selectedShoeId);
      const routeAppearance = { version: 1 as const, layer: resolveTraceLayer(prefs.traceLayer, appearanceLevel(useDashboardStore.getState().profile, useAppearanceStore.getState().selectedShoeId), highestOwnedLevel(useDashboardStore.getState().profile)) };
      await workoutRecorder.start({ sport, intent, goal, environment: env, autoLapMm: autoLap === 'off' ? null : Number(autoLap) * 1000, trackLapMm: trackLapM === null ? null : trackLapM * 1000, splitLengthMm: units === 'km' ? SPLIT_KM_MM : SPLIT_MILE_MM, autoPause: prefs.autoPause, shoeSnapshot, routeAppearance, owner });
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
  const goalUnit = goalKind === 'distance' ? t('rec.goal.unit.km') : goalKind === 'time' ? t('rec.goal.unit.min') : t(`rec.goal.freeHint.${mode}` as TKey);
  const goalA11y = goalKind === 'distance' ? t('rec.goal.km', { n: distKm }) : goalKind === 'time' ? t('rec.goal.min', { n: timeMin }) : t('rec.goal.free');

  return (
    <Screen testID="workout-start-screen">
      <View style={styles.titleRow}>
        <View style={[styles.modeIcon, { borderColor: profile.accent }]}>
          <Feather name={profile.icon} size={22} color={profile.accent} />
        </View>
        <Text variant="displayM">{t(`wo.mode.${mode}` as TKey)}</Text>
      </View>
      <View style={styles.tabs} accessibilityRole="tablist">
        {(['walk', 'brisk', 'run'] as const).map((m) => (
          <Pressable key={m} onPress={() => changeMode(m)} accessibilityRole="tab" accessibilityState={{ selected: mode === m }} style={styles.tab} testID={`start-mode-${m}`}>
            <View style={styles.tabInner}>
              <Feather name={profileOf(m).icon} size={16} color={mode === m ? profileOf(m).accent : color.textMuted} />
              <Text variant="title" tone={mode === m ? undefined : 'muted'}>
                {t(`wo.mode.${m}` as TKey)}
              </Text>
            </View>
            <View style={[styles.tabLine, mode === m && { backgroundColor: profileOf(m).accent }]} />
          </Pressable>
        ))}
      </View>
      {/* 模式樣態：主指標、目標預設、自動圈、建議區間（Style 24.6） */}
      <View style={styles.traits} testID="start-mode-hint">
        <Text variant="caption" tone={profile.accentTone}>{t(`rec.trait.primary.${profile.primary}` as TKey)}</Text>
        <Text variant="caption" tone="muted"> · {t('rec.trait.autoLap', { v: t(`rec.autoLap.${profile.autoLapDefault}` as TKey) })}</Text>
        {profile.speedZoneKmh ? <Text variant="caption" tone="muted"> · {t('rec.trait.zone', { lo: profile.speedZoneKmh[0], hi: profile.speedZoneKmh[1] })}</Text> : null}
      </View>
      <Text variant="caption" tone="muted" style={styles.mtXs}>
        {t(`rec.modeHint.${mode}` as TKey)}
      </Text>

      <Pressable style={styles.hero} onPress={() => setSheet('goal')} accessibilityRole="button" accessibilityLabel={t('rec.goal.a11y', { goal: goalA11y })} accessibilityHint={t('rec.goal.a11yHint')} testID="start-goal-hero">
        <Backdrop accent={profile.accent} variant={mode} />
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
        <Pressable onPress={() => setEnv(env === 'outdoor' ? 'indoor' : 'outdoor')} style={[styles.roundChip, env === 'outdoor' && { borderColor: profile.accent }]} accessibilityRole="switch" accessibilityState={{ checked: env === 'outdoor' }} accessibilityLabel={t('rec.env.outdoor')} accessibilityHint={t('rec.env.toggleHint')} testID="start-env">
          <Feather name={env === 'outdoor' ? 'radio' : 'wifi-off'} size={24} color={env === 'outdoor' ? profile.accent : color.textMuted} />
          <Text variant="caption" tone={env === 'outdoor' ? 'primary' : 'muted'} testID="start-env-label">
            {env === 'outdoor' ? t('rec.env.gpsOn') : t('rec.env.indoor')}
          </Text>
        </Pressable>
      </View>
      {gpsReadyState ? (
        <View style={styles.gpsReadyRow} testID={`start-gps-${gpsReadyState}`}>
          <Feather name={gpsReadyState === 'ready' ? 'check-circle' : gpsReadyState === 'weak' ? 'alert-circle' : 'loader'} size={14} color={gpsReadyState === 'ready' ? color.mint : gpsReadyState === 'weak' ? color.warning : color.textMuted} />
          <Text variant="caption" tone={gpsReadyState === 'ready' ? 'mint' : gpsReadyState === 'weak' ? 'warning' : 'muted'}>
            {t(`rec.gpsReady.${gpsReadyState}` as TKey, { acc: gpsReady && Number.isFinite(gpsReady.acc) ? String(Math.round(gpsReady.acc)) : '—' })}
            {gpsReadyState !== 'ready' ? ` · ${t('rec.gpsReady.hint')}` : ''}
          </Text>
        </View>
      ) : null}

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
      {channel && (channel.silenced || !channel.appNotificationsEnabled) ? <InlineState kind="warning" title={t('rec.notif.silencedTitle')} body={t(channel.appNotificationsEnabled ? 'rec.notif.silencedBody' : 'rec.notif.disabledBody')} action={{ label: t('rec.permissionOpen'), onPress: () => void Linking.openSettings() }} testID="start-notif-silenced" /> : null}
      {err?.kind === 'generic' ? <InlineState kind="error" title={t('rec.err', { message: err.message ?? '' })} testID="start-error" /> : null}

      <Countdown mode={mode} visible={counting} voice={prefs.voice} haptic={prefs.haptic} locale={locale === 'zh-TW' ? 'zh-TW' : 'en'} onDone={() => void begin()} onCancel={() => setCounting(false)} />

      <Sheet
        visible={sheet === 'goal'}
        onClose={() => setSheet(null)}
        title={t('rec.goal')}
        testID="start-goal-sheet"
        footer={
          <>
            <Button label={t('rec.goal.clear')} variant="secondary" onPress={() => setGoalKind('free')} style={styles.flex} testID="start-goal-clear" />
            <Button label={t('common.done')} onPress={() => setSheet(null)} style={styles.flex} testID="start-goal-done" />
          </>
        }
      >
        {(['distance', 'time', 'free'] as const).map((g) => (
          <View key={g}>
            <Pressable onPress={() => setGoalKind(g)} style={styles.sheetRow} accessibilityRole="radio" accessibilityState={{ selected: goalKind === g }} testID={`start-goal-${g}`}>
              <Text variant="heading2" tone={goalKind === g ? undefined : 'muted'}>
                {t(`rec.goal.${g}` as TKey)}
              </Text>
              {goalKind === g ? <Feather name="check" size={22} color={color.mint} /> : null}
            </Pressable>
            {g === 'distance' && goalKind === 'distance' ? (
              <>
                <Segmented items={profile.distPresets.map((k) => ({ value: String(k), label: t('rec.goal.km', { n: k }) }))} value={String(distKm)} onChange={(v) => setDistKm(Number(v))} testID="start-goal-dist" />
                <Stepper value={distKm} onChange={setDistKm} range={GOAL_RANGE.distKm} decimals={1} unit={t('rec.goal.unit.km')} testID="start-goal-dist-custom" />
              </>
            ) : null}
            {g === 'time' && goalKind === 'time' ? (
              <>
                <Segmented items={profile.timePresets.map((m) => ({ value: String(m), label: t('rec.goal.min', { n: m }) }))} value={String(timeMin)} onChange={(v) => setTimeMin(Number(v))} testID="start-goal-time" />
                <Stepper value={timeMin} onChange={setTimeMin} range={GOAL_RANGE.timeMin} decimals={0} unit={t('rec.goal.unit.min')} testID="start-goal-time-custom" />
              </>
            ) : null}
          </View>
        ))}
        <Text variant="caption" tone="muted" style={styles.mt}>
          {t('rec.goalHint')}
        </Text>
      </Sheet>

      <Sheet
        visible={sheet === 'settings'}
        onClose={() => setSheet(null)}
        title={t('rec.settings')}
        testID="start-settings-sheet"
        footer={<Button label={t('common.done')} onPress={() => setSheet(null)} style={styles.flex} testID="start-settings-done" />}
      >
        <RouteAppearancePicker />
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
            {t('rec.autoPause')}
          </Text>
          <Switch value={prefs.autoPause} onValueChange={(v) => void prefs.set({ autoPause: v })} trackColor={{ true: color.mint, false: color.borderSubtle }} thumbColor={color.textPrimary} accessibilityLabel={t('rec.autoPause')} testID="start-autopause" />
        </View>
        <Text variant="caption" tone="muted">
          {t('rec.autoPause.hint')}
        </Text>
        <View style={styles.row}>
          <Text variant="bodySmall" style={styles.rowLabel}>
            {t('rec.keepAwake')}
          </Text>
          <Switch value={prefs.keepAwake} onValueChange={(v) => void prefs.set({ keepAwake: v })} trackColor={{ true: color.mint, false: color.borderSubtle }} thumbColor={color.textPrimary} accessibilityLabel={t('rec.keepAwake')} testID="start-keepawake" />
        </View>
        <Text variant="caption" tone="muted">
          {t('rec.keepAwake.hint')}
        </Text>
        <View style={styles.row}>
          <Text variant="bodySmall" style={styles.rowLabel}>
            {t('rec.detailView')}
          </Text>
          <Switch value={prefs.detailView} onValueChange={(v) => void prefs.set({ detailView: v })} trackColor={{ true: color.mint, false: color.borderSubtle }} thumbColor={color.textPrimary} accessibilityLabel={t('rec.detailView')} testID="start-detailview" />
        </View>
        <Text variant="caption" tone="muted">
          {t('rec.detailView.hint')}
        </Text>
        <View style={styles.row}>
          <Text variant="bodySmall" style={styles.rowLabel}>
            {t('rec.cue.haptic')}
          </Text>
          <Switch value={prefs.haptic} onValueChange={(v) => void prefs.set({ haptic: v })} trackColor={{ true: color.mint, false: color.borderSubtle }} thumbColor={color.textPrimary} accessibilityLabel={t('rec.cue.haptic')} testID="start-cue-haptic" />
        </View>
        <Text variant="label" tone="muted" uppercase style={styles.mt}>
          {t('rec.cue.every')}
        </Text>
        <Segmented items={(['500', '1000', 'half'] as const).map((v) => ({ value: v, label: t(`rec.cue.every.${v}` as TKey) }))} value={prefs.cueEvery} onChange={(v) => void prefs.set({ cueEvery: v })} testID="start-cue-every" />
        <Text variant="caption" tone="muted" style={styles.mtXs}>
          {goalKind === 'distance' || prefs.cueEvery !== 'half' ? t('rec.cue.hint') : t('rec.cue.halfNeedsGoal')}
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
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  gpsReadyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs, paddingHorizontal: space.l, marginTop: space.xs },
  mt: { marginTop: space.m },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.s, marginTop: space.s, marginBottom: space.xs },
  stepBtn: { width: 48, height: 48, borderRadius: radius.m, borderWidth: 1, borderColor: color.borderSubtle, alignItems: 'center', justifyContent: 'center', backgroundColor: color.elevated },
  stepBtnOff: { opacity: 0.4 },
  stepMid: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs, minHeight: 48, borderWidth: 1, borderColor: color.borderSubtle, borderRadius: radius.m, backgroundColor: color.elevated, paddingHorizontal: space.s },
  stepInput: { minWidth: 72, textAlign: 'center', color: color.textPrimary, fontSize: 22, fontWeight: '700', paddingVertical: 0 },
  flex: { flex: 1 },
  mtXs: { marginTop: space.xs },
  center: { textAlign: 'center' },
  countdown: { flex: 1, backgroundColor: color.canvas, alignItems: 'center', justifyContent: 'center', gap: space.xl },
  countdownNumber: { fontSize: 200, lineHeight: 220, fontWeight: '800', fontStyle: 'italic', color: color.mint, fontVariant: ['tabular-nums'], textAlign: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  modeIcon: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: color.surface },
  tabs: { flexDirection: 'row', marginTop: space.s },
  tab: { marginRight: space.l, paddingVertical: space.xs, minHeight: 48, justifyContent: 'center' },
  tabInner: { flexDirection: 'row', alignItems: 'center', gap: space.xxs },
  tabLine: { height: 2, marginTop: space.xxs, backgroundColor: 'transparent', borderRadius: 1 },
  traits: { flexDirection: 'row', flexWrap: 'wrap', marginTop: space.xs },
  hero: { flex: 1, minHeight: 200, alignItems: 'center', justifyContent: 'center', marginTop: space.s, borderRadius: radius.l, overflow: 'hidden' },
  bigNumber: { fontSize: 88, lineHeight: 96, fontWeight: '800', fontStyle: 'italic', letterSpacing: -2, color: color.textPrimary, fontVariant: ['tabular-nums'], textAlign: 'center' },
  underline: { width: 160, height: 3, backgroundColor: color.textPrimary, marginTop: space.xxs, marginBottom: space.s, borderRadius: 2 },
  chipRow: { flexDirection: 'row', justifyContent: 'center', gap: space.l, marginTop: space.s },
  roundChip: { width: 84, height: 84, borderRadius: 42, backgroundColor: color.surface, borderWidth: 1, borderColor: color.borderSubtle, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
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
  sheetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 56, borderBottomWidth: 1, borderBottomColor: color.borderSubtle },
});
