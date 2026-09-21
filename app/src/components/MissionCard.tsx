import { Feather } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/Button';
import { Surface } from '@/components/Surface';
import { SHOE_PROGRESSION } from '@/config/shoeProgression';
import { ctaFor, WORKOUT_GOAL_MOVING_MS, type TaskProgress, type TaskStatus, type TaskType } from '@/domain/taskEngine';
import type { WorkoutEvidence } from '@/state/dashboardStore';
import { color, space, Text } from '@/theme';
import { useT, type TKey } from '@/i18n';

type Props = {
  type: TaskType;
  status: TaskStatus;
  progress: TaskProgress;
  rewardLabel: string | null;
  onPress: () => void;
  disabledReason?: string;
  /** 運動任務：今日證據（未同步／待審／太短的說明用） */
  evidence?: WorkoutEvidence | null;
  testID?: string;
};

/** 7.3 Mission Card：狀態視覺與 CTA 一一對應（In progress／Ready／Verifying／Wallet approval／Confirming／Claimed／Failed）。 */
export function MissionCard({ type, status, progress, rewardLabel, onPress, disabledReason, evidence, testID }: Props) {
  const { t } = useT();
  const cta = ctaFor(status, progress);
  const title = type === 'steps' ? t('mission.steps') : type === 'workout' ? t('mission.workout') : t('mission.sleep');
  const icon: React.ComponentProps<typeof Feather>['name'] =
    status === 'claimed' ? 'check-circle' : status === 'rejected' ? 'alert-triangle' : status === 'awaiting_signature' ? 'credit-card' : type === 'steps' ? 'activity' : type === 'workout' ? 'map-pin' : 'moon';
  const tint = status === 'claimed' ? color.success : status === 'rejected' ? color.danger : status === 'awaiting_signature' ? color.violet : status === 'verifying' || status === 'confirming' ? color.cyan : type === 'steps' ? color.mint : color.violet;
  const headline = t(`mission.headline.${status === 'ready' || status === 'claimed' || status === 'rejected' || status === 'verifying' || status === 'awaiting_signature' || status === 'confirming' ? status : 'not_met'}` as TKey);

  return (
    <Surface active={status === 'ready'} style={styles.card} testID={testID}>
      <View style={styles.head}>
        <Feather name={icon} size={20} color={tint} />
        <Text variant="label" uppercase style={[styles.headline, { color: tint }]}>
          {headline}
        </Text>
      </View>
      <Text variant="title" style={styles.title}>
        {title}
        {rewardLabel ? <Text variant="title" tone="secondary">{`  ·  +${rewardLabel}`}</Text> : null}
      </Text>
      <Text variant="bodySmall" tone="secondary" testID={testID ? `${testID}-progress` : undefined}>
        {type === 'workout' ? workoutLine(t, progress, evidence ?? null) : progress.met ? t('mission.goalReached', { value: progress.value, goal: progress.goal }) : t('mission.toGo', { n: progress.remaining })}
      </Text>
      <Text variant="caption" tone="mint" style={styles.title}>{t('journey.xp', { n: SHOE_PROGRESSION.xpPerClaim[type] })}</Text>
      <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(progress.ratio * 100) }} style={{ marginTop: space.s, height: 5, backgroundColor: color.elevated, borderRadius: 3 }}>
        <View style={{ height: 5, borderRadius: 3, width: `${progress.ratio * 100}%`, backgroundColor: tint }} />
      </View>
      <Button
        label={t(cta.label)}
        variant={status === 'ready' || status === 'awaiting_signature' ? 'primary' : 'secondary'}
        disabled={!cta.enabled || Boolean(disabledReason)}
        disabledReason={disabledReason}
        loading={status === 'verifying' || status === 'confirming'}
        loadingLabel={t(cta.label)}
        onPress={onPress}
        style={styles.cta}
      />
    </Surface>
  );
}

/** 運動任務進度文字：達標（km）／今天沒有紀錄／未同步／待審／太短或太快結束 */
function workoutLine(t: ReturnType<typeof useT>['t'], progress: TaskProgress, ev: WorkoutEvidence | null): string {
  const km = (m: number) => (m / 1000).toFixed(2);
  if (progress.met) return t('mission.workout.reached', { km: km(progress.value) });
  if (!ev) return t('mission.workout.none');
  if (!ev.synced) return t('mission.workout.notSynced', { km: km(ev.distanceM) });
  if (ev.underReview) return t('mission.workout.review');
  if (ev.movingMs < WORKOUT_GOAL_MOVING_MS) return t('mission.workout.tooShortTime', { km: km(ev.distanceM) });
  return t('mission.workout.tooShort', { km: km(ev.distanceM) });
}

const styles = StyleSheet.create({
  card: { marginTop: space.m },
  head: { flexDirection: 'row', alignItems: 'center' },
  headline: { marginLeft: space.xs },
  title: { marginTop: space.s },
  cta: { marginTop: space.m },
});
