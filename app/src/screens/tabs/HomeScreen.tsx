import { Feather } from '@expo/vector-icons';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Chip, DataCard, InlineState, MissionCard, Wordmark } from '@/components';
import { HabitatScene } from '@/components/HabitatScene';
import { ShoeHero } from '@/components/ShoeHero';
import { useAppearance } from '@/hooks/useAppearance';
import { maintenanceNeeds } from '@/chain/accounts';
import { APP_CONFIG } from '@/config/app';
import { secondsUntilUtcMidnight, type TaskType } from '@/domain/taskEngine';
import type { ClaimInput, ClaimPhase } from '@/services/claim/ClaimFlow';
import { estimateReward, formatTskr, sleepProgress, stepsProgress, useDashboardStore, workoutProgress } from '@/state/dashboardStore';
import { healthConnect, type HealthPermissionSummary } from '@/services/health/HealthConnectService';
import { useLevelRevealStore } from '@/state/levelRevealStore';
import { modeOfIntent, useWorkoutPrefs } from '@/state/workoutPrefsStore';
import { workoutRecorder } from '@/services/workouts/WorkoutRecorder';
import { formatDuration, formatKm, modeLabel } from '@/domain/workouts';
import { shortAddress, useWalletStore } from '@/state/walletStore';
import { color, radius, space, Text, useTheme, glowStyle } from '@/theme';

import { ClockInSheet } from './ClockInSheet';
import { useT, type TKey } from '@/i18n';
import { FEATURES } from '@/config/features';

const OUTDATED_MS = 30 * 60 * 1000;

/**
 * Dashboard（PG-A-12，Style 11）：Header → Today summary → Shoe hero → Mission cards → CTA。
 * 打卡按鈕只在對應任務 ready 時可用；離線／未同步時停用並說明原因（SD 5.3）。
 */
