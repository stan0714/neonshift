import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Chip, DataCard, InlineState, MissionCard, Wordmark } from '@/components';
import { ShoeHero } from '@/components/ShoeHero';
import { APP_CONFIG } from '@/config/app';
import { secondsUntilUtcMidnight, type TaskType } from '@/domain/taskEngine';
import type { ClaimInput, ClaimPhase } from '@/services/claim/ClaimFlow';
import { estimateReward, formatTskr, sleepProgress, stepsProgress, useDashboardStore } from '@/state/dashboardStore';
import { healthConnect, type HealthPermissionSummary } from '@/services/health/HealthConnectService';
import { useLevelRevealStore } from '@/state/levelRevealStore';
import { shortAddress, useWalletStore } from '@/state/walletStore';
import { color, space, Text, useTheme } from '@/theme';

import { ClockInSheet } from './ClockInSheet';

const OUTDATED_MS = 30 * 60 * 1000;

/**
 * Dashboard（PG-A-12，Style 11）：Header → Today summary → Shoe hero → Mission cards → CTA。
 * 打卡按鈕只在對應任務 ready 時可用；離線／未同步時停用並說明原因（SD 5.3）。
 */
export function HomeScreen() {
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
  const stepsStatus = syncedAgoMin === null ? 'Not synced' : outdated ? 'Data may be outdated' : d.health?.error ? 'Offline · showing cached data' : `Updated ${syncedAgoMin} min ago`;
  const untilMidnight = secondsUntilUtcMidnight(now);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const startClaim = (type: TaskType) => {
    if (!session || !d.config) return;
    setSheetInput({
      player: session.publicKey,
      taskType: type,
      taskDate: d.taskDate,
      steps: d.health?.steps ?? null,
      sleep: d.health?.sleep ?? null,
      chain: { mint: d.config.mint, rewardVault: d.config.rewardVault },
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
    if (!session) return 'Connect your wallet';
    if (!APP_CONFIG.chainConfigured) return 'Onchain program not configured in this build';
    if (!APP_CONFIG.backendConfigured) return 'Backend not configured in this build';
    if (d.config?.paused) return 'Claims are paused right now';
    if (d.health?.error && !d.health.steps) return 'Health data unavailable';
    return undefined;
  }, [session, d.config, d.health]);

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
            {session ? shortAddress(session.address) : 'Not connected'} · {formatTskr(d.balance)} {APP_CONFIG.tokenSymbol}
          </Text>
        </View>
        <Chip label="DEVNET" kind="devnet" />
      </View>

      <View style={[styles.header, styles.section]}>
        <Text variant="label" tone="muted" uppercase>
          Today
        </Text>
        <View style={styles.links}>
          <Pressable onPress={() => navigation.navigate('Gallery')} accessibilityRole="link" hitSlop={8} testID="home-gallery-link">
            <Text variant="label" tone="cyan" uppercase>
              Gallery
            </Text>
          </Pressable>
          <Pressable onPress={() => navigation.navigate('ActivityHistory')} accessibilityRole="link" hitSlop={8} testID="home-activity-link">
            <Text variant="label" tone="cyan" uppercase>
              Activity ›
            </Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.cards}>
        <DataCard icon="activity" label="Steps" value={steps.value.toLocaleString()} unit="steps" goalLabel={`Goal ${steps.goal.toLocaleString()}`} ratio={steps.ratio} tint={color.mint} statusText={stepsStatus} outdated={outdated || Boolean(d.health?.error)} testID="card-steps" />
        <View style={styles.gap} />
        <DataCard icon="moon" label="Sleep" value={`${Math.floor(sleep.value / 60)}h ${sleep.value % 60}m`} unit="" goalLabel="Goal 7h" ratio={sleep.ratio} tint={color.violet} statusText={d.health?.sleep && d.health.sleep.sessions.length === 0 ? 'No sleep session found' : ''} testID="card-sleep" />
      </View>
      <Text variant="caption" tone="muted" style={styles.utc}>
        UTC day resets in {Math.floor(untilMidnight / 3600)}h {Math.floor((untilMidnight % 3600) / 60)}m
      </Text>

      {/* Style 14 inline states：說明發生什麼、資料是否安全、下一步 */}
      {permissions && permissions.state !== 'granted' ? (
        <InlineState kind="warning" title="Health access is off" body="Missions need Steps and Sleep from Health Connect. Nothing is read until you allow it; cached numbers stay on this phone." action={{ label: 'Review access', onPress: () => navigation.navigate('Onboarding', { screen: 'HealthAccess' }) }} testID="state-health-off" />
      ) : null}
      {d.health?.error && permissions?.state === 'granted' ? (
        <InlineState kind="warning" title="Health data unavailable" body={`Health Connect did not answer. Showing the last synced numbers; nothing was sent anywhere. ${d.health.error}`} action={{ label: 'Try again', onPress: () => void d.syncHealth(), loading: d.healthSyncing }} testID="state-health-error" />
      ) : null}
      {d.chainError && APP_CONFIG.chainConfigured && session ? (
        <InlineState kind="warning" title="Devnet is taking a break" body={`Could not read your onchain profile. Your tSKR and progress are safe onchain; showing cached values. ${d.chainError}`} action={{ label: 'Retry', onPress: () => void d.syncChain(session.publicKey) }} testID="state-chain-error" />
      ) : null}

      <Pressable onPress={() => navigation.navigate('Main', { screen: 'Gear' })} style={styles.hero} accessibilityRole="button" accessibilityLabel="Open gear">
        <ShoeHero level={(d.profile?.shoeLevel ?? 1) as 1 | 2 | 3 | 4 | 5} size={200} />
        <Text variant="label" tone="secondary" uppercase style={styles.heroCaption}>
          LV. {d.profile?.shoeLevel ?? 1} · {d.profile ? `${d.profile.xp} XP` : 'No profile yet'} · {d.config && d.profile ? `${(d.config.coreMultiplierBps[d.profile.coreLevel - 1] ?? 10_000) / 10_000}×` : '1.0×'}
        </Text>
      </Pressable>

      <MissionCard type="steps" status={d.tasks.steps} progress={steps} rewardLabel={stepsReward !== null ? `${formatTskr(stepsReward)} tSKR` : null} onPress={() => startClaim('steps')} disabledReason={disabledReason} testID="mission-steps" />
      <MissionCard type="sleep" status={d.tasks.sleep} progress={sleep} rewardLabel={sleepReward !== null ? `${formatTskr(sleepReward)} tSKR` : null} onPress={() => startClaim('sleep')} disabledReason={disabledReason} testID="mission-sleep" />

      <Text variant="caption" tone="muted" style={styles.disclaimer}>
        Test Token · No monetary value
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
  cards: { flexDirection: 'row' },
  gap: { width: space.s },
  utc: { marginTop: space.xs },
  hero: { alignItems: 'center', marginTop: space.xl },
  heroCaption: { marginTop: space.xs },
  disclaimer: { marginTop: space.l, textAlign: 'center' },
});
