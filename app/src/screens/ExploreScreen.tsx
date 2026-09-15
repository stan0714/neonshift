import { useNavigation } from '@react-navigation/native';
import { randomUUID } from 'expo-crypto';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { Button, Chip, InlineState, Screen, Surface } from '@/components';
import { useT, type TKey } from '@/i18n';
import { ApiError, apiClient, type QuestEnrollmentView, type QuestsResponse } from '@/services/api/ApiClient';
import { useWalletStore } from '@/state/walletStore';
import { color, radius, space, Text } from '@/theme';

/**
 * 探索冊（PG-U-04；sport-experience-gameplay 5、Style 24）：自選任務 → 運動 → 可靠摘要確認 → 開啟一格 → 收藏外觀。
 * 進度與 XP／維持點／代幣各自顯示；不改鞋階倍率、不自動鑄 NFT。獎勵為帳號綁定外觀（無代幣、無交易價值、無能力加成）。
 * 抽象城市章節格子：不展示真實位置。
 */
const CHAPTER_CELLS = ['chapter_01_three_days', 'chapter_01_timed_goal'] as const;

export function ExploreScreen() {
  const { t } = useT();
  const navigation = useNavigation();
  const session = useWalletStore((s) => s.session);
  const [data, setData] = useState<QuestsResponse | null>(null);
  const [err, setErr] = useState<{ message: string; code: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [minutes, setMinutes] = useState(20);
  const [notice, setNotice] = useState<{ kind: 'success' | 'info' | 'warning'; title: string; body?: string } | null>(null);

  const load = useCallback(async () => {
    if (!session) { setData(null); return; }
    setLoading(true);
    try {
      setData(await apiClient.quests());
      setErr(null);
    } catch (e) {
      setErr({ message: e instanceof Error ? e.message : String(e), code: e instanceof ApiError ? e.code : 'UNKNOWN' });
    } finally {
      setLoading(false);
    }
  }, [session]);
  useEffect(() => { void load(); }, [load]);

  const accept = async (templateId: string) => {
    setBusy(templateId);
    setNotice(null);
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const r = await apiClient.acceptQuest({ template_id: templateId, goal: templateId === 'timed_goal' ? { minutes } : {}, timezone: tz, idempotency_key: randomUUID() });
      setNotice({ kind: r.already ? 'info' : 'success', title: r.already ? t('explore.alreadyAccepted') : t('explore.accepted'), body: t('explore.acceptedBody', { end: new Date(r.enrollment.period_end).toLocaleString() }) });
      await load();
    } catch (e) {
      setNotice({ kind: 'warning', title: t('explore.err', { message: e instanceof Error ? e.message : String(e) }) });
    } finally {
      setBusy(null);
    }
  };
  const claim = async (e: QuestEnrollmentView) => {
    setBusy(e.enrollment_id);
    setNotice(null);
    try {
      const r = await apiClient.claimQuest(e.enrollment_id);
      setNotice({ kind: 'success', title: r.already ? t('explore.alreadyClaimed') : t('explore.claimed'), body: t('explore.claimedBody', { name: t(`explore.cosmetic.${r.receipt.cosmetic_id}` as TKey) }) });
      await load();
    } catch (e2) {
      setNotice({ kind: 'warning', title: e2 instanceof ApiError && e2.code === 'QUEST_NOT_COMPLETED' ? t('explore.notCompleted') : t('explore.err', { message: e2 instanceof Error ? e2.message : String(e2) }) });
    } finally {
      setBusy(null);
    }
  };

  if (!session) return <Screen testID="explore-screen"><InlineState kind="info" title={t('act.signin.title')} body={t('act.signin.body')} testID="explore-signin" /></Screen>;
  const active = (data?.enrollments ?? []).filter((e) => e.status !== 'expired');
  const owned = new Set((data?.cosmetics ?? []).filter((c) => c.status === 'active').map((c) => c.cosmetic_id));
  const enrolledTemplates = new Set(active.filter((e) => e.status === 'active' || e.status === 'completed' || e.status === 'claimed').map((e) => e.template_id));
  return (
    <Screen scroll testID="explore-screen" refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={color.mint} />}>
      <Text variant="bodySmall" tone="secondary">{t('explore.intro')}</Text>
      <Text variant="caption" tone="muted" style={styles.mtXs}>{t('explore.separate')}</Text>
      {err ? <InlineState kind="error" title={t('common.somethingInterrupted')} body={err.message} action={{ label: t('common.tryAgain'), onPress: () => void load(), loading }} testID="explore-error" /> : null}
      {notice ? <InlineState kind={notice.kind} title={notice.title} body={notice.body} testID={`explore-${notice.kind}`} /> : null}

      <Text variant="label" tone="muted" uppercase style={styles.mt}>{t('explore.book')}</Text>
      <View style={styles.grid} testID="explore-book">
        {CHAPTER_CELLS.map((id, i) => {
          const lit = owned.has(id);
          return (
            <View key={id} style={[styles.cell, lit ? styles.cellLit : styles.cellDark]} accessible accessibilityLabel={`${t(`explore.cosmetic.${id}` as TKey)} · ${lit ? t('explore.cell.lit') : t('explore.cell.dark')}`} testID={`explore-cell-${id}-${lit ? 'lit' : 'dark'}`}>
              <Text variant="label" tone={lit ? 'mint' : 'muted'} uppercase>{t('explore.cell.index', { n: i + 1 })}</Text>
              <Text variant="bodySmall" tone={lit ? undefined : 'muted'}>{t(`explore.cosmetic.${id}` as TKey)}</Text>
            </View>
          );
        })}
      </View>

      <Text variant="label" tone="muted" uppercase style={styles.mt}>{t('explore.thisWeek')}</Text>
      {active.length === 0 ? <Text variant="bodySmall" tone="secondary" testID="explore-no-quests">{t('explore.noQuests')}</Text> : null}
      {active.map((e) => {
        const canClaim = e.status === 'completed';
        return (
          <Surface key={e.enrollment_id} style={styles.card} testID={`explore-quest-${e.template_id}-${e.status}`}>
            <View style={styles.rowBetween}>
              <Text variant="title">{t(`explore.quest.${e.template_id}` as TKey, { minutes: Number((e.goal as { minutes?: number }).minutes ?? 0) })}</Text>
              <Chip label={t(`explore.status.${e.status}` as TKey)} kind={e.status === 'claimed' ? 'level' : e.status === 'completed' ? 'synced' : e.status === 'revoked' ? 'offline' : 'neutral'} />
            </View>
            {e.progress ? (
              <Text variant="bodySmall" tone="secondary" numeric testID={`explore-progress-${e.template_id}`}>{t('explore.progress', { current: e.progress.current, target: e.progress.target })}</Text>
            ) : null}
            <Text variant="caption" tone="muted">{t('explore.period', { end: new Date(e.period_end).toLocaleString(), late: new Date(e.late_sync_until).toLocaleDateString() })}</Text>
            {e.status === 'revoked' ? <Text variant="caption" tone="warning">{t('explore.revokedBody')}</Text> : null}
            {canClaim ? <Button label={t('explore.claim')} style={styles.mtXs} onPress={() => void claim(e)} loading={busy === e.enrollment_id} disabled={busy !== null} testID={`explore-claim-${e.template_id}`} /> : null}
          </Surface>
        );
      })}

      <Text variant="label" tone="muted" uppercase style={styles.mt}>{t('explore.pick')}</Text>
      {(data?.templates ?? []).filter((tp) => !enrolledTemplates.has(tp.template_id)).map((tp) => (
        <Surface key={tp.template_id} style={styles.card} testID={`explore-template-${tp.template_id}`}>
          <Text variant="title">{t(`explore.quest.${tp.template_id}` as TKey, { minutes })}</Text>
          <Text variant="bodySmall" tone="secondary">{t(`explore.quest.${tp.template_id}.body` as TKey)}</Text>
          {tp.kind === 'goal_time' ? (
            <View style={styles.row}>
              {((tp.params as { minutes?: number[] }).minutes ?? [10, 20, 30]).map((m) => (
                <Pressable key={m} onPress={() => setMinutes(m)} accessibilityRole="radio" accessibilityState={{ selected: minutes === m }} style={[styles.pill, minutes === m && styles.pillOn]} testID={`explore-minutes-${m}`}>
                  <Text variant="caption" style={minutes === m && styles.pillOnText}>{t('rec.goal.min', { n: m })}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <Button label={t('explore.accept')} variant="secondary" style={styles.mtXs} onPress={() => void accept(tp.template_id)} loading={busy === tp.template_id} disabled={busy !== null} testID={`explore-accept-${tp.template_id}`} />
        </Surface>
      ))}
      {data && !data.rules.gps_rewards_enabled ? <Text variant="caption" tone="muted" style={styles.mt} testID="explore-gps-note">{t('explore.gpsNote')}</Text> : null}
      <Text variant="caption" tone="muted" style={styles.mt}>{t('explore.rules', { min: data?.rules.min_active_minutes ?? 10, late: data?.rules.late_sync_hours ?? 48 })}</Text>
      <Button label={t('explore.goRecord')} variant="secondary" style={styles.mt} onPress={() => navigation.navigate('WorkoutStart')} testID="explore-record" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  mt: { marginTop: space.m },
  mtXs: { marginTop: space.xs },
  card: { marginTop: space.s },
  row: { flexDirection: 'row', gap: space.xs, marginTop: space.xs },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s, marginTop: space.xs },
  cell: { width: '47%', aspectRatio: 1.4, borderRadius: radius.m, padding: space.s, justifyContent: 'flex-end', borderWidth: 1 },
  cellLit: { backgroundColor: color.surface, borderColor: color.mint },
  cellDark: { backgroundColor: color.elevated, borderColor: color.borderSubtle, opacity: 0.7 },
  pill: { minHeight: 36, paddingHorizontal: space.s, borderRadius: radius.m, borderWidth: 1, borderColor: color.borderSubtle, alignItems: 'center', justifyContent: 'center' },
  pillOn: { backgroundColor: color.mint, borderColor: color.mint },
  pillOnText: { color: color.onMint },
});
