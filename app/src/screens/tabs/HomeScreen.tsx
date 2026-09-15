import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Chip, DataCard, InlineState, MissionCard, Wordmark } from '@/components';
import { ShoeHero } from '@/components/ShoeHero';
import { maintenanceNeeds } from '@/chain/accounts';
import { APP_CONFIG } from '@/config/app';
import { secondsUntilUtcMidnight, type TaskType } from '@/domain/taskEngine';
import type { ClaimInput, ClaimPhase } from '@/services/claim/ClaimFlow';
import { estimateReward, formatTskr, sleepProgress, stepsProgress, useDashboardStore } from '@/state/dashboardStore';
import { healthConnect, type HealthPermissionSummary } from '@/services/health/HealthConnectService';
import { useLevelRevealStore } from '@/state/levelRevealStore';
import { useWorkoutPrefs } from '@/state/workoutPrefsStore';
import { shortAddress, useWalletStore } from '@/state/walletStore';
import { color, radius, space, Text, useTheme } from '@/theme';

import { ClockInSheet } from './ClockInSheet';
import { useT, type TKey } from '@/i18n';

const OUTDATED_MS = 30 * 60 * 1000;

/**
 * Dashboard（PG-A-12，Style 11）：Header → Today summary → Shoe hero → Mission cards → CTA。
 * 打卡按鈕只在對應任務 ready 時可用；離線／未同步時停用並說明原因（SD 5.3）。
 */
