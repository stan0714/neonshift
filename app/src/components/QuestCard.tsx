import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Chip, Surface } from '@/components';
import { useT, type TKey } from '@/i18n';
import type { QuestCard as QuestCardMeta, QuestCardState, QuestEnrollmentView, QuestTemplateView } from '@/services/api/ApiClient';
import { color, radius, space, Text } from '@/theme';

/**
 * XD-01 可操作任務卡（mobile-differentiation 4.1）：來源／目標／截止／資料要求／獎勵類型／難度／下一步一張卡看完。
 * 狀態固定：可接受 → 已接受 → 進行中 → 待驗證 → 可領 → 已領／已撤銷／已過期，由伺服器 `card_state` 決定，App 不自行推定。
 * 「開始」只帶入模式／目標到開始頁，不覆寫進行中的 session（進行中時改為「回到記錄」）；接受／開始皆不發鏈上交易。
 */
export type QuestCardProps = {
  template: QuestTemplateView;
  enrollment?: QuestEnrollmentView;
  /** 選分鐘（timed_goal 可接受狀態） */
  minutes?: number;
  onMinutes?: (m: number) => void;
  /** 進行中的運動 → 顯示「回到記錄」 */
  recording?: boolean;
  offline?: boolean;
  busy?: boolean;
  onAccept?: () => void;
  onStart?: () => void;
  onReturn?: () => void;
  onClaim?: () => void;
  testID?: string;
};

const CHIP: Record<QuestCardState, 'devnet' | 'synced' | 'offline' | 'level' | 'neutral'> = { available: 'neutral', accepted: 'neutral', in_progress: 'synced', pending_verification: 'devnet', claimable: 'synced', claimed: 'level', revoked: 'offline', expired: 'offline' };

export function stateOf(e: QuestEnrollmentView | undefined): QuestCardState {
  if (!e) return 'available';
  if (e.card_state) return e.card_state;
  // 舊後端沒有 card_state：由 status 退化推定（不含待驗證）
  return e.status === 'completed' ? 'claimable' : e.status === 'active' ? ((e.progress?.current ?? 0) > 0 ? 'in_progress' : 'accepted') : e.status;
}

