import { Feather } from '@expo/vector-icons';
import { PublicKey } from '@solana/web3.js';
import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { Button, Chip, InlineState, Screen, Surface } from '@/components';
import { SignInState } from '@/components/SignInState';
import { APP_CONFIG } from '@/config/app';
import { APP_VERSION } from '@/config/version';
import type { TournamentView } from '@/services/api/ApiClient';
import { useArenaStore, worstCaseLoss } from '@/state/arenaStore';
import { formatTskr, useDashboardStore } from '@/state/dashboardStore';
import { shortAddress, useWalletStore } from '@/state/walletStore';
import { color, radius, space, Text } from '@/theme';
import { useT, type TKey } from '@/i18n';

const fmtUtc = (unix: number) => new Date(unix * 1000).toISOString().replace('T', ' ').slice(5, 16) + ' UTC';
const fmtLocal = (unix: number) => new Date(unix * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const tskr = (units: string | bigint) => `${formatTskr(typeof units === 'string' ? BigInt(units) : units)} ${APP_CONFIG.tokenSymbol}`;

/**
 * Arena（PG-A-15，Style 13）：未報名（13.1）／進行中（13.2）／結算（13.3），外加 Cancelled 退款。
 * 賽事狀態由後端讀鏈上；質押、領獎、退款走 MWA；步數回報走錢包簽章 challenge。
 */
export function ArenaScreen() {
  const { t, locale } = useT();
  const navigation = useNavigation();
  const session = useWalletStore((s) => s.session);
  const config = useDashboardStore((s) => s.config);
  const a = useArenaStore();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  const refresh = useCallback(async () => {
    await a.refresh(session?.publicKey ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  const tt = a.current?.tournament ?? null;
  const joined = a.current?.player?.joined || a.entry !== null;
  const disabledReason = useMemo(() => {
    if (!session) return t('common.reasonConnectWallet');
    if (!APP_CONFIG.backendConfigured) return t('common.reasonBackend');
    if (!APP_CONFIG.chainConfigured) return t('common.reasonChain');
    if (!config) return t('common.reasonWaitConfig');
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, config, locale]);

  const confirmJoin = (tt: TournamentView) => {
    if (!session || !config) return;
    Alert.alert(
      t('arena.confirm.title', { stake: tskr(tt.stake_amount) }),
      t('arena.confirm.body', { refund: tt.loser_refund_bps / 100, loss: tskr(worstCaseLoss(tt)) }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('arena.confirm.ok'), onPress: () => void a.join(session.publicKey, config.mint) },
      ],
    );
  };

  return (
    <Screen scroll insideTabs testID="arena-screen" refreshControl={<RefreshControl refreshing={a.loading} onRefresh={() => void refresh()} tintColor={color.mint} />}>
      <View style={styles.header}>
        <Text variant="heading1">{t('arena.title')}</Text>
        <Chip label={t('common.devnet')} kind="devnet" />
      </View>

      {a.outcome ? (
        <Pressable onPress={a.dismissOutcome} accessibilityRole="button" accessibilityLabel={t('common.dismiss')}>
          <InlineState kind={a.outcome.kind === 'success' ? 'success' : a.outcome.code === 'REJECTED' ? 'warning' : 'error'} title={outcomeTitle(t, a.outcome)} body={a.outcome.message} testID={`arena-${a.outcome.kind}`} />
        </Pressable>
      ) : null}
      {a.needsSignIn && !tt ? (
        // 與其他頁共用登入卡（離線／拒簽／錢包不回覆的分類與 Phantom 提醒），成功後才標記已登入並重載
        <SignInState title={t('arena.signin.title')} body={t('arena.signin.body')} onSignedIn={async () => { useArenaStore.setState({ needsSignIn: false, error: null, outcome: null }); /* 清掉先前（例如 Phantom 不回覆）的失敗卡，不留「Could not enter」 */ if (session) await a.refresh(session.publicKey); }} testID="arena-signin" />
      ) : null}
      {a.error && !tt ? <InlineState kind={APP_CONFIG.backendConfigured ? 'error' : 'info'} title={APP_CONFIG.backendConfigured ? t('arena.unavailable') : t('arena.noBackend')} body={APP_CONFIG.backendConfigured ? t('arena.unavailableBody', { error: a.error }) : t('arena.noBackendBody')} testID="arena-error" /> : null}

      {!tt && !a.error && !a.needsSignIn ? (
        a.loading ? null : (
          <Surface style={styles.card} testID="arena-empty">
            <Text variant="title">{t('arena.empty.title')}</Text>
            <Text variant="bodySmall" tone="secondary" style={styles.mt}>
              {t('arena.empty.body')}
            </Text>
          </Surface>
        )
      ) : null}

      {tt ? (
        <>
          <Surface hero style={styles.card} testID="arena-tournament">
            <View style={styles.rowBetween}>
              <Text variant="label" tone="muted" uppercase>
                {t('arena.week', { year: Math.floor(tt.week_id / 100), week: String(tt.week_id % 100).padStart(2, '0') })}
              </Text>
              <Chip label={t(`arena.status.${tt.status}` as TKey)} kind={tt.status === 'running' ? 'synced' : tt.status === 'cancelled' ? 'offline' : 'level'} />
            </View>
            <Text variant="heading2" style={styles.mt}>
              {t('arena.marathon')}
            </Text>
            <Row icon="clock" label={t('arena.window')} value={`${fmtUtc(tt.starts_at)} → ${fmtUtc(tt.ends_at)}`} />
            <Row icon="map-pin" label={t('arena.localTime')} value={`${fmtLocal(tt.starts_at)} → ${fmtLocal(tt.ends_at)}`} />
            <Row icon="lock" label={t('arena.stake')} value={tskr(tt.stake_amount)} />
            <Row icon="users" label={t('arena.entrants')} value={`${t('arena.entrantsValue', { n: tt.entrant_count, min: tt.min_entrants })}${tt.status !== 'registration' && tt.status !== 'draft' ? t('arena.winnersValue', { w: tt.group_a_size + tt.group_b_size, a: tt.group_a_size, b: tt.group_b_size }) : ''}`} />
            <Row icon="percent" label={t('arena.rules')} value={t('arena.rulesValue', { refund: tt.loser_refund_bps / 100, a: tt.prize_a_bps / 100, b: tt.prize_b_bps / 100, v: tt.rules_version })} />
            {tt.status === 'registration' ? <Row icon="calendar" label={t('arena.regCloses')} value={t('arena.regClosesValue', { when: fmtLocal(tt.registration_ends_at), remaining: remaining(t, tt.registration_ends_at - now) })} /> : null}
          </Surface>

          {/* 13.1 未報名 */}
          {tt.status === 'registration' && !joined ? (
            <View style={styles.ctaBlock}>
              <Button label={t('arena.join', { stake: tskr(tt.stake_amount) })} onPress={() => confirmJoin(tt)} loading={a.busy === 'join'} loadingLabel={t('arena.entering')} disabled={!tt.registration_open || Boolean(disabledReason) || a.busy !== null} disabledReason={disabledReason ?? (!tt.registration_open ? t('arena.regClosed') : undefined)} testID="arena-join" />
              <Text variant="caption" tone="muted" style={styles.mt}>
                {t('arena.worstCase', { loss: tskr(worstCaseLoss(tt)), min: tt.min_entrants })}
              </Text>
            </View>
          ) : null}
          {tt.status === 'registration' && joined ? <InlineState kind="success" title={t('arena.joined.title')} body={t('arena.joined.body')} testID="arena-joined" /> : null}
          {tt.status === 'locked' ? <InlineState kind="info" title={joined ? t('arena.locked.in') : t('arena.regClosed')} body={t('arena.locked.body', { w: tt.group_a_size + tt.group_b_size, n: tt.valid_entrant_count, when: fmtLocal(tt.starts_at) })} testID="arena-locked" /> : null}

          {/* 13.2 進行中 */}
          {tt.status === 'running' ? (
            <Surface style={styles.card} testID="arena-running">
              <View style={styles.rowBetween}>
                <Stat label={t('arena.yourRank')} value={joined ? (a.current?.player?.rank ? `#${a.current.player.rank}` : '—') : t('arena.notEntered')} tint={color.mint} />
                <Stat label={t('arena.verifiedSteps')} value={joined ? (a.current?.player?.verified_steps ?? 0).toLocaleString() : '—'} tint={color.cyan} />
                <Stat label={t('arena.endsIn')} value={remaining(t, tt.ends_at - now)} tint={color.violet} />
              </View>
              {joined ? (
                <Button label={t('arena.report')} variant="primary" style={styles.mt} onPress={() => void a.submitSteps({ appVersion: APP_VERSION, deviceModel: 'Android', osApi: 34, sdkExtension: 0 })} loading={a.busy === 'steps'} loadingLabel={t('arena.verifying')} disabled={Boolean(disabledReason) || a.busy !== null} disabledReason={disabledReason} testID="arena-steps" />
              ) : (
                <Text variant="bodySmall" tone="secondary" style={styles.mt}>
                  {t('arena.notEnteredBody')}
                </Text>
              )}
              <Text variant="caption" tone="muted" style={styles.mt}>
                {t('arena.stepsNote')}
              </Text>
            </Surface>
          ) : null}

          {/* 13.3 結算 */}
          {tt.status === 'settling' ? <InlineState kind="info" title={t('arena.settling.title')} body={t('arena.settling.body')} testID="arena-settling" /> : null}
          {tt.status === 'settled' && joined ? (
            <Surface style={styles.card} testID="arena-settled">
              {a.entry?.forfeited ? (
                <InlineState kind="error" title={t('arena.forfeited.title')} body={t('arena.forfeited.body', { v: tt.rules_version })} testID="arena-forfeited" />
              ) : (
                <>
                  <View style={styles.rowBetween}>
                    <Stat label={t('arena.finalRank')} value={a.entry?.rank ? `#${a.entry.rank}` : '—'} tint={color.mint} />
                    <Stat label={t('arena.group')} value={a.entry?.group === 1 ? 'A' : a.entry?.group === 2 ? 'B' : t('arena.groupNone')} tint={color.violet} />
                    <Stat label={t('arena.payout')} value={a.entry?.settled ? t('arena.paid') : t('arena.ready')} tint={a.entry?.settled ? color.success : color.cyan} />
                  </View>
                  <Text variant="bodySmall" tone="secondary" style={styles.mt}>
                    {a.entry?.group ? t('arena.winnerBody', { group: a.entry.group === 1 ? 'A' : 'B' }) : t('arena.loserBody', { refund: tt.loser_refund_bps / 100 })}
                    {tt.settlement ? t('arena.pool', { pool: tskr(tt.settlement.distributable_pool) }) : ''}
                  </Text>
                  {!a.entry?.settled ? <Button label={t('arena.claimPayout')} style={styles.mt} onPress={() => session && config && void a.claim(session.publicKey, config.mint, 'prize')} loading={a.busy === 'claim'} loadingLabel={t('arena.claiming')} disabled={Boolean(disabledReason) || a.busy !== null} disabledReason={disabledReason} testID="arena-claim" /> : null}
                </>
              )}
            </Surface>
          ) : null}
          {tt.status === 'cancelled' && joined ? (
            <Surface style={styles.card} testID="arena-cancelled">
              <Text variant="title">{t('arena.cancelled.title')}</Text>
              <Text variant="bodySmall" tone="secondary" style={styles.mt}>
                {t('arena.cancelled.body')}
              </Text>
              {!a.entry?.settled && !a.entry?.forfeited ? <Button label={t('arena.refund')} style={styles.mt} onPress={() => session && config && void a.claim(session.publicKey, config.mint, 'refund')} loading={a.busy === 'refund'} loadingLabel={t('arena.refunding')} disabled={Boolean(disabledReason) || a.busy !== null} disabledReason={disabledReason} testID="arena-refund" /> : null}
              {a.entry?.settled ? <Chip label={t('arena.refunded')} kind="synced" style={styles.mt} /> : null}
            </Surface>
          ) : null}

          {/* 排行榜 */}
          {a.leaderboard ? (
            <View style={styles.board} testID="arena-leaderboard">
              <View style={styles.rowBetween}>
                <Text variant="label" tone="muted" uppercase>
                  {t('arena.leaderboard')}
                </Text>
                <Text variant="caption" tone="muted">
                  {t('arena.updated', { time: new Date(a.leaderboard.generated_at).toLocaleTimeString(), n: a.leaderboard.total_players })}
                </Text>
              </View>
              {tt.status === 'settling' ? (
                <Text variant="caption" tone="warning" style={styles.mt}>
                  {t('arena.pending')}
                </Text>
              ) : null}
              {a.leaderboard.entries.length === 0 ? (
                <Text variant="bodySmall" tone="secondary" style={styles.mt}>
                  {t('arena.noSteps')}
                </Text>
              ) : (
                a.leaderboard.entries.slice(0, 25).map((e) => {
                  const you = session?.address === e.wallet;
                  return (
                    <Pressable key={e.wallet} onPress={() => navigation.navigate('GalleryPlayer', { wallet: e.wallet })} accessibilityRole="button" accessibilityLabel={t('arena.openPlayer', { name: you ? t('common.you') : shortAddress(e.wallet), rank: e.rank })} style={[styles.boardRow, you && styles.boardRowYou]} testID={you ? 'leaderboard-you' : `leaderboard-${e.rank}`}>
                      <Text variant="title" numeric style={styles.rank}>
                        #{e.rank}
                      </Text>
                      <Text variant="body" numeric style={styles.wallet}>
                        {you ? t('common.you') : shortAddress(e.wallet)}
                      </Text>
                      <Text variant="body" numeric tone={you ? 'mint' : 'primary'}>
                        {e.verified_steps.toLocaleString()}
                      </Text>
                    </Pressable>
                  );
                })
              )}
              {a.leaderboard.you?.rank && a.leaderboard.you.rank > 25 ? (
                <View style={[styles.boardRow, styles.boardRowYou]} testID="leaderboard-you">
                  <Text variant="title" numeric style={styles.rank}>
                    #{a.leaderboard.you.rank}
                  </Text>
                  <Text variant="body" numeric style={styles.wallet}>
                    {t('common.you')}
                  </Text>
                  <Text variant="body" numeric tone="mint">
                    {a.leaderboard.you.verified_steps.toLocaleString()}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </>
      ) : null}

      <Pressable onPress={() => navigation.navigate('Events')} accessibilityRole="button" accessibilityLabel={t('arena.events')} style={styles.eventsLink} testID="arena-events-link">
        <Surface style={styles.rowBetween}>
          <View style={styles.flex}>
            <Text variant="title">{t('arena.events')}</Text>
            <Text variant="caption" tone="muted">
              {t('arena.eventsBody')}
            </Text>
          </View>
          <Feather name="chevron-right" size={20} color={color.textMuted} />
        </Surface>
      </Pressable>

      <Text variant="caption" tone="muted" style={styles.disclaimer}>
        {t('common.testToken')}
      </Text>
    </Screen>
  );
}

function Row({ icon, label, value }: { icon: React.ComponentProps<typeof Feather>['name']; label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Feather name={icon} size={16} color={color.textMuted} style={styles.rowIcon} />
      <View style={styles.rowText}>
        <Text variant="label" tone="muted" uppercase>
          {label}
        </Text>
        <Text variant="bodySmall" numeric>
          {value}
        </Text>
      </View>
    </View>
  );
}

function Stat({ label, value, tint }: { label: string; value: string; tint: string }) {
  return (
    <View style={styles.stat}>
      <Text variant="label" tone="muted" uppercase>
        {label}
      </Text>
      <Text variant="heading2" numeric style={{ color: tint }}>
        {value}
      </Text>
    </View>
  );
}

type T = ReturnType<typeof useT>['t'];
const remaining = (t: T, secs: number) => (secs <= 0 ? t('arena.ended') : secs < 3600 ? t('arena.minutes', { n: Math.ceil(secs / 60) }) : t('arena.hoursMinutes', { h: Math.floor(secs / 3600), m: Math.floor((secs % 3600) / 60) }));
const outcomeTitle = (t: T, o: NonNullable<ReturnType<typeof useArenaStore.getState>['outcome']>) =>
  o.kind === 'success' ? t(`arena.ok.${o.action}` as TKey) : o.code === 'REJECTED' ? t('gear.walletCancelled') : o.code === 'NETWORK_ERROR' ? t('gear.networkUnavailable') : o.code === 'INSUFFICIENT_SOL' ? t('common.insufficientSol.title') : t(`arena.err.${o.action}` as TKey);

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.m },
  card: { marginTop: space.m },
  mt: { marginTop: space.s },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'flex-start', marginTop: space.s },
  rowIcon: { marginTop: 2, marginRight: space.s },
  rowText: { flex: 1 },
  ctaBlock: { marginTop: space.m },
  stat: { flex: 1 },
  board: { marginTop: space.xl },
  boardRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.s, borderBottomWidth: 1, borderBottomColor: color.borderSubtle },
  boardRowYou: { backgroundColor: color.elevated, borderRadius: radius.s, paddingHorizontal: space.xs, borderBottomWidth: 0, borderWidth: 1, borderColor: color.borderActive },
  rank: { width: 48 },
  wallet: { flex: 1 },
  disclaimer: { marginTop: space.l, textAlign: 'center' },
  eventsLink: { marginTop: space.xl },
  flex: { flex: 1 },
});
