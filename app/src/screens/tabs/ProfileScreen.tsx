import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Switch, View } from 'react-native';

import { Button, Chip, InlineState, Screen, Surface } from '@/components';
import { useAppearance } from '@/hooks/useAppearance';
import { useOutbox } from '@/hooks/useOutbox';
import { workoutOutbox } from '@/services/workouts/WorkoutOutbox';
import { useSyncPrefs } from '@/state/syncPrefsStore';
import { useAppearanceStore } from '@/state/appearanceStore';
import { stageName } from '@/domain/collectibles';
import { APP_CONFIG } from '@/config/app';
import { ApiError, apiClient } from '@/services/api/ApiClient';
import { healthConnect, type HealthPermissionSummary } from '@/services/health/HealthConnectService';
import { activityRecognition } from '@/services/permissions/ActivityRecognition';
import { useDashboardStore } from '@/state/dashboardStore';
import { useOnboardingStore } from '@/state/onboardingStore';
import { shortAddress, useWalletStore } from '@/state/walletStore';
import { color, radius, space, Text } from '@/theme';
import { useLocaleStore, useT, type TKey } from '@/i18n';
import { FEATURES } from '@/config/features';

type Deletion = { state: 'idle' | 'working' | 'done' | 'scheduled' | 'error'; dueAt?: string; message?: string; referenceId?: string };

/**
 * Profile（PG-A-21，Style 19.1 #12、FR-01.4、BR-25）：錢包、權限、隱私、刪除資料、斷開。
 * 高風險操作（刪除、斷開）用 centered confirmation dialog（7.7），說明資料／資金是否受影響與下一步。
 */