export function QuestCard({ template, enrollment, minutes = 20, onMinutes, recording = false, offline = false, busy = false, onAccept, onStart, onReturn, onClaim, testID }: QuestCardProps) {
  const { t } = useT();
  const state = stateOf(enrollment);
  const card: QuestCardMeta | null = enrollment?.card ?? template.card ?? null;
  const goalMinutes = enrollment ? Number((enrollment.goal as { minutes?: number }).minutes ?? 0) : minutes;
  const title = t(`explore.quest.${template.template_id}` as TKey, { minutes: goalMinutes });
  const deadline = enrollment ? new Date(enrollment.period_end) : null;
  const gpsCounts = card?.requirements.gps_counts ?? false;
  // 下一步（Style：一句話說清楚該做什麼）
  const next: string = recording && (state === 'accepted' || state === 'in_progress') ? t('quest.next.recording')
    : state === 'available' ? t('quest.next.available')
    : state === 'accepted' ? (gpsCounts ? t('quest.next.accepted') : t('quest.next.acceptedNoGps'))
    : state === 'in_progress' ? t('quest.next.inProgress', { current: enrollment?.progress?.current ?? 0, target: enrollment?.progress?.target ?? 0 })
    : state === 'pending_verification' ? t('quest.next.pending', { n: enrollment?.pending_review_count ?? 1 })
    : state === 'claimable' ? (offline ? t('quest.next.claimableOffline') : t('quest.next.claimable'))
    : state === 'claimed' ? t('quest.next.claimed')
    : state === 'revoked' ? t('explore.revokedBody')
    : t('quest.next.expired');
  const canStart = !offline && (state === 'accepted' || state === 'in_progress' || state === 'pending_verification');
  return (
    <Surface style={styles.card} testID={testID ?? `quest-card-${template.template_id}-${state}`} accessible={false}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <Text variant="label" tone="muted" uppercase>{t('quest.source.system')} · {t(`quest.difficulty.${card?.difficulty ?? 'easy'}` as TKey)}</Text>
          <Text variant="title" style={styles.mtXxs}>{title}</Text>
        </View>
        <Chip label={t(`quest.state.${state}` as TKey)} kind={CHIP[state]} />
      </View>
      <Text variant="bodySmall" tone="secondary">{t(`explore.quest.${template.template_id}.body` as TKey)}</Text>

      {/* 目標分鐘（可接受＋timed_goal） */}
      {state === 'available' && template.kind === 'goal_time' && onMinutes ? (
        <View style={styles.row}>
          {((template.params as { minutes?: number[] }).minutes ?? [10, 20, 30]).map((m) => (
            <Pressable key={m} onPress={() => onMinutes(m)} accessibilityRole="radio" accessibilityState={{ selected: minutes === m }} style={[styles.pill, minutes === m && styles.pillOn]} testID={`explore-minutes-${m}`}>
              <Text variant="caption" style={minutes === m && styles.pillOnText}>{t('rec.goal.min', { n: m })}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* 事實列：截止／要求／獎勵 */}
      <View style={styles.facts}>
        <Fact icon="calendar" text={deadline ? t('quest.fact.deadline', { end: deadline.toLocaleString() }) : t('quest.fact.weekly')} />
        <Fact icon="check-circle" text={t('quest.fact.requirements', { min: card?.requirements.min_active_minutes ?? 10 })} />
        <Fact icon={gpsCounts ? 'map-pin' : 'alert-circle'} text={gpsCounts ? t('quest.fact.gpsCounts') : t('quest.fact.gpsNotYet')} tone={gpsCounts ? 'secondary' : 'warning'} />
        <Fact icon="image" text={t('quest.fact.reward', { name: t(`explore.cosmetic.${card?.reward.cosmetic_id ?? template.cosmetic_id}` as TKey) })} />
      </View>
      {enrollment?.progress && (state === 'in_progress' || state === 'pending_verification' || state === 'accepted') ? (
        <Text variant="bodySmall" tone="secondary" numeric testID={`explore-progress-${template.template_id}`}>{t('explore.progress', { current: enrollment.progress.current, target: enrollment.progress.target })}</Text>
      ) : null}

      <View style={styles.next} testID={`quest-next-${template.template_id}`}>
        <Text variant="caption" tone={state === 'revoked' || state === 'expired' ? 'warning' : 'secondary'}>{next}</Text>
      </View>

      {state === 'available' && onAccept ? <Button label={t('explore.accept')} variant="secondary" style={styles.mtXs} onPress={onAccept} loading={busy} disabled={busy || offline} testID={`explore-accept-${template.template_id}`} /> : null}
      {recording && canStart && onReturn ? <Button label={t('quest.return')} style={styles.mtXs} onPress={onReturn} testID={`quest-return-${template.template_id}`} /> : null}
      {!recording && canStart && onStart ? <Button label={t('quest.start')} style={styles.mtXs} onPress={onStart} disabled={busy} testID={`quest-start-${template.template_id}`} /> : null}
      {state === 'claimable' && !offline && onClaim ? <Button label={t('explore.claim')} style={styles.mtXs} onPress={onClaim} loading={busy} disabled={busy} testID={`explore-claim-${template.template_id}`} /> : null}
    </Surface>
  );
}

function Fact({ icon, text, tone = 'secondary' }: { icon: keyof typeof Feather.glyphMap; text: string; tone?: 'secondary' | 'warning' }) {
  return (
    <View style={styles.fact}>
      <Feather name={icon} size={14} color={tone === 'warning' ? color.warning : color.textMuted} />
      <Text variant="caption" tone={tone} style={styles.flex}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: space.s },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space.s },
  flex: { flex: 1, minWidth: 0 },
  mtXxs: { marginTop: space.xxs },
  mtXs: { marginTop: space.xs },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs },
  facts: { marginTop: space.s, gap: space.xxs },
  fact: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  next: { marginTop: space.s, padding: space.s, borderRadius: radius.m, backgroundColor: color.elevated },
  pill: { minHeight: 36, paddingHorizontal: space.s, borderRadius: radius.m, borderWidth: 1, borderColor: color.borderSubtle, alignItems: 'center', justifyContent: 'center' },
  pillOn: { backgroundColor: color.mint, borderColor: color.mint },
  pillOnText: { color: color.onMint },
});
