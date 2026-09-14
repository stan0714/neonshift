import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';

import { Button, Chip, InlineState, Screen, Surface } from '@/components';
import { APP_CONFIG } from '@/config/app';
import { ApiError, apiClient } from '@/services/api/ApiClient';
import { healthConnect, type HealthPermissionSummary } from '@/services/health/HealthConnectService';
import { activityRecognition } from '@/services/permissions/ActivityRecognition';
import { useDashboardStore } from '@/state/dashboardStore';
import { useOnboardingStore } from '@/state/onboardingStore';
import { shortAddress, useWalletStore } from '@/state/walletStore';
import { color, space, Text } from '@/theme';

type Deletion = { state: 'idle' | 'working' | 'done' | 'scheduled' | 'error'; dueAt?: string; message?: string; referenceId?: string };

/**
 * Profile（PG-A-21，Style 19.1 #12、FR-01.4、BR-25）：錢包、權限、隱私、刪除資料、斷開。
 * 高風險操作（刪除、斷開）用 centered confirmation dialog（7.7），說明資料／資金是否受影響與下一步。
 */
export function ProfileScreen() {
  const navigation = useNavigation();
  const wallet = useWalletStore();
  const onboarding = useOnboardingStore();
  const dashboard = useDashboardStore();
  const [health, setHealth] = useState<HealthPermissionSummary | null>(null);
  const [activity, setActivity] = useState<boolean | null>(null);
  const [backend, setBackend] = useState<boolean | null>(null);
  const [deletion, setDeletion] = useState<Deletion>({ state: 'idle' });

  const refresh = useCallback(async () => {
    setHealth(await healthConnect.getPermissions().catch(() => null));
    setActivity(await activityRecognition.check().catch(() => null));
    setBackend(await apiClient.hasSession());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const disconnect = () => {
    Alert.alert('Disconnect wallet?', 'Your wallet authorization and backend session on this phone will be removed. Onchain data and tSKR stay in your wallet. You can connect again any time.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: async () => {
          await apiClient.signOut().catch(() => {});
          await wallet.disconnect();
          await healthConnect.clearCache().catch(() => {});
          navigation.reset({ index: 0, routes: [{ name: 'Landing' }] });
        },
      },
    ]);
  };

  const deleteData = () => {
    Alert.alert(
      'Delete my backend data?',
      'This removes your health summaries, verification records and sessions from NeonShift servers and signs you out. Onchain records (wallet, claims, tSKR) are public and cannot be deleted. If you have an active staked tournament, settlement summaries are kept until it settles, never beyond 30 days.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete data',
          style: 'destructive',
          onPress: async () => {
            setDeletion({ state: 'working' });
            try {
              const r = await apiClient.deleteData();
              await healthConnect.clearCache().catch(() => {});
              await healthConnect.disableBackgroundSync().catch(() => {});
              if (r.status === 202) {
                const body = r.body as { deletion_due_at?: string };
                setDeletion({ state: 'scheduled', dueAt: body.deletion_due_at });
              } else {
                setDeletion({ state: 'done' });
              }
              setBackend(false);
            } catch (e) {
              setDeletion({ state: 'error', message: e instanceof ApiError ? `${e.code}: ${e.message}` : String(e), ...(e instanceof ApiError && e.requestId ? { referenceId: e.requestId } : {}) });
            }
          },
        },
      ],
    );
  };

  return (
    <Screen scroll insideTabs testID="profile-screen">
      <View style={styles.header}>
        <Text variant="heading1">Profile</Text>
        <Chip label="DEVNET" kind="devnet" />
      </View>

      <Section title="Wallet">
        <Row icon="credit-card" label={wallet.session ? shortAddress(wallet.session.address, 6) : 'Not connected'} detail={wallet.session?.label ?? `Solana ${APP_CONFIG.cluster}`} />
        <Row icon="server" label="Backend session" detail={backend === null ? '…' : backend ? 'Signed in' : 'Signed out'} />
        {wallet.session ? <Button label="Disconnect wallet" variant="danger" style={styles.btn} onPress={disconnect} /> : <Button label="Connect wallet" style={styles.btn} onPress={() => navigation.navigate('Onboarding', { screen: 'WalletConnect' })} />}
      </Section>

      <Section title="Permissions">
        <Row icon="activity" label="Health Connect" detail={health ? (health.state === 'granted' ? `Steps & Sleep${health.backgroundGranted ? ' · background' : ''}` : health.state === 'partial' ? 'Partial' : 'Off') : '…'} tint={health?.state === 'granted' ? color.success : color.warning} />
        <Row icon="bar-chart-2" label="Activity recognition" detail={activity === null ? '…' : activity ? 'Allowed' : 'Off'} tint={activity ? color.success : color.warning} />
        <View style={styles.rowBtns}>
          <Button label="Health Connect settings" variant="secondary" style={styles.half} onPress={() => void healthConnect.openSettings()} />
          <Button label="App settings" variant="secondary" style={styles.half} onPress={() => void Linking.openSettings()} />
        </View>
      </Section>

      <Section title="Privacy">
        <Text variant="bodySmall" tone="secondary">
          Only summaries reach our servers and are kept for at most 30 days. Raw sensor and step records never leave this phone. Wallet address, claims and tSKR live onchain and are public.
        </Text>
        <Pressable onPress={() => void Linking.openURL(`${APP_CONFIG.siteUrl}/privacy`)} accessibilityRole="link" style={styles.link}>
          <Text variant="bodySmall" tone="cyan">
            Privacy policy · {APP_CONFIG.siteUrl.replace('https://', '')}/privacy
          </Text>
        </Pressable>
        <Button label="Delete my backend data" variant="danger" style={styles.btn} onPress={deleteData} loading={deletion.state === 'working'} loadingLabel="Deleting…" disabled={!backend} disabledReason={backend === false ? 'Sign in to manage server data' : undefined} />
        {deletion.state === 'done' ? <InlineState kind="success" title="Backend data deleted" body="Your server-side data was removed and you were signed out. Onchain records remain public." testID="deletion-done" /> : null}
        {deletion.state === 'scheduled' ? <InlineState kind="info" title="Deletion scheduled" body={`Sessions revoked now; remaining tournament summaries are deleted by ${deletion.dueAt ? new Date(deletion.dueAt).toLocaleString() : 'the retention limit'}.`} testID="deletion-scheduled" /> : null}
        {deletion.state === 'error' ? <InlineState kind="error" title="Something interrupted your shift" body={`${deletion.message ?? ''} Nothing was deleted.`} referenceId={deletion.referenceId} action={{ label: 'Try again', onPress: deleteData }} testID="deletion-error" /> : null}
      </Section>

      <Section title="About">
        <Row icon="info" label="NeonShift 0.1.0" detail={`${APP_CONFIG.chainConfigured ? `Program ${shortAddress(APP_CONFIG.programId, 6)}` : 'Onchain program not configured'} · ${APP_CONFIG.backendConfigured ? APP_CONFIG.apiUrl : 'Backend not configured'}`} />
        <Row icon="refresh-cw" label="Health sync" detail={dashboard.health?.syncedAt ? `${dashboard.health.source} · ${new Date(dashboard.health.syncedAt).toLocaleTimeString()}` : 'Not synced yet'} />
        <Text variant="caption" tone="muted" style={styles.disclaimer}>
          Test Token · No monetary value. tSKR is a devnet test token and is not the official SKR.
        </Text>
        {__DEV__ ? <Button label="Health Connect diagnostics" variant="secondary" style={styles.btn} onPress={() => navigation.navigate('DevHealth')} /> : null}
        {__DEV__ ? <Button label="Reset onboarding flags" variant="secondary" style={styles.btn} onPress={() => void onboarding.reset()} /> : null}
      </Section>
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="label" tone="muted" uppercase style={styles.sectionTitle}>
        {title}
      </Text>
      <Surface>{children}</Surface>
    </View>
  );
}

function Row({ icon, label, detail, tint = color.textSecondary }: { icon: React.ComponentProps<typeof Feather>['name']; label: string; detail: string; tint?: string }) {
  return (
    <View style={styles.row} accessible accessibilityLabel={`${label}: ${detail}`}>
      <Feather name={icon} size={20} color={tint} />
      <View style={styles.rowText}>
        <Text variant="body">{label}</Text>
        <Text variant="caption" tone="muted">
          {detail}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  section: { marginTop: space.xl },
  sectionTitle: { marginBottom: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.xs },
  rowText: { marginLeft: space.s, flex: 1 },
  rowBtns: { flexDirection: 'row', marginTop: space.s, gap: space.xs },
  half: { flex: 1 },
  btn: { marginTop: space.m },
  link: { marginTop: space.s, minHeight: 48, justifyContent: 'center' },
  disclaimer: { marginTop: space.s },
});