export function HomeScreen() {
  const isFocused = useIsFocused();
  const { t, locale } = useT();
  const navigation = useNavigation();
  const { screenPaddingX } = useTheme();
  const insets = useSafeAreaInsets();
  const session = useWalletStore((s) => s.session);
  const d = useDashboardStore();
  const [sheetInput, setSheetInput] = useState<ClaimInput | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [permissions, setPermissions] = useState<HealthPermissionSummary | null>(null);

  const refresh = useCallback(async () => {
    d.rollDay(Math.floor(Date.now() / 1000));
    setPermissions(await healthConnect.getPermissions().catch(() => null));
    if (!d.health) await d.loadCachedHealth();
    await Promise.all([d.syncHealth(), session ? d.syncChain(session.publicKey) : Promise.resolve()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  const steps = stepsProgress(d.health);
  const sleep = sleepProgress(d.health);
  // 維持規則 v2：運動任務（當日已同步、審核通過的 GPS 紀錄）；recorder／outbox 變化時重算
  const workout = workoutProgress(d.workout);
  const syncedAgoMin = d.health?.syncedAt ? Math.round((Date.now() - d.health.syncedAt) / 60_000) : null;
  const outdated = d.health?.syncedAt ? Date.now() - d.health.syncedAt > OUTDATED_MS : false;
  const stepsStatus = syncedAgoMin === null ? t('home.notSynced') : outdated ? t('home.outdated') : d.health?.error ? t('home.offlineCached') : t('home.updatedAgo', { n: syncedAgoMin });
  const untilMidnight = secondsUntilUtcMidnight(now);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? t('home.morning') : hour < 18 ? t('home.afternoon') : t('home.evening');

  const prefs = useWorkoutPrefs();
  // review 6：追蹤進行中的運動（recorder 狀態變化與取得焦點時更新）
  const [active, setActive] = useState(() => workoutRecorder.active());
  useEffect(() => workoutRecorder.subscribe(() => setActive(workoutRecorder.active())), []);
  useEffect(() => { d.refreshWorkout(); return workoutRecorder.subscribe(() => d.refreshWorkout()); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [d.taskDate, isFocused]);
  useEffect(() => { if (!prefs.loaded) void prefs.load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const startClaim = (type: TaskType) => {
    if (!session || !d.config) return;
    setSheetInput({
      player: session.publicKey,
      taskType: type,
      taskDate: d.taskDate,
      steps: d.health?.steps ?? null,
      sleep: d.health?.sleep ?? null,
      workout: d.workout,
      chain: { mint: d.config.mint, rewardVault: d.config.rewardVault },
      maintenance: maintenanceNeeds(d.profile, d.taskDate, d.freeze !== null),
      client: { appVersion: '0.1.0', deviceModel: 'Android', osApi: 34, sdkExtension: 0 },
    });
    d.dispatch(type, { kind: 'submit' });
  };

  const onPhase = useCallback(
    (p: ClaimPhase) => {
      const type = sheetInput?.taskType;
      if (!type) return;
      if (p.kind === 'awaiting_signature') d.dispatch(type, { kind: 'attested' });
      if (p.kind === 'confirming') d.dispatch(type, { kind: 'sent' });
      if (p.kind === 'confirmed' || p.kind === 'already_claimed') d.dispatch(type, { kind: 'receipt_exists' });
      if (p.kind === 'confirmed') {
        useLevelRevealStore.getState().setLastTx(p.signature ?? null);
        if (session) void d.syncChain(session.publicKey); // 升級發生在打卡交易內：立即重讀 profile 觸發 reveal
      }
      if (p.kind === 'rejected') d.dispatch(type, { kind: 'rejected' });
      if (p.kind === 'failed') d.dispatch(type, { kind: 'failed' });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sheetInput],
  );

  const disabledReason = useMemo(() => {
    if (!session) return t('common.reasonConnectWallet');
    if (!APP_CONFIG.chainConfigured) return t('common.reasonChain');
    if (!APP_CONFIG.backendConfigured) return t('common.reasonBackend');
    if (d.config?.paused) return t('common.reasonPaused');
    if (FEATURES.demoLevel) return t('common.reasonDemo');
    if (d.health?.error && !d.health.steps) return t('home.reasonHealth');
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, d.config, d.health, locale]);

  const stepsReward = estimateReward(d.config, d.profile, 'steps');
  const sleepReward = estimateReward(d.config, d.profile, 'sleep');
  const workoutReward = estimateReward(d.config, d.profile, 'workout');
  // 運動任務只擋錢包／鏈／後端／暫停（不看 Health Connect）；未同步／待審由卡片文字說明
  const workoutDisabledReason = FEATURES.demoLevel ? t('common.reasonDemo') : !session ? t('common.reasonConnectWallet') : !APP_CONFIG.chainConfigured ? t('common.reasonChain') : !APP_CONFIG.backendConfigured ? t('common.reasonBackend') : d.config?.paused ? t('common.reasonPaused') : undefined;
  const ap = useAppearance(); // PG-LINK-01：跑鞋外觀與棲地背景
  const recent = useMemo(() => {
    const owner = session?.address ?? null;
    return workoutRecorder.localStore().list().find((m) => !!m.summary && !m.deletedAt && (owner ? m.owner === owner || !m.owner : !m.owner)) ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.address, isFocused]);

  return (
    <View style={styles.root}>
    {ap.scene ? <HabitatScene kind={ap.scene} /> : null}
    <ScrollView
      style={ap.scene ? styles.overScene : styles.root}
      contentContainerStyle={[{ paddingHorizontal: screenPaddingX, paddingTop: insets.top + space.m, paddingBottom: space.xl }]}
      refreshControl={<RefreshControl refreshing={d.healthSyncing} onRefresh={() => void refresh()} tintColor={color.mint} />}
      testID="home-screen"
    >
      <View style={styles.header}>
        <View>
          <Text variant="heading2">{greeting}</Text>
          <Text variant="bodySmall" tone="secondary" numeric>
            {session ? shortAddress(session.address) : t('common.notConnected')} · {formatTskr(d.balance)} {APP_CONFIG.tokenSymbol}
          </Text>
        </View>
        <Chip label={t('common.devnet')} kind="devnet" />
        {FEATURES.demoLevel ? <Chip label={t('common.demoData')} kind="devnet" accessibilityLabel={t("common.demoData")} /> : null}
      </View>

      {/* PG-U-01：固定「開始運動」主入口（mint 主按鈕，帶最近模式）＋ 四格快捷入口（圖示＋文字，等寬、≥ 48dp） */}
      {active ? (
        /* review 6：有進行中的運動時，主入口直接回到原 session，不是再開一場 */
        <Pressable onPress={() => navigation.navigate('WorkoutRecord')} accessibilityRole="button" accessibilityLabel={`${t('home.returnWorkout')} · ${t(active.state === 'paused' ? 'home.returnWorkout.paused' : 'home.returnWorkout.recording', { mode: t(`wo.mode.${modeOfIntent(active.sport, null) ?? (active.sport === 'run' ? 'run' : 'walk')}` as TKey) })}`} style={({ pressed }) => [styles.startWorkout, glowStyle('medium', color.mint), pressed && styles.pressed]} testID="home-return-workout">
          <View style={styles.startIcon}>
            <Feather name={active.state === 'paused' ? 'pause' : 'activity'} size={26} color={color.onMint} />
          </View>
          <View style={styles.flex}>
            <Text variant="heading2" style={styles.onMint}>
              {t('home.returnWorkout')}
            </Text>
            <Text variant="caption" style={styles.onMintMuted}>
              {t(active.state === 'paused' ? 'home.returnWorkout.paused' : 'home.returnWorkout.recording', { mode: t(`wo.mode.${modeOfIntent(active.sport, null) ?? (active.sport === 'run' ? 'run' : 'walk')}` as TKey) })}
            </Text>
          </View>
          <Feather name="chevron-right" size={22} color={color.onMint} />
        </Pressable>
      ) : (
      <Pressable onPress={() => navigation.navigate('WorkoutStart')} accessibilityRole="button" accessibilityLabel={`${t('home.startWorkout')} · ${t('home.recentMode', { mode: t(`wo.mode.${prefs.mode}` as TKey) })}`} style={({ pressed }) => [styles.startWorkout, glowStyle('medium', color.mint), pressed && styles.pressed]} testID="home-start-workout">
        <View style={styles.startIcon}>
          <Feather name="play" size={26} color={color.onMint} />
        </View>
        <View style={styles.flex}>
          <Text variant="heading2" style={styles.onMint}>
            {t('home.startWorkout')}
          </Text>
          <Text variant="caption" style={styles.onMintMuted}>
            {t('home.recentMode', { mode: t(`wo.mode.${prefs.mode}` as TKey) })}
          </Text>
        </View>
        <Feather name="chevron-right" size={22} color={color.onMint} />
      </Pressable>
      )}
      <View style={styles.quick} accessibilityRole="menu">
        {([
          { key: 'workouts', icon: 'list', route: 'Workouts', testID: 'home-workouts-link' },
          { key: 'explore', icon: 'map', route: 'Explore', testID: 'home-explore-link' },
          { key: 'gallery', icon: 'image', route: 'Gallery', testID: 'home-gallery-link' },
          { key: 'activity', icon: 'calendar', route: 'ActivityHistory', testID: 'home-activity-link' },
        ] as const).map((q) => (
          <Pressable key={q.key} onPress={() => navigation.navigate(q.route)} accessibilityRole="button" style={({ pressed }) => [styles.quickItem, pressed && styles.pressed]} testID={q.testID}>
            <Feather name={q.icon} size={22} color={color.cyan} />
            <Text variant="caption" tone="secondary" style={styles.quickLabel} numberOfLines={1}>
              {t(`home.${q.key}` as TKey)}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* PG-LINK-04：最近運動入口（本機最新一筆；點入我的運動日誌） */}
      {recent ? (
        <Pressable onPress={() => navigation.navigate('Main', { screen: 'ActivityTab' })} accessibilityRole="button" style={({ pressed }) => [styles.recent, pressed && styles.pressed]} testID="home-recent-workout">
          <View style={styles.flex}>
            <Text variant="label" tone="muted" uppercase>{t('home.recentWorkout')}</Text>
            <Text variant="body" numeric>{modeLabel(t, recent.sport, recent.intent)} · {recent.summary ? formatKm(String(recent.summary.distanceMm)) : '—'} · {recent.summary ? formatDuration(String(recent.summary.elapsedMs)) : '—'}</Text>
            <Text variant="caption" tone="muted">{new Date(recent.startedAtUtc).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {t(recent.syncedSessionId ? 'sum.synced' : 'sum.notSynced')}</Text>
          </View>
          <Feather name="chevron-right" size={20} color={color.textMuted} />
        </Pressable>
      ) : null}

      <Text variant="label" tone="muted" uppercase style={styles.section}>
        {t('home.today')}
      </Text>
      <View style={styles.cards}>
        <DataCard icon="activity" label={t('home.steps')} value={steps.value.toLocaleString()} unit={t('home.stepsUnit')} goalLabel={t('home.goal', { n: steps.goal })} ratio={steps.ratio} tint={color.mint} statusText={stepsStatus} outdated={outdated || Boolean(d.health?.error)} testID="card-steps" />
        {FEATURES.sleep ? <View style={styles.gap} /> : null}
        {FEATURES.sleep ? <DataCard icon="moon" label={t('home.sleep')} value={t('home.sleepValue', { h: Math.floor(sleep.value / 60), m: sleep.value % 60 })} unit="" goalLabel={t('home.goalSleep')} ratio={sleep.ratio} tint={color.violet} statusText={d.health?.sleep && d.health.sleep.sessions.length === 0 ? t('home.noSleep') : ''} testID="card-sleep" /> : null}
      </View>
      <Text variant="caption" tone="muted" style={styles.utc}>
        {t('home.utcReset', { h: Math.floor(untilMidnight / 3600), m: Math.floor((untilMidnight % 3600) / 60) })}
      </Text>

      {/* Style 14 inline states：說明發生什麼、資料是否安全、下一步 */}
      {permissions && permissions.state !== 'granted' ? (
        <InlineState kind="warning" title={t('home.healthOff.title')} body={t(FEATURES.sleep ? 'home.healthOff.body' : 'home.healthOff.bodySteps')} action={{ label: t('home.healthOff.action'), onPress: () => navigation.navigate('Onboarding', { screen: 'HealthAccess' }) }} testID="state-health-off" />
      ) : null}
      {d.health?.error && permissions?.state === 'granted' ? (
        <InlineState kind="warning" title={t('home.healthErr.title')} body={t('home.healthErr.body', { error: d.health.error })} action={{ label: t('common.tryAgain'), onPress: () => void d.syncHealth(), loading: d.healthSyncing }} testID="state-health-error" />
      ) : null}
      {d.chainError && APP_CONFIG.chainConfigured && session ? (
        <InlineState kind="warning" title={t('common.devnetBreak')} body={t('home.chainErr.body', { error: d.chainError })} action={{ label: t('common.retry'), onPress: () => void d.syncChain(session.publicKey) }} testID="state-chain-error" />
      ) : null}

      <Pressable onPress={() => navigation.navigate('Main', { screen: 'Gear' })} style={styles.hero} accessibilityRole="button" accessibilityLabel={t('home.openGear')}>
        <ShoeHero level={ap.level} size={200} active={isFocused} />
        <Text variant="label" tone="secondary" uppercase style={styles.heroCaption}>
          {t('common.lv', { n: d.profile?.shoeLevel ?? 1 })} · {d.profile ? t('common.xp', { n: Number(d.profile.xp) }) : t('home.noProfile')} · {d.config && d.profile ? `${(d.config.coreMultiplierBps[d.profile.coreLevel - 1] ?? 10_000) / 10_000}×` : '1.0×'}
        </Text>
        {ap.differs ? (
          <Text variant="caption" tone="muted" style={styles.heroCaption} testID="home-appearance-note">
            {t('gear.lookNote', { look: ap.level, active: ap.active })}
          </Text>
        ) : null}
      </Pressable>

      <MissionCard type="steps" status={d.tasks.steps} progress={steps} rewardLabel={stepsReward !== null ? `${formatTskr(stepsReward)} tSKR` : null} onPress={() => startClaim('steps')} disabledReason={disabledReason} testID="mission-steps" />
      {!FEATURES.sleep ? <MissionCard type="workout" status={d.tasks.workout} progress={workout} rewardLabel={workoutReward !== null ? `${formatTskr(workoutReward)} tSKR` : null} onPress={() => startClaim('workout')} disabledReason={workoutDisabledReason} evidence={d.workout} testID="mission-workout" /> : null}
      {FEATURES.sleep ? <MissionCard type="sleep" status={d.tasks.sleep} progress={sleep} rewardLabel={sleepReward !== null ? `${formatTskr(sleepReward)} tSKR` : null} onPress={() => startClaim('sleep')} disabledReason={disabledReason} testID="mission-sleep" /> : null}

      <Text variant="caption" tone="muted" style={styles.disclaimer}>
        {t('common.testToken')}
      </Text>

      <ClockInSheet visible={sheetInput !== null} input={sheetInput} onClose={() => setSheetInput(null)} onPhase={onPhase} />
    </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
  overScene: { flex: 1, backgroundColor: 'transparent' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  section: { marginTop: space.xl, marginBottom: space.xs },
  flex: { flex: 1 },
  pressed: { opacity: 0.85 },
  startWorkout: { marginTop: space.xl, minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: space.s, paddingVertical: space.s, paddingHorizontal: space.m, borderRadius: radius.l, backgroundColor: color.mint },
  startIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFFFFF33', alignItems: 'center', justifyContent: 'center' },
  onMint: { color: color.onMint },
  onMintMuted: { color: color.onMint, opacity: 0.75 },
  quick: { flexDirection: 'row', gap: space.xs, marginTop: space.s },
  quickItem: { flex: 1, minHeight: 64, alignItems: 'center', justifyContent: 'center', gap: space.xxs, paddingVertical: space.xs, borderRadius: radius.m, backgroundColor: color.surface, borderWidth: 1, borderColor: color.borderSubtle },
  quickLabel: { textAlign: 'center' },
  cards: { flexDirection: 'row' },
  gap: { width: space.s },
  utc: { marginTop: space.xs },
  hero: { alignItems: 'center', marginTop: space.xl },
  recent: { flexDirection: 'row', alignItems: 'center', gap: space.s, marginTop: space.m, padding: space.m, borderRadius: radius.m, backgroundColor: color.surface, borderWidth: 1, borderColor: color.borderSubtle },
  heroCaption: { marginTop: space.xs },
  disclaimer: { marginTop: space.l, textAlign: 'center' },
});
