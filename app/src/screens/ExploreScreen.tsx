import { useNavigation } from '@react-navigation/native';
import { randomUUID } from 'expo-crypto';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';

import { Button, InlineState, Screen } from '@/components';
import { QuestCard } from '@/components/QuestCard';
import { SignInState } from '@/components/SignInState';
import { t as tStatic, useT, type TKey } from '@/i18n';
import { ApiError, apiClient, type QuestEnrollmentView, type QuestTemplateView, type QuestsResponse } from '@/services/api/ApiClient';
import { apiErrorText } from '@/services/api/errorText';
import { workoutRecorder } from '@/services/workouts/WorkoutRecorder';
import { useQuestCache } from '@/state/questCacheStore';
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
  // XD-01：離線／伺服器抖動時用最後快照顯示卡片（標 as of；不顯示領取鈕）
  const remember = useQuestCache((st) => st.remember); // 只取函式：整個 store 物件每次 set 都會變，放進 deps 會無限重載
  const [offlineAsOf, setOfflineAsOf] = useState<string | null>(null);
  // 進行中的運動：卡片改「回到記錄」，不再開第二場（不覆寫 session）
  const [recording, setRecording] = useState(false);
  useEffect(() => { setRecording(workoutRecorder.active() !== null); }, [data, loading]);

  const load = useCallback(async () => {
    if (!session) { setData(null); return; }
    setLoading(true);
    try {
      const r = await apiClient.quests();
      setData(r);
      setOfflineAsOf(null);
      setErr(null);
      void remember(session.address, r);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'UNKNOWN';
      if (code === 'NETWORK_ERROR') {
        if (!useQuestCache.getState().loaded) await useQuestCache.getState().load();
        const snap = useQuestCache.getState().forWallet(session.address);
        if (snap) { setData(snap.data); setOfflineAsOf(snap.asOf); setErr(null); return; }
      }
      setErr({ message: apiErrorText(tStatic, e), code }); // 用非 hook 的 t：useT 的 t 每次 render 都是新函式，放進 deps 會無限重載
    } finally {
      setLoading(false);
    }
  }, [session, remember]);
  useEffect(() => { void load(); }, [load]);

  /** 任務卡「開始」：帶入模板的目標到開始頁；進行中時回到記錄頁（recorder 也會擋，這裡先不讓使用者看到錯誤） */
  const start = (tp: QuestTemplateView, e: QuestEnrollmentView) => {
    if (workoutRecorder.active()) { navigation.navigate('WorkoutRecord'); return; }
    const goal = e.card?.start.goal ?? tp.card?.start.goal;
    const minutesOf = Number((e.goal as { minutes?: number }).minutes ?? 0);
    const preset = goal?.kind === 'time' ? { goal: { kind: 'time' as const, minutes: goal.minutes ?? minutesOf }, mode: 'run' as const, questId: e.enrollment_id } : { goal: { kind: 'free' as const }, questId: e.enrollment_id };
    navigation.navigate('WorkoutStart', { preset });
  };

  const accept = async (templateId: string) => {
    setBusy(templateId);
    setNotice(null);
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const r = await apiClient.acceptQuest({ template_id: templateId, goal: templateId === 'timed_goal' ? { minutes } : {}, timezone: tz, idempotency_key: randomUUID() });
      setNotice({ kind: r.already ? 'info' : 'success', title: r.already ? t('explore.alreadyAccepted') : t('explore.accepted'), body: t('explore.acceptedBody', { end: new Date(r.enrollment.period_end).toLocaleString() }) });
      await load();
    } catch (e) {
      setNotice({ kind: 'warning', title: t('explore.err', { message: apiErrorText(t, e) }) });
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
      setNotice({ kind: 'warning', title: e2 instanceof ApiError && e2.code === 'QUEST_NOT_COMPLETED' ? t('explore.notCompleted') : t('explore.err', { message: apiErrorText(t, e2) }) });
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
      {err ? (
        err.code === 'NO_SESSION' ? (
          <SignInState title={t('explore.signin.title')} body={t('explore.signin.body')} onSignedIn={load} testID="explore-signin" />
        ) : (
          <InlineState kind={err.code === 'NETWORK_ERROR' ? 'warning' : 'error'} title={err.code === 'NETWORK_ERROR' ? t('common.devnetBreak') : t('common.somethingInterrupted')} body={err.message} action={{ label: t('common.tryAgain'), onPress: () => void load(), loading }} testID="explore-error" />
        )
      ) : null}
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

      {offlineAsOf ? <InlineState kind="warning" title={t('quest.offline.title')} body={t('quest.offline.body', { asOf: new Date(offlineAsOf).toLocaleString() })} action={{ label: t('common.tryAgain'), onPress: () => void load(), loading }} testID="explore-offline" /> : null}
      <Text variant="label" tone="muted" uppercase style={styles.mt}>{t('explore.thisWeek')}</Text>
      {active.length === 0 ? <Text variant="bodySmall" tone="secondary" testID="explore-no-quests">{t('explore.noQuests')}</Text> : null}
      {active.map((e) => {
        const tp = (data?.templates ?? []).find((x) => x.template_id === e.template_id) ?? { template_id: e.template_id, version: e.template_version, kind: e.template_id === 'timed_goal' ? 'goal_time' as const : 'active_days' as const, params: {}, cosmetic_id: e.card?.reward.cosmetic_id ?? `chapter_01_${e.template_id}` };
        return (
          <QuestCard key={e.enrollment_id} template={tp} enrollment={e} recording={recording} offline={offlineAsOf !== null} busy={busy === e.enrollment_id}
            onStart={() => start(tp, e)} onReturn={() => navigation.navigate('WorkoutRecord')} onClaim={() => void claim(e)} testID={`explore-quest-${e.template_id}-${e.status}`} />
        );
      })}

      <Text variant="label" tone="muted" uppercase style={styles.mt}>{t('explore.pick')}</Text>
      {(data?.templates ?? []).filter((tp) => !enrolledTemplates.has(tp.template_id)).map((tp) => (
        <QuestCard key={tp.template_id} template={tp} minutes={minutes} onMinutes={setMinutes} offline={offlineAsOf !== null} busy={busy === tp.template_id} onAccept={() => void accept(tp.template_id)} testID={`explore-template-${tp.template_id}`} />
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s, marginTop: space.xs },
  cell: { width: '47%', aspectRatio: 1.4, borderRadius: radius.m, padding: space.s, justifyContent: 'flex-end', borderWidth: 1 },
  cellLit: { backgroundColor: color.surface, borderColor: color.mint },
  cellDark: { backgroundColor: color.elevated, borderColor: color.borderSubtle, opacity: 0.7 },
});