export function ProfileScreen() {
  const { t } = useT();
  const navigation = useNavigation();
  const wallet = useWalletStore();
  const ap = useAppearance();
  const setBackground = useAppearanceStore((s) => s.setBackground);
  // PG-LINK-02：資料與同步
  const ob = useOutbox();
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncNote, setSyncNote] = useState<{ kind: 'success' | 'warning' | 'info'; title: string; body?: string } | null>(null);
  const setAutoSync = async (v: boolean) => {
    await useSyncPrefs.getState().setAutoSync(v);
    if (v) void workoutOutbox.kick('toggle');
  };
  const syncAllNow = async () => {
    if (!ob.owner) return;
    setSyncBusy(true);
    setSyncNote(null);
    try {
      const r = await workoutOutbox.run(ob.owner, { manual: true });
      if (!r.stoppedAt) setSyncNote({ kind: 'success', title: t('sync.done', { n: r.sent }) });
      else setSyncNote({ kind: 'warning', title: t('sync.stopped', { n: r.sent }), body: t(`sync.err.${r.stoppedAt.outcome.ok ? 'UNKNOWN' : r.stoppedAt.outcome.code}` as TKey, { message: r.stoppedAt.outcome.ok ? '' : r.stoppedAt.outcome.message }) });
    } finally {
      setSyncBusy(false);
    }
  };
  const assignGuest = () => {
    if (!ob.owner) return;
    Alert.alert(t('sync.assign.title', { n: ob.unassigned.length }), t('sync.assign.body'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('sync.assign.confirm'), onPress: () => void workoutOutbox.assign(ob.unassigned.map((m) => m.sessionId), ob.owner!) },
    ]);
  };
  const onboarding = useOnboardingStore();
  const dashboard = useDashboardStore();
  const [health, setHealth] = useState<HealthPermissionSummary | null>(null);
  const [activity, setActivity] = useState<boolean | null>(null);
  const [backend, setBackend] = useState<boolean | null>(null);
  const [deletion, setDeletion] = useState<Deletion>({ state: 'idle' });
  // PG-R-09：藝廊展示偏好（退出只停止展示）
  const [galleryShown, setGalleryShownState] = useState(true);
  const [galleryBusy, setGalleryBusy] = useState(false);
  const setGalleryShown = async (shown: boolean) => {
    setGalleryBusy(true);
    try {
      const r = await apiClient.setGalleryPrivacy(!shown);
      setGalleryShownState(!r.hidden);
    } catch {
      /* 保持原值 */
    } finally {
      setGalleryBusy(false);
    }
  };
  const localeSetting = useLocaleStore((s) => s.setting);
  const setLocaleSetting = useLocaleStore((s) => s.setSetting);

  const refresh = useCallback(async () => {
    setHealth(await healthConnect.getPermissions().catch(() => null));
    setActivity(await activityRecognition.check().catch(() => null));
    setBackend(await apiClient.hasSession());
    setGalleryShownState(!(await apiClient.galleryPrivacy().catch(() => ({ hidden: false }))).hidden);
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

      <Section title={t('guide.entry')}>
        <Text variant="bodySmall" tone="secondary">{t('guide.entryBody')}</Text>
        <Button label={t('guide.entry')} variant="secondary" style={styles.btn} onPress={() => navigation.navigate('GameGuide')} testID="profile-game-guide" />
      </Section>

      <Section title={t('profile.wallet')}>
        <Row icon="credit-card" label={wallet.session ? shortAddress(wallet.session.address, 6) : t('common.notConnected')} detail={wallet.session?.label ?? `Solana ${APP_CONFIG.cluster}`} />
        <Row icon="server" label={t('profile.backendSession')} detail={backend === null ? '…' : backend ? t('profile.signedIn') : t('profile.signedOut')} />
        {wallet.session ? <Button label={t('profile.disconnectWallet')} variant="danger" style={styles.btn} onPress={disconnect} /> : <Button label={t('common.connectWallet')} style={styles.btn} onPress={() => navigation.navigate('Onboarding', { screen: 'WalletConnect' })} />}
      </Section>

      <Section title={t('profile.permissions')}>
        <Row icon="activity" label={t('profile.healthConnect')} detail={health ? (health.state === 'granted' ? `${t(FEATURES.sleep ? 'profile.stepsSleep' : 'profile.stepsOnly')}${health.backgroundGranted ? t('profile.background') : ''}` : health.state === 'partial' ? t('profile.partial') : t('profile.off')) : '…'} tint={health?.state === 'granted' ? color.success : color.warning} />
        <Row icon="bar-chart-2" label={t('profile.activity')} detail={activity === null ? '…' : activity ? t('profile.allowed') : t('profile.off')} tint={activity ? color.success : color.warning} />
        <View style={styles.rowBtns}>
          <Button label={t('profile.hcSettings')} variant="secondary" style={styles.half} onPress={() => void healthConnect.openSettings()} />
          <Button label={t('profile.appSettings')} variant="secondary" style={styles.half} onPress={() => void Linking.openSettings()} />
        </View>
      </Section>

      <Section title={t('profile.language')}>
        <View style={styles.segment} accessibilityRole="radiogroup" accessibilityLabel={t('profile.language')}>
          {(['system', 'en', 'zh-TW'] as const).map((s) => {
            const on = localeSetting === s;
            return (
              <Pressable key={s} onPress={() => void setLocaleSetting(s)} accessibilityRole="radio" accessibilityState={{ selected: on }} style={[styles.segmentItem, on && styles.segmentOn]} testID={`lang-${s}`}>
                <Text variant="title" tone={on ? undefined : 'secondary'} style={on ? styles.segmentOnText : undefined} numberOfLines={1}>
                  {t(`profile.language.${s}` as TKey)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Section>

      <Section title={t('profile.lookTitle')}>
        <Row icon="layers" label={t('profile.lookShoe', { name: stageName(t, ap.level) })} detail={ap.differs ? t('gear.lookNote', { look: ap.level, active: ap.active }) : t('profile.lookFollow')} />
        <View style={styles.rowBetween}>
          <Text variant="bodySmall" tone="secondary" style={styles.flex}>{t('gear.bg.follow')}</Text>
          <Switch value={ap.backgroundEnabled} onValueChange={(v) => void setBackground(v)} disabled={!wallet.session} trackColor={{ true: color.mint, false: color.borderSubtle }} thumbColor={color.textPrimary} accessibilityLabel={t('gear.bg.follow')} testID="profile-bg-switch" />
        </View>
        <Text variant="caption" tone="muted" style={styles.mtXs}>{t(wallet.session ? 'profile.lookBody' : 'gear.bg.guest')}</Text>
        <Button label={t('profile.lookOpenGear')} variant="secondary" style={styles.btn} onPress={() => navigation.navigate('Main', { screen: 'Gear' })} testID="profile-open-gear" />
      </Section>

      <Section title={t('sync.title')}>
        <View style={styles.rowBetween}>
          <Text variant="bodySmall" tone="secondary" style={styles.flex}>{t('sync.auto')}</Text>
          <Switch value={ob.autoSync} onValueChange={(v) => void setAutoSync(v)} disabled={!wallet.session} trackColor={{ true: color.mint, false: color.borderSubtle }} thumbColor={color.textPrimary} accessibilityLabel={t('sync.auto')} testID="profile-autosync-switch" />
        </View>
        <Text variant="caption" tone="muted" style={styles.mtXs}>{t('sync.autoBody')}</Text>
        <Row icon="upload-cloud" label={t('sync.pending', { n: ob.summary.pending })} detail={ob.lastSuccessAt ? t('sync.lastSuccess', { when: new Date(ob.lastSuccessAt).toLocaleString() }) : t('sync.never')} tint={ob.summary.pending > 0 ? color.warning : color.success} />
        {ob.summary.head?.status === 'blocked' || ob.summary.head?.status === 'retry_wait' ? (
          <Text variant="bodySmall" tone="warning" style={styles.mtXs} testID="profile-sync-head-error">
            {t('sync.headStuck', { when: new Date(ob.summary.head.meta.startedAtUtc).toLocaleDateString(), reason: t(`sync.err.${ob.summary.head.lastError?.code ?? 'UNKNOWN'}` as TKey, { message: ob.summary.head.lastError?.message ?? '' }) })}
          </Text>
        ) : null}
        {ob.unassigned.length ? (
          <Button label={t('sync.assign.btn', { n: ob.unassigned.length })} variant="secondary" style={styles.btn} onPress={assignGuest} disabled={!wallet.session} testID="profile-sync-assign" />
        ) : null}
        <Button label={t('sum.syncNow')} variant="secondary" style={styles.btn} onPress={() => void syncAllNow()} loading={syncBusy || ob.summary.running} loadingLabel={t('sum.syncing')} disabled={!wallet.session || ob.summary.pending === 0} disabledReason={!wallet.session ? t('common.reasonConnectWallet') : ob.summary.pending === 0 ? t('sync.nothing') : undefined} testID="profile-sync-now" />
        {syncNote ? <InlineState kind={syncNote.kind} title={syncNote.title} body={syncNote.body} testID="profile-sync-note" /> : null}
        <Text variant="caption" tone="muted" style={styles.mtXs}>{t('sync.footnote')}</Text>
      </Section>

      <Section title={t('profile.galleryTitle')}>
        <View style={styles.rowBetween}>
          <Text variant="bodySmall" tone="secondary" style={styles.flex}>
            {t('profile.galleryShow')}
          </Text>
          <Switch value={galleryShown} onValueChange={(v) => void setGalleryShown(v)} disabled={!wallet.session || galleryBusy} trackColor={{ true: color.mint, false: color.borderSubtle }} thumbColor={color.textPrimary} accessibilityLabel={t('profile.galleryShow')} testID="profile-gallery-switch" />
        </View>
        <Text variant="caption" tone="muted" style={styles.mtXs}>
          {t('profile.galleryBody')}
        </Text>
        <Button label={t('actv.title')} variant="secondary" style={styles.btn} onPress={() => navigation.navigate('Activity')} testID="profile-activity" />
        <Button label={t('profile.runningHistory')} variant="secondary" style={styles.btn} onPress={() => navigation.navigate('Workouts')} testID="profile-running-history" />
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
  segment: { flexDirection: 'row', backgroundColor: color.elevated, borderRadius: radius.m, padding: 4, marginTop: space.xs },
  segmentItem: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.s },
  segmentOn: { backgroundColor: color.mint },
  segmentOnText: { color: color.onMint },
  half: { flex: 1 },
  btn: { marginTop: space.m },
  link: { marginTop: space.s, minHeight: 48, justifyContent: 'center' },
  disclaimer: { marginTop: space.s },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s },
  flex: { flex: 1 },
  mtXs: { marginTop: space.xs },
});
