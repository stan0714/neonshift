import { RewardStage } from '@/components/RewardStage';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';

import { Button, InlineState, Surface } from '@/components';
import type { TaskType } from '@/domain/taskEngine';
import { runClaimFlow, type ClaimInput, type ClaimPhase } from '@/services/claim/ClaimFlow';
import { liveMotion } from '@/services/sensors/LiveMotionService';
import { color, radius, space, Text } from '@/theme';
import { useT, type TKey } from '@/i18n';
import { apiErrorText } from '@/services/api/errorText';

type Props = {
  visible: boolean;
  input: ClaimInput | null;
  onClose: () => void;
  onPhase: (p: ClaimPhase) => void;
};

/** SA 附錄 A 拒絕碼 → 使用者可見文案（不揭露門檻；i18n key `clock.reject.<code>.*`） */
const REJECT_CODES = ['SRC_UNATTRIBUTED', 'SRC_MANUAL', 'NO_SENSOR', 'LIVE_MOTION_INCOMPLETE', 'TASK_NOT_MET', 'SLEEP_RANGE', 'RISK_SCORE', 'WORKOUT_NOT_SYNCED', 'WORKOUT_UNDER_REVIEW'];

/**
 * 打卡引導（PG-A-13，Style 7.3／15）：live motion 倒數 → Verifying → Open wallet → Confirming → Confirmed／Failed。
 * 成功一次 medium haptic；loading／失敗不震動；文案說明資料／資金是否安全與下一步。
 */
export function ClockInSheet({ visible, input, onClose, onPhase }: Props) {
  const { t } = useT();
  const [phase, setPhase] = useState<ClaimPhase | null>(null);
  const running = useRef(false);

  const start = useCallback(async () => {
    if (!input || running.current) return;
    running.current = true;
    setPhase(input.taskType === 'steps' ? { kind: 'live_motion', progress: null } : { kind: 'verifying' });
    const final = await runClaimFlow(input, (p) => {
      setPhase(p);
      onPhase(p);
    });
    if (final.kind === 'confirmed') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    running.current = false;
  }, [input, onPhase]);

  useEffect(() => {
    if (visible && input) void start();
    if (!visible) setPhase(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, input]);

  const cancel = () => {
    if (phase?.kind === 'live_motion') void liveMotion.cancel();
    onClose();
  };

  const terminal = phase && ['confirmed', 'already_claimed', 'rejected', 'failed'].includes(phase.kind);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={cancel}>
      <View style={styles.scrim}>
        <Surface hero style={styles.sheet} testID="clockin-sheet">
          <Text variant="heading2">{input?.taskType === 'steps' ? t('mission.steps') : input?.taskType === 'workout' ? t('mission.workout') : t('mission.sleep')}</Text>
          {phase ? <PhaseView phase={phase} taskType={input?.taskType ?? 'steps'} /> : null}
          <View style={styles.actions}>
            {terminal ? <Button label={t('clock.done')} onPress={onClose} /> : <Button label={phase?.kind === 'live_motion' ? t('clock.cancelCheck') : t('common.cancel')} variant="secondary" onPress={cancel} disabled={phase?.kind === 'awaiting_signature' || phase?.kind === 'confirming'} disabledReason={phase?.kind === 'confirming' ? t('clock.waitingNetwork') : undefined} />}
          </View>
        </Surface>
      </View>
    </Modal>
  );
}

function PhaseView({ phase, taskType }: { phase: ClaimPhase; taskType: TaskType }) {
  const { t } = useT();
  switch (phase.kind) {
    case 'live_motion': {
      const p = phase.progress;
      const ratio = p ? p.elapsedSeconds / p.durationSeconds : 0;
      return (
        <View style={styles.block} testID="phase-live-motion">
          <Text variant="body" tone="secondary">
            {t('clock.motionLead')}
          </Text>
          <View style={styles.countRow}>
            <Text variant="displayL" numeric tone="mint">
              {p ? Math.max(0, p.durationSeconds - p.elapsedSeconds) : 20}
            </Text>
            <Text variant="bodySmall" tone="muted" style={styles.countUnit}>
              {t('clock.motionCount', { i: p ? p.windowIndex + 1 : 1, n: p?.windowCount ?? 2 })}
            </Text>
          </View>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.round(ratio * 100)}%` }]} />
          </View>
        </View>
      );
    }
    case 'verifying':
      return <Step icon="shield" text={t('clock.verifying')} tint={color.cyan} testID="phase-verifying" />;
    case 'awaiting_signature':
      return <Step icon="credit-card" text={t('clock.approve')} tint={color.violet} testID="phase-wallet" />;
    case 'confirming':
      return <Step icon="clock" text={t('clock.confirming')} tint={color.cyan} testID="phase-confirming" />;
    case 'confirmed':
      return (
        <View accessibilityLiveRegion="polite">
          <RewardStage mode="task"><Feather name="check" size={42} color={color.mint} /></RewardStage>
        <InlineState kind="success" title={taskType === 'steps' ? t('clock.claimed.steps') : taskType === 'workout' ? t('clock.claimed.workout') : t('clock.claimed.sleep')} body={phase.signature ? t('clock.claimed.bodyTx', { tx: phase.signature.slice(0, 8) }) : t('clock.claimed.body')} testID="phase-confirmed" /></View>
      );
    case 'already_claimed':
      return <InlineState kind="info" title={t('clock.already.title')} body={t('clock.already.body')} testID="phase-already" />;
    case 'rejected': {
      const c = REJECT_CODES.includes(phase.code) ? { title: t(`clock.reject.${phase.code}.title` as TKey), body: t(`clock.reject.${phase.code}.body` as TKey) } : { title: t('clock.notVerified'), body: phase.message };
      return <InlineState kind="warning" title={c.title} body={`${c.body}${phase.effectiveValue !== undefined ? t('clock.verifiedToday', { n: phase.effectiveValue }) : ''}`} testID="phase-rejected" />;
    }
    case 'failed':
      if (phase.code === 'INSUFFICIENT_SOL') return <InlineState kind="error" title={t('common.insufficientSol.title')} body={t('common.insufficientSol.body')} testID="phase-insufficient-sol" />;
      if (phase.code === 'WALLET_NO_REPLY') return <InlineState kind="error" title={t('wallet.err.WALLET_NO_REPLY.title')} body={t('wallet.err.WALLET_NO_REPLY.body')} testID="phase-failed" />;
      return <InlineState kind="error" title={phase.code === 'CANCELLED' || phase.code === 'REJECTED' ? t('common.requestCanceled') : t('common.somethingInterrupted')} body={t('clock.failed.body', { message: apiErrorText(t, phase.message) })} referenceId={phase.referenceId} testID="phase-failed" />;
    default:
      return null;
  }
}

function Step({ icon, text, tint, testID }: { icon: React.ComponentProps<typeof Feather>['name']; text: string; tint: string; testID: string }) {
  return (
    <View style={[styles.block, styles.row]} testID={testID}>
      <Feather name={icon} size={24} color={tint} />
      <Text variant="body" style={styles.rowText}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: color.scrim, justifyContent: 'flex-end' },
  sheet: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, paddingBottom: space.xxl },
  block: { marginTop: space.m },
  row: { flexDirection: 'row', alignItems: 'center' },
  rowText: { marginLeft: space.s, flex: 1 },
  countRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: space.m },
  countUnit: { marginLeft: space.s },
  track: { height: 6, borderRadius: radius.s, backgroundColor: color.elevated, marginTop: space.s, overflow: 'hidden' },
  fill: { height: 6, borderRadius: radius.s, backgroundColor: color.mint },
  actions: { marginTop: space.xl },
});
