import { Feather } from '@expo/vector-icons';
import { PublicKey } from '@solana/web3.js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { Button, Chip, InlineState, Screen, Surface } from '@/components';
import { APP_CONFIG } from '@/config/app';
import type { TournamentView } from '@/services/api/ApiClient';
import { useArenaStore, worstCaseLoss } from '@/state/arenaStore';
import { formatTskr, useDashboardStore } from '@/state/dashboardStore';
import { shortAddress, useWalletStore } from '@/state/walletStore';
import { color, radius, space, Text } from '@/theme';

const fmtUtc = (unix: number) => new Date(unix * 1000).toISOString().replace('T', ' ').slice(5, 16) + ' UTC';
const fmtLocal = (unix: number) => new Date(unix * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const tskr = (units: string | bigint) => `${formatTskr(typeof units === 'string' ? BigInt(units) : units)} ${APP_CONFIG.tokenSymbol}`;

/**
 * Arena（PG-A-15，Style 13）：未報名（13.1）／進行中（13.2）／結算（13.3），外加 Cancelled 退款。
 * 賽事狀態由後端讀鏈上；質押、領獎、退款走 MWA；步數回報走錢包簽章 challenge。
 */
export function ArenaScreen() {
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

  const t = a.current?.tournament ?? null;
  const joined = a.current?.player?.joined || a.entry !== null;
  const disabledReason = useMemo(() => {
    if (!session) return 'Connect your wallet';
    if (!APP_CONFIG.backendConfigured) return 'Backend not configured in this build';
    if (!APP_CONFIG.chainConfigured) return 'Onchain program not configured in this build';
    if (!config) return 'Waiting for onchain config';
    return undefined;
  }, [session, config]);

  const confirmJoin = (tt: TournamentView) => {
    if (!session || !config) return;
    Alert.alert(
      `Stake ${tskr(tt.stake_amount)} to enter?`,
      `Your stake goes to the tournament vault until settlement. If you do not place, you get ${tt.loser_refund_bps / 100}% back — the most you can lose is ${tskr(worstCaseLoss(tt))}. Forfeited entries (rule violations) get nothing back. Test token, no monetary value.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Stake & enter', onPress: () => void a.join(session.publicKey, config.mint) },
      ],
    );
  };

  return (
    <Screen scroll insideTabs testID="arena-screen" refreshControl={<RefreshControl refreshing={a.loading} onRefresh={() => void refresh()} tintColor={color.mint} />}>
      <View style={styles.header}>
        <Text variant="heading1">Arena</Text>
        <Chip label="DEVNET" kind="devnet" />
      </View>

      {a.outcome ? (
        <Pressable onPress={a.dismissOutcome} accessibilityRole="button" accessibilityLabel="Dismiss">
          <InlineState kind={a.outcome.kind === 'success' ? 'success' : a.outcome.code === 'REJECTED' ? 'warning' : 'error'} title={outcomeTitle(a.outcome)} body={a.outcome.message} testID={`arena-${a.outcome.kind}`} />
        </Pressable>
      ) : null}
      {a.needsSignIn && !t ? (
        <Surface style={styles.card} testID="arena-signin">
          <Text variant="title">Sign in to enter the arena</Text>
          <Text variant="bodySmall" tone="secondary" style={styles.mt}>
            Tournaments need a backend session. Sign the sign-in message with your wallet — no transaction, no fees.
          </Text>
          <Button label="Sign in with wallet" style={styles.mt} onPress={() => session && void a.signIn(session.publicKey)} loading={a.loading} loadingLabel="Signing in…" disabled={!session} disabledReason={session ? undefined : 'Connect your wallet'} testID="arena-signin-btn" />
        </Surface>
      ) : null}
      {a.error && !t ? <InlineState kind={APP_CONFIG.backendConfigured ? 'error' : 'info'} title={APP_CONFIG.backendConfigured ? 'Arena unavailable' : 'Backend not configured'} body={APP_CONFIG.backendConfigured ? `Could not load the tournament. ${a.error}` : 'This build has no backend URL, so tournaments are not available.'} testID="arena-error" /> : null}

      {!t && !a.error && !a.needsSignIn ? (
        a.loading ? null : (
          <Surface style={styles.card} testID="arena-empty">
            <Text variant="title">No tournament this week</Text>
            <Text variant="bodySmall" tone="secondary" style={styles.mt}>
              Weekend step marathons open on Fridays. Keep clocking in — XP counts every day.
            </Text>
          </Surface>
        )
      ) : null}

      {t ? (
        <>
          <Surface hero style={styles.card} testID="arena-tournament">
            <View style={styles.rowBetween}>
              <Text variant="label" tone="muted" uppercase>
                Week {Math.floor(t.week_id / 100)} · W{String(t.week_id % 100).padStart(2, '0')}
              </Text>
              <Chip label={statusLabel(t.status)} kind={t.status === 'running' ? 'synced' : t.status === 'cancelled' ? 'offline' : 'level'} />
            </View>
            <Text variant="heading2" style={styles.mt}>
              Weekend step marathon
            </Text>
            <Row icon="clock" label="Window (UTC)" value={`${fmtUtc(t.starts_at)} → ${fmtUtc(t.ends_at)}`} />
            <Row icon="map-pin" label="Your local time" value={`${fmtLocal(t.starts_at)} → ${fmtLocal(t.ends_at)}`} />
            <Row icon="lock" label="Entry stake" value={tskr(t.stake_amount)} />
            <Row icon="users" label="Entrants" value={`${t.entrant_count} · min ${t.min_entrants}${t.status !== 'registration' && t.status !== 'draft' ? ` · winners ${t.group_a_size + t.group_b_size} (A ${t.group_a_size} · B ${t.group_b_size})` : ''}`} />
            <Row icon="percent" label="Rules" value={`Winners refund 100% · others ${t.loser_refund_bps / 100}% · pool split A ${t.prize_a_bps / 100}% / B ${t.prize_b_bps / 100}% · rules v${t.rules_version}`} />
            {t.status === 'registration' ? <Row icon="calendar" label="Registration closes" value={`${fmtLocal(t.registration_ends_at)} (${remaining(t.registration_ends_at - now)})`} /> : null}
          </Surface>

          {/* 13.1 未報名 */}
          {t.status === 'registration' && !joined ? (
            <View style={styles.ctaBlock}>
              <Button label={`Stake ${tskr(t.stake_amount)} to enter`} onPress={() => confirmJoin(t)} loading={a.busy === 'join'} loadingLabel="Entering…" disabled={!t.registration_open || Boolean(disabledReason) || a.busy !== null} disabledReason={disabledReason ?? (!t.registration_open ? 'Registration closed' : undefined)} testID="arena-join" />
              <Text variant="caption" tone="muted" style={styles.mt}>
                Worst case you lose {tskr(worstCaseLoss(t))}. Cancelled tournaments (under {t.min_entrants} entrants) refund everything.
              </Text>
            </View>
          ) : null}
          {t.status === 'registration' && joined ? <InlineState kind="success" title="You are in" body="Your stake is in the vault. Come back when the window opens to report steps." testID="arena-joined" /> : null}
          {t.status === 'locked' ? <InlineState kind="info" title={joined ? 'Locked in' : 'Registration closed'} body={`Groups are fixed: ${t.group_a_size + t.group_b_size} winners out of ${t.valid_entrant_count}. Starts ${fmtLocal(t.starts_at)}.`} testID="arena-locked" /> : null}

          {/* 13.2 進行中 */}
          {t.status === 'running' ? (
            <Surface style={styles.card} testID="arena-running">
              <View style={styles.rowBetween}>
                <Stat label="Your rank" value={joined ? (a.current?.player?.rank ? `#${a.current.player.rank}` : '—') : 'Not entered'} tint={color.mint} />
                <Stat label="Verified steps" value={joined ? (a.current?.player?.verified_steps ?? 0).toLocaleString() : '—'} tint={color.cyan} />
                <Stat label="Ends in" value={remaining(t.ends_at - now)} tint={color.violet} />
              </View>
              {joined ? (
                <Button label="Report verified steps" variant="primary" style={styles.mt} onPress={() => void a.submitSteps({ appVersion: '0.1.0', deviceModel: 'Android', osApi: 34, sdkExtension: 0 })} loading={a.busy === 'steps'} loadingLabel="Verifying…" disabled={Boolean(disabledReason) || a.busy !== null} disabledReason={disabledReason} testID="arena-steps" />
              ) : (
                <Text variant="bodySmall" tone="secondary" style={styles.mt}>
                  You did not enter this week. Watch the board and join next time.
                </Text>
              )}
              <Text variant="caption" tone="muted" style={styles.mt}>
                Steps are read from Health Connect for the window only, signed by your wallet and verified server-side. Scores never decrease.
              </Text>
            </Surface>
          ) : null}

          {/* 13.3 結算 */}
          {t.status === 'settling' ? <InlineState kind="info" title="Settlement in progress" body="Results are being committed onchain. Ranks shown below are not final until settlement completes." testID="arena-settling" /> : null}
          {t.status === 'settled' && joined ? (
            <Surface style={styles.card} testID="arena-settled">
              {a.entry?.forfeited ? (
                <InlineState kind="error" title="Entry forfeited" body={`This entry was forfeited under rules v${t.rules_version}; the stake stays in the prize pool. Evidence is recorded onchain. To appeal, contact support@neonshift.cc with your wallet address.`} testID="arena-forfeited" />
              ) : (
                <>
                  <View style={styles.rowBetween}>
                    <Stat label="Final rank" value={a.entry?.rank ? `#${a.entry.rank}` : '—'} tint={color.mint} />
                    <Stat label="Group" value={a.entry?.group === 1 ? 'A' : a.entry?.group === 2 ? 'B' : 'None'} tint={color.violet} />
                    <Stat label="Payout" value={a.entry?.settled ? 'Paid' : 'Ready'} tint={a.entry?.settled ? color.success : color.cyan} />
                  </View>
                  <Text variant="bodySmall" tone="secondary" style={styles.mt}>
                    {a.entry?.group ? `Winner: 100% stake refund plus your share of the ${a.entry.group === 1 ? 'A' : 'B'} pool.` : `Stake refund ${t.loser_refund_bps / 100}%; no prize this time.`}
                    {t.settlement ? ` Pool ${tskr(t.settlement.distributable_pool)}.` : ''}
                  </Text>
                  {!a.entry?.settled ? <Button label="Claim payout" style={styles.mt} onPress={() => session && config && void a.claim(session.publicKey, config.mint, 'prize')} loading={a.busy === 'claim'} loadingLabel="Claiming…" disabled={Boolean(disabledReason) || a.busy !== null} disabledReason={disabledReason} testID="arena-claim" /> : null}
                </>
              )}
            </Surface>
          ) : null}
          {t.status === 'cancelled' && joined ? (
            <Surface style={styles.card} testID="arena-cancelled">
              <Text variant="title">Tournament cancelled</Text>
              <Text variant="bodySmall" tone="secondary" style={styles.mt}>
                Not enough entrants or the tournament was cancelled. Your full stake is refundable.
              </Text>
              {!a.entry?.settled && !a.entry?.forfeited ? <Button label="Refund my stake" style={styles.mt} onPress={() => session && config && void a.claim(session.publicKey, config.mint, 'refund')} loading={a.busy === 'refund'} loadingLabel="Refunding…" disabled={Boolean(disabledReason) || a.busy !== null} disabledReason={disabledReason} testID="arena-refund" /> : null}
              {a.entry?.settled ? <Chip label="Refunded" kind="synced" style={styles.mt} /> : null}
            </Surface>
          ) : null}

          {/* 排行榜 */}
          {a.leaderboard ? (
            <View style={styles.board} testID="arena-leaderboard">
              <View style={styles.rowBetween}>
                <Text variant="label" tone="muted" uppercase>
                  Leaderboard
                </Text>
                <Text variant="caption" tone="muted">
                  Updated {new Date(a.leaderboard.generated_at).toLocaleTimeString()} · {a.leaderboard.total_players} players
                </Text>
              </View>
              {t.status === 'settling' ? (
                <Text variant="caption" tone="warning" style={styles.mt}>
                  Pending verification — not final
                </Text>
              ) : null}
              {a.leaderboard.entries.length === 0 ? (
                <Text variant="bodySmall" tone="secondary" style={styles.mt}>
                  No verified steps yet.
                </Text>
              ) : (
                a.leaderboard.entries.slice(0, 25).map((e) => {
                  const you = session?.address === e.wallet;
                  return (
                    <View key={e.wallet} style={[styles.boardRow, you && styles.boardRowYou]} testID={you ? 'leaderboard-you' : undefined}>
                      <Text variant="title" numeric style={styles.rank}>
                        #{e.rank}
                      </Text>
                      <Text variant="body" numeric style={styles.wallet}>
                        {you ? 'You' : shortAddress(e.wallet)}
                      </Text>
                      <Text variant="body" numeric tone={you ? 'mint' : 'primary'}>
                        {e.verified_steps.toLocaleString()}
                      </Text>
                    </View>
                  );
                })
              )}
              {a.leaderboard.you?.rank && a.leaderboard.you.rank > 25 ? (
                <View style={[styles.boardRow, styles.boardRowYou]} testID="leaderboard-you">
                  <Text variant="title" numeric style={styles.rank}>
                    #{a.leaderboard.you.rank}
                  </Text>
                  <Text variant="body" numeric style={styles.wallet}>
                    You
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

      <Text variant="caption" tone="muted" style={styles.disclaimer}>
        Test Token · No monetary value
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

const statusLabel = (s: TournamentView['status']) => ({ draft: 'Draft', registration: 'Registration', locked: 'Locked', running: 'Live', settling: 'Settling', settled: 'Settled', cancelled: 'Cancelled' })[s];
const remaining = (secs: number) => (secs <= 0 ? 'ended' : secs < 3600 ? `${Math.ceil(secs / 60)}m` : `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`);
const outcomeTitle = (o: NonNullable<ReturnType<typeof useArenaStore.getState>['outcome']>) =>
  o.kind === 'success'
    ? { join: 'Entered the arena', steps: 'Steps verified', claim: 'Payout claimed', refund: 'Stake refunded' }[o.action]
    : o.code === 'REJECTED'
      ? 'Wallet approval cancelled'
      : o.code === 'NETWORK_ERROR'
        ? 'Network unavailable'
        : { join: 'Could not enter', steps: 'Steps not verified', claim: 'Payout failed', refund: 'Refund failed' }[o.action];

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
});