export function HomeScreen() {
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
  const syncedAgoMin = d.health?.syncedAt ? Math.round((Date.now() - d.health.syncedAt) / 60_000) : null;
  const outdated = d.health?.syncedAt ? Date.now() - d.health.syncedAt > OUTDATED_MS : false;
  const stepsStatus = syncedAgoMin === null ? t('home.notSynced') : outdated ? t('home.outdated') : d.health?.error ? t('home.offlineCached') : t('home.updatedAgo', { n: syncedAgoMin });
  const untilMidnight = secondsUntilUtcMidnight(now);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? t('home.morning') : hour < 18 ? t('home.afternoon') : t('home.evening');

  const prefs = useWorkoutPrefs();
  useEffect(() => { if (!prefs.loaded) void prefs.load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const startClaim = (type: TaskType) => {
    if (!session || !d.config) return;
    setSheetInput({
      player: session.publicKey,
      taskType: type,
      taskDate: d.taskDate,
      steps: d.health?.steps ?? null,
      sleep: d.health?.sleep ?? null,
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
    if (d.health?.error && !d.health.steps) return t('home.reasonHealth');
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, d.config, d.health, locale]);

  const stepsReward = estimateReward(d.config, d.profile, 'steps');
  const sleepReward = estimateReward(d.config, d.profile, 'sleep');

  return (
    <ScrollView
      style={styles.root}
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
      </View>

      <View style={[styles.header, styles.section]}>
        <Text variant="label" tone="muted" uppercase>
          {t('home.today')}
        </Text>
        {/* PG-U-01：固定「開始運動」入口，帶最近模式快速開始（開始頁仍可改） */}
        <Pressable onPress={() => navigation.navigate('WorkoutStart')} accessibilityRole="button" style={styles.startWorkout} testID="home-start-workout">
          <Text variant="title">{t('home.startWorkout')}</Text>
          <Text variant="caption" tone="muted">
            {t('home.recentMode', { mode: t(`wo.mode.${prefs.mode}` as TKey) })}
          </Text>
        </Pressable>
        <View style={styles.links}>
          <Pressable onPress={() => navigation.navigate('Gallery')} accessibilityRole="link" hitSlop={8} testID="home-gallery-link">
            <Text variant="label" tone="cyan" uppercase>
              {t('home.gallery')}
            </Text>
          </Pressable>
          <Pressable onPress={() => navigation.navigate('Workouts')} accessibilityRole="link" hitSlop={8} testID="home-workouts-link">
            <Text variant="label" tone="cyan" uppercase>
              {t('home.workouts')}
            </Text>
          </Pressable>
          <Pressable onPress={() => navigation.navigate('ActivityHistory')} accessibilityRole="link" hitSlop={8} testID="home-activity-link">
            <Text variant="label" tone="cyan" uppercase>
              {t('home.activity')}
            </Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.cards}>
        <DataCard icon="activity" label={t('home.steps')} value={steps.value.toLocaleString()} unit={t('home.stepsUnit')} goalLabel={t('home.goal', { n: steps.goal })} ratio={steps.ratio} tint={color.mint} statusText={stepsStatus} outdated={outdated || Boolean(d.health?.error)} testID="card-steps" />
        <View style={styles.gap} />
        <DataCard icon="moon" label={t('home.sleep')} value={t('home.sleepValue', { h: Math.floor(sleep.value / 60), m: sleep.value % 60 })} unit="" goalLabel={t('home.goalSleep')} ratio={sleep.ratio} tint={color.violet} statusText={d.health?.sleep && d.health.sleep.sessions.length === 0 ? t('home.noSleep') : ''} testID="card-sleep" />
      </View>
      <Text variant="caption" tone="muted" style={styles.utc}>
        {t('home.utcReset', { h: Math.floor(untilMidnight / 3600), m: Math.floor((untilMidnight % 3600) / 60) })}
      </Text>

      {/* Style 14 inline states：說明發生什麼、資料是否安全、下一步 */}
      {permissions && permissions.state !== 'granted' ? (
        <InlineState kind="warning" title={t('home.healthOff.title')} body={t('home.healthOff.body')} action={{ label: t('home.healthOff.action'), onPress: () => navigation.navigate('Onboarding', { screen: 'HealthAccess' }) }} testID="state-health-off" />
      ) : null}
      {d.health?.error && permissions?.state === 'granted' ? (
        <InlineState kind="warning" title={t('home.healthErr.title')} body={t('home.healthErr.body', { error: d.health.error })} action={{ label: t('common.tryAgain'), onPress: () => void d.syncHealth(), loading: d.healthSyncing }} testID="state-health-error" />
      ) : null}
      {d.chainError && APP_CONFIG.chainConfigured && session ? (
        <InlineState kind="warning" title={t('common.devnetBreak')} body={t('home.chainErr.body', { error: d.chainError })} action={{ label: t('common.retry'), onPress: () => void d.syncChain(session.publicKey) }} testID="state-chain-error" />
      ) : null}

      <Pressable onPress={() => navigation.navigate('Main', { screen: 'Gear' })} style={styles.hero} accessibilityRole="button" accessibilityLabel={t('home.openGear')}>
        <ShoeHero level={(d.profile?.shoeLevel ?? 1) as 1 | 2 | 3 | 4 | 5} size={200} />
        <Text variant="label" tone="secondary" uppercase style={styles.heroCaption}>
          {t('common.lv', { n: d.profile?.shoeLevel ?? 1 })} · {d.profile ? t('common.xp', { n: Number(d.profile.xp) }) : t('home.noProfile')} · {d.config && d.profile ? `${(d.config.coreMultiplierBps[d.profile.coreLevel - 1] ?? 10_000) / 10_000}×` : '1.0×'}
        </Text>
      </Pressable>

      <MissionCard type="steps" status={d.tasks.steps} progress={steps} rewardLabel={stepsReward !== null ? `${formatTskr(stepsReward)} tSKR` : null} onPress={() => startClaim('steps')} disabledReason={disabledReason} testID="mission-steps" />
      <MissionCard type="sleep" status={d.tasks.sleep} progress={sleep} rewardLabel={sleepReward !== null ? `${formatTskr(sleepReward)} tSKR` : null} onPress={() => startClaim('sleep')} disabledReason={disabledReason} testID="mission-sleep" />

      <Text variant="caption" tone="muted" style={styles.disclaimer}>
        {t('common.testToken')}
      </Text>

      <ClockInSheet visible={sheetInput !== null} input={sheetInput} onClose={() => setSheetInput(null)} onPhase={onPhase} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  section: { marginTop: space.xl, marginBottom: space.xs },
  links: { flexDirection: 'row', gap: space.m },
  startWorkout: { marginTop: space.m, padding: space.m, borderRadius: radius.m, borderWidth: 1, borderColor: color.mint, backgroundColor: color.surface },
  cards: { flexDirection: 'row' },
  gap: { width: space.s },
  utc: { marginTop: space.xs },
  hero: { alignItems: 'center', marginTop: space.xl },
  heroCaption: { marginTop: space.xs },
  disclaimer: { marginTop: space.l, textAlign: 'center' },
});
