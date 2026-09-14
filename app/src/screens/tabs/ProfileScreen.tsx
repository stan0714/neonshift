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
import { useLocaleStore, useT, type TKey } from '@/i18n';

type Deletion = { state: 'idle' | 'working' | 'done' | 'scheduled' | 'error'; dueAt?: string; message?: string; referenceId?: string };

/**
 * Profile（PG-A-21，Style 19.1 #12、FR-01.4、BR-25）：錢包、權限、隱私、刪除資料、斷開。
 * 高風險操作（刪除、斷開）用 centered confirmation dialog（7.7），說明資料／資金是否受影響與下一步。
 */
export function ProfileScreen() {
  const { t } = useT();
  const navigation = useNavigation();
  const wallet = useWalletStore();
  const onboarding = useOnboardingStore();
  const dashboard = useDashboardStore();
  const [health, setHealth] = useState<HealthPermissionSummary | null>(null);
  const [activity, setActivity] = useState<boolean | null>(null);
  const [backend, setBackend] = useState<boolean | null>(null);
  const [deletion, setDeletion] = useState<Deletion>({ state: 'idle' });
  const localeSetting = useLocaleStore((s) => s.setting);
  const setLocaleSetting = useLocaleStore((s) => s.setSetting);

  const refresh = useCallback(async () => {
    setHealth(await healthConnect.getPermissions().catch(() => null));
    setActivity(await activityRecognition.check().catch(() => null));
    setBackend(await apiClient.hasSession());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const disconnect = () => {
    Alert.alert(t('profile.disconnect.title'), t('profile.disconnect.body'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('profile.disconnect.ok'),
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
      t('profile.delete.title'),
      t('profile.delete.body'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('profile.delete.ok'),
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
        <Text variant="heading1">{t('profile.title')}</Text>
        <Chip label={t('common.devnet')} kind="devnet" />
      </View>

      <Section title={t('profile.wallet')}>
        <Row icon="credit-card" label={wallet.session ? shortAddress(wallet.session.address, 6) : t('common.notConnected')} detail={wallet.session?.label ?? `Solana ${APP_CONFIG.cluster}`} />
        <Row icon="server" label={t('profile.backendSession')} detail={backend === null ? '…' : backend ? t('profile.signedIn') : t('profile.signedOut')} />
        {wallet.session ? <Button label={t('profile.disconnectWallet')} variant="danger" style={styles.btn} onPress={disconnect} /> : <Button label={t('common.connectWallet')} style={styles.btn} onPress={() => navigation.navigate('Onboarding', { screen: 'WalletConnect' })} />}
      </Section>

      <Section title={t('profile.permissions')}>
        <Row icon="activity" label={t('profile.healthConnect')} detail={health ? (health.state === 'granted' ? `${t('profile.stepsSleep')}${health.backgroundGranted ? t('profile.background') : ''}` : health.state === 'partial' ? t('profile.partial') : t('profile.off')) : '…'} tint={health?.state === 'granted' ? color.success : color.warning} />
        <Row icon="bar-chart-2" label={t('profile.activity')} detail={activity === null ? '…' : activity ? t('profile.allowed') : t('profile.off')} tint={activity ? color.success : color.warning} />
        <View style={styles.rowBtns}>
          <Button label={t('profile.hcSettings')} variant="secondary" style={styles.half} onPress={() => void healthConnect.openSettings()} />
          <Button label={t('profile.appSettings')} variant="secondary" style={styles.half} onPress={() => void Linking.openSettings()} />
        </View>
      </Section>

      <Section title={t('profile.language')}>
        <View style={styles.rowBtns} accessibilityRole="radiogroup" accessibilityLabel={t('profile.language')}>
          {(['system', 'en', 'zh-TW'] as const).map((s) => (
            <Button key={s} label={t(`profile.language.${s}` as TKey)} variant={localeSetting === s ? 'primary' : 'secondary'} style={styles.third} onPress={() => void setLocaleSetting(s)} accessibilityState={{ selected: localeSetting === s }} testID={`lang-${s}`} />
          ))}
        </View>
      </Section>

      <Section title={t('profile.privacy')}>
        <Text variant="bodySmall" tone="secondary">
          {t('profile.privacyBody')}
        </Text>
        <Pressable onPress={() => void Linking.openURL(`${APP_CONFIG.siteUrl}/privacy`)} accessibilityRole="link" style={styles.link}>
          <Text variant="bodySmall" tone="cyan">
            {t('profile.privacyLink', { url: `${APP_CONFIG.siteUrl.replace('https://', '')}/privacy` })}
          </Text>
        </Pressable>
        <Button label={t('profile.deleteData')} variant="danger" style={styles.btn} onPress={deleteData} loading={deletion.state === 'working'} loadingLabel={t('profile.deleting')} disabled={!backend} disabledReason={backend === false ? t('profile.deleteReason') : undefined} />
        {deletion.state === 'done' ? <InlineState kind="success" title={t('profile.deleted.title')} body={t('profile.deleted.body')} testID="deletion-done" /> : null}
        {deletion.state === 'scheduled' ? <InlineState kind="info" title={t('profile.scheduled.title')} body={t('profile.scheduled.body', { when: deletion.dueAt ? new Date(deletion.dueAt).toLocaleString() : t('profile.retentionLimit') })} testID="deletion-scheduled" /> : null}
        {deletion.state === 'error' ? <InlineState kind="error" title={t('common.somethingInterrupted')} body={t('profile.deleteErr.body', { message: deletion.message ?? '' })} referenceId={deletion.referenceId} action={{ label: t('common.tryAgain'), onPress: deleteData }} testID="deletion-error" /> : null}
      </Section>

      <Section title={t('profile.about')}>
        <Row icon="info" label="NeonShift 0.1.0" detail={`${APP_CONFIG.chainConfigured ? t('profile.program', { id: shortAddress(APP_CONFIG.programId, 6) }) : t('profile.noProgram')} · ${APP_CONFIG.backendConfigured ? APP_CONFIG.apiUrl : t('profile.noBackend')}`} />
        <Row icon="refresh-cw" label={t('profile.healthSync')} detail={dashboard.health?.syncedAt ? `${dashboard.health.source} · ${new Date(dashboard.health.syncedAt).toLocaleTimeString()}` : t('profile.notSyncedYet')} />
        <Text variant="caption" tone="muted" style={styles.disclaimer}>
          {t('profile.aboutDisclaimer')}
        </Text>
        {__DEV__ ? <Button label={t('profile.devDiag')} variant="secondary" style={styles.btn} onPress={() => navigation.navigate('DevHealth')} /> : null}
        {__DEV__ ? <Button label={t('profile.devReset')} variant="secondary" style={styles.btn} onPress={() => void onboarding.reset()} /> : null}
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
  third: { flex: 1 },
  half: { flex: 1 },
  btn: { marginTop: space.m },
  link: { marginTop: space.s, minHeight: 48, justifyContent: 'center' },
  disclaimer: { marginTop: space.s },
});
