import { useState } from 'react';
import { View } from 'react-native';
import { Button } from './Button';
import { Surface } from './Surface';
import type { ChainConfig, PlayerProfile } from '@/chain/accounts';
import type { TaskStatus } from '@/domain/taskEngine';
import { useT, type TKey } from '@/i18n';
import { space, Text } from '@/theme';

export function MissionJourney({ profile, config, statuses, onGear, onChallenges, onStartWorkout, onSteps }: {
  profile: PlayerProfile | null; config: ChainConfig | null; statuses: TaskStatus[];
  onGear: () => void; onChallenges: () => void;
  /** 兩個每日任務各自的入口：規則只用文字說明時，使用者讀完不知道該去哪裡做 */
  onStartWorkout: () => void; onSteps: () => void;
}) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);
  const done = statuses.filter(s => s === 'claimed').length;
  const ready = statuses.filter(s => s === 'ready').length;
  const next = profile && config ? config.shoeXpThresholds.findIndex(xp => xp > profile.xp) : -1;
  const remaining = next > 0 && profile && config ? config.shoeXpThresholds[next] - profile.xp : null;
  return <Surface style={{ marginTop: space.m }} testID="mission-journey">
    <View style={{ gap: space.s }}>
      <Text variant="heading2">{t('journey.title')}</Text>
      <Text variant="title" tone="mint">{t('journey.today', { done, total: statuses.length })}</Text>
      <Text variant="bodySmall" tone="secondary">{t(done === statuses.length ? 'journey.complete' : ready > 0 ? 'journey.ready' : 'journey.start', { n: ready })}</Text>
      <Text variant="bodySmall">{t('journey.rules')}</Text>
      <View style={{ gap: space.xs }}>
        <Button variant="secondary" label={t('journey.goWorkout')} onPress={onStartWorkout} testID="journey-go-workout" />
        <Button variant="secondary" label={t('journey.goSteps')} onPress={onSteps} testID="journey-go-steps" />
      </View>
      <Text variant="label">{t('journey.next')}</Text>
      {remaining !== null ? <>
        <Text variant="title">{t('journey.target', { name: t(`col.stage.${next + 1}` as TKey), xp: remaining.toString() })}</Text>
        <Text variant="caption" tone="secondary">{t('journey.claims', { n: ((remaining + 99n) / 100n).toString() })}</Text>
      </> : <Text variant="bodySmall" tone="secondary">{t(profile && config ? 'journey.max' : 'journey.unknown')}</Text>}
      <Button variant="secondary" label={t(expanded ? 'journey.less' : 'journey.more')} onPress={() => setExpanded(v => !v)} accessibilityState={{ expanded }} />
      {expanded ? <>
      <Button variant="secondary" label={t('journey.gear')} onPress={onGear} />
      <Text variant="label">{t('journey.challenge')}</Text>
      <Text variant="bodySmall" tone="secondary">{t('journey.milestones')}</Text>
      <Button variant="secondary" label={t('journey.browse')} onPress={onChallenges} />
      </> : null}
    </View>
  </Surface>;
}
