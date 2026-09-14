import { Feather } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/Button';
import { Surface } from '@/components/Surface';
import { ctaFor, type TaskProgress, type TaskStatus, type TaskType } from '@/domain/taskEngine';
import { color, space, Text } from '@/theme';

type Props = {
  type: TaskType;
  status: TaskStatus;
  progress: TaskProgress;
  rewardLabel: string | null;
  onPress: () => void;
  disabledReason?: string;
  testID?: string;
};

/** 7.3 Mission Card：狀態視覺與 CTA 一一對應（In progress／Ready／Verifying／Wallet approval／Confirming／Claimed／Failed）。 */
export function MissionCard({ type, status, progress, rewardLabel, onPress, disabledReason, testID }: Props) {
  const cta = ctaFor(status, progress);
  const title = type === 'steps' ? 'Step mission' : 'Sleep mission';
  const icon: React.ComponentProps<typeof Feather>['name'] =
    status === 'claimed' ? 'check-circle' : status === 'rejected' ? 'alert-triangle' : status === 'awaiting_signature' ? 'credit-card' : type === 'steps' ? 'activity' : 'moon';
  const tint = status === 'claimed' ? color.success : status === 'rejected' ? color.danger : status === 'awaiting_signature' ? color.violet : status === 'verifying' || status === 'confirming' ? color.cyan : type === 'steps' ? color.mint : color.violet;
  const headline =
    status === 'ready' ? 'READY TO CLOCK IN' : status === 'claimed' ? 'CLAIMED TODAY' : status === 'rejected' ? 'NOT VERIFIED' : status === 'verifying' ? 'VERIFYING' : status === 'awaiting_signature' ? 'WALLET APPROVAL' : status === 'confirming' ? 'CONFIRMING' : 'IN PROGRESS';

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
      <Text variant="bodySmall" tone="secondary">
        {progress.met ? `Goal reached (${progress.value.toLocaleString()} / ${progress.goal.toLocaleString()})` : `${progress.remaining.toLocaleString()} to go`}
      </Text>
      <Button
        label={cta.label}
        variant={status === 'ready' || status === 'awaiting_signature' ? 'primary' : 'secondary'}
        disabled={!cta.enabled || Boolean(disabledReason)}
        disabledReason={disabledReason}
        loading={status === 'verifying' || status === 'confirming'}
        loadingLabel={cta.label}
        onPress={onPress}
        style={styles.cta}
      />
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: space.m },
  head: { flexDirection: 'row', alignItems: 'center' },
  headline: { marginLeft: space.xs },
  title: { marginTop: space.s },
  cta: { marginTop: space.m },
});
