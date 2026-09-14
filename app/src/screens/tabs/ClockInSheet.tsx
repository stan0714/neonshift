import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';

import { Button, InlineState, Surface } from '@/components';
import type { TaskType } from '@/domain/taskEngine';
import { runClaimFlow, type ClaimInput, type ClaimPhase } from '@/services/claim/ClaimFlow';
import { liveMotion } from '@/services/sensors/LiveMotionService';
import { color, radius, space, Text } from '@/theme';

type Props = {
  visible: boolean;
  input: ClaimInput | null;
  onClose: () => void;
  onPhase: (p: ClaimPhase) => void;
};

/** SA 附錄 A 拒絕碼 → 使用者可見文案（不揭露門檻） */
const REJECT_COPY: Record<string, { title: string; body: string }> = {
  SRC_UNATTRIBUTED: { title: 'Steps not attributed', body: 'Only steps counted by this phone qualify. Third-party or synced data is not used.' },
  SRC_MANUAL: { title: 'Manual steps not counted', body: 'Manually entered steps do not count toward missions.' },
  NO_SENSOR: { title: 'Motion check missing', body: 'Complete the 20-second motion check before claiming.' },
  LIVE_MOTION_INCOMPLETE: { title: 'Not enough movement recorded', body: 'Walk normally for the full 20 seconds in a safe place, then try again.' },
  TASK_NOT_MET: { title: 'Goal not reached yet', body: 'After filtering, your verified progress is below the goal. Keep moving.' },
  SLEEP_RANGE: { title: 'Sleep duration out of range', body: 'Sessions between 3 and 12 hours qualify.' },
  RISK_SCORE: { title: 'Claim could not be verified', body: 'This claim did not pass verification. You can try again tomorrow.' },
};

/**
 * 打卡引導（PG-A-13，Style 7.3／15）：live motion 倒數 → Verifying → Open wallet → Confirming → Confirmed／Failed。
 * 成功一次 medium haptic；loading／失敗不震動；文案說明資料／資金是否安全與下一步。
 */
export function ClockInSheet({ visible, input, onClose, onPhase }: Props) {
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
    if (final.kind === 'confirmed') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
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
          <Text variant="heading2">{input?.taskType === 'steps' ? 'Step mission' : 'Sleep mission'}</Text>
          {phase ? <PhaseView phase={phase} taskType={input?.taskType ?? 'steps'} /> : null}
          <View style={styles.actions}>
            {terminal ? <Button label="Done" onPress={onClose} /> : <Button label={phase?.kind === 'live_motion' ? 'Cancel check' : 'Cancel'} variant="secondary" onPress={cancel} disabled={phase?.kind === 'awaiting_signature' || phase?.kind === 'confirming'} disabledReason={phase?.kind === 'confirming' ? 'Waiting for the network to confirm' : undefined} />}
          </View>
        </Surface>
      </View>
    </Modal>
  );
}

function PhaseView({ phase, taskType }: { phase: ClaimPhase; taskType: TaskType }) {
  switch (phase.kind) {
    case 'live_motion': {
      const p = phase.progress;
      const ratio = p ? p.elapsedSeconds / p.durationSeconds : 0;
      return (
        <View style={styles.block} testID="phase-live-motion">
          <Text variant="body" tone="secondary">
            Walk normally for 20 seconds while holding your phone. Only a motion summary is kept.
          </Text>
          <View style={styles.countRow}>
            <Text variant="displayL" numeric tone="mint">
              {p ? Math.max(0, p.durationSeconds - p.elapsedSeconds) : 20}
            </Text>
            <Text variant="bodySmall" tone="muted" style={styles.countUnit}>
              s left · window {p ? p.windowIndex + 1 : 1}/{p?.windowCount ?? 2}
            </Text>
          </View>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.round(ratio * 100)}%` }]} />
          </View>
        </View>
      );
    }
    case 'verifying':
      return <Step icon="shield" text="Verifying your data with the attestor…" tint={color.cyan} testID="phase-verifying" />;
    case 'awaiting_signature':
      return <Step icon="credit-card" text="Approve the claim in your wallet." tint={color.violet} testID="phase-wallet" />;
    case 'confirming':
      return <Step icon="clock" text="Transaction sent. Waiting for devnet confirmation…" tint={color.cyan} testID="phase-confirming" />;
    case 'confirmed':
      return (
        <InlineState kind="success" title={`${taskType === 'steps' ? 'Step' : 'Sleep'} mission claimed`} body={phase.signature ? `tSKR sent to your wallet. Tx ${phase.signature.slice(0, 8)}…` : 'tSKR sent to your wallet.'} testID="phase-confirmed" />
      );
    case 'already_claimed':
      return <InlineState kind="info" title="Already claimed today" body="This mission was already claimed for today. Nothing was charged." testID="phase-already" />;
    case 'rejected': {
      const c = REJECT_COPY[phase.code] ?? { title: 'Claim not verified', body: phase.message };
      return <InlineState kind="warning" title={c.title} body={`${c.body}${phase.effectiveValue !== undefined ? ` Verified today: ${phase.effectiveValue.toLocaleString()}.` : ''}`} testID="phase-rejected" />;
    }
    case 'failed':
      return <InlineState kind="error" title={phase.code === 'CANCELLED' || phase.code === 'REJECTED' ? 'Request canceled' : 'Something interrupted your shift'} body={`${phase.message} Your wallet was not charged unless a transaction shows in it; retrying will never claim twice.`} referenceId={phase.referenceId} testID="phase-failed" />;
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
