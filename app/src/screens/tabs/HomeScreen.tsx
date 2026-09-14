import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Chip, DataCard, MissionCard, Wordmark } from '@/components';
import { ShoeHero } from '@/components/ShoeHero';
import { APP_CONFIG } from '@/config/app';
import { secondsUntilUtcMidnight, type TaskType } from '@/domain/taskEngine';
import type { ClaimInput, ClaimPhase } from '@/services/claim/ClaimFlow';
import { estimateReward, formatTskr, sleepProgress, stepsProgress, useDashboardStore } from '@/state/dashboardStore';
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

  const refresh = useCallback(async () => {
    d.rollDay(Math.floor(Date.now() / 1000));
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

      <Text variant="label" tone="muted" uppercase style={styles.section}>
        Today
      </Text>
      <View style={styles.cards}>
        <DataCard icon="activity" label="Steps" value={steps.value.toLocaleString()} unit="steps" goalLabel={`Goal ${steps.goal.toLocaleString()}`} ratio={steps.ratio} tint={color.mint} statusText={syncedAgoMin === null ? 'Not synced' : outdated ? 'Data may be outdated' : `Updated ${syncedAgoMin} min ago`} outdated={outdated} testID="card-steps" />
        <View style={styles.gap} />
        <DataCard icon="moon" label="Sleep" value={`${Math.floor(sleep.value / 60)}h ${sleep.value % 60}m`} unit="" goalLabel="Goal 7h" ratio={sleep.ratio} tint={color.violet} statusText={d.health?.sleep && d.health.sleep.sessions.length === 0 ? 'No sleep session found' : ''} testID="card-sleep" />
      </View>
      <Text variant="caption" tone="muted" style={styles.utc}>
        UTC day resets in {Math.floor(untilMidnight / 3600)}h {Math.floor((untilMidnight % 3600) / 60)}m
      </Text>

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
  cards: { flexDirection: 'row' },
  gap: { width: space.s },
  utc: { marginTop: space.xs },
  hero: { alignItems: 'center', marginTop: space.xl },
  heroCaption: { marginTop: space.xs },
  disclaimer: { marginTop: space.l, textAlign: 'center' },
});
