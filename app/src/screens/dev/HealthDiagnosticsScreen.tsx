import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Chip, Screen, Surface } from '@/components';
import { healthConnect, taskDateOf, type HealthPermissionSummary } from '@/services/health/HealthConnectService';
import { liveMotion, toSensorSummaryPayload } from '@/services/sensors/LiveMotionService';
import type { LiveMotionProgress, LiveMotionSummary, SensorCapabilities } from '../../../modules/neonshift-sensors';
import { space, Text } from '@/theme';
import type { HealthStatus, SleepResult, StepsResult } from '../../../modules/neonshift-health';

/**
 * 開發用診斷頁（__DEV__ 才註冊）：在實機上驗證 PG-A-04 的 availability、SPN、權限、
 * aggregate 與來源歸因。不是產品畫面，不受 Style 19 交付檢查約束。
 */
export function HealthDiagnosticsScreen() {
  const [status, setStatus] = useState<HealthStatus | null>(null);
  const [perm, setPerm] = useState<HealthPermissionSummary | null>(null);
  const [steps, setSteps] = useState<StepsResult | null>(null);
  const [sleep, setSleep] = useState<SleepResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [caps, setCaps] = useState<SensorCapabilities | null>(null);
  const [progress, setProgress] = useState<LiveMotionProgress | null>(null);
  const [motion, setMotion] = useState<LiveMotionSummary | null>(null);

  const run = useCallback(async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    }
  }, []);

  const today = taskDateOf(Math.floor(Date.now() / 1000));

  return (
    <Screen scroll testID="health-diagnostics">
      <View style={styles.header}>
        <Text variant="heading1">Health Connect</Text>
        <Chip label="DEV" kind="level" />
      </View>

      <Button label="getStatus" variant="secondary" style={styles.btn} onPress={() => run(async () => setStatus(await healthConnect.getStatus()))} />
      <Button label="getPermissions" variant="secondary" style={styles.btn} onPress={() => run(async () => setPerm(await healthConnect.getPermissions()))} />
      <Button label="requestRequiredPermissions" style={styles.btn} onPress={() => run(async () => setPerm(await healthConnect.requestRequiredPermissions()))} />
      <Button label="openSettings" variant="secondary" style={styles.btn} onPress={() => run(() => healthConnect.openSettings())} />
      <Button label={`readSteps (task_date ${today})`} variant="secondary" style={styles.btn} onPress={() => run(async () => setSteps(await healthConnect.readStepsForTaskDate(today)))} />
      <Button label="readSleep" variant="secondary" style={styles.btn} onPress={() => run(async () => setSleep(await healthConnect.readSleepForTaskDate(today)))} />

      <Text variant="heading2" style={styles.section}>Sensors</Text>
      <Button label="getCapabilities" variant="secondary" style={styles.btn} onPress={() => run(async () => setCaps(await liveMotion.getCapabilities()))} />
      <Button
        label={progress && progress.elapsedSeconds < progress.durationSeconds ? `Sampling… ${progress.elapsedSeconds}/${progress.durationSeconds}s` : 'startLiveMotionCheck (20s)'}
        style={styles.btn}
        disabled={Boolean(progress && progress.elapsedSeconds < progress.durationSeconds)}
        onPress={() =>
          run(async () => {
            setMotion(null);
            const s = await liveMotion.run(setProgress);
            setProgress(null);
            setMotion(s);
          })
        }
      />
      <Button label="cancel" variant="secondary" style={styles.btn} onPress={() => run(() => liveMotion.cancel())} />

      {error ? (
        <Surface style={styles.card}>
          <Text variant="bodySmall" tone="danger">{error}</Text>
        </Surface>
      ) : null}
      {status ? <Dump title="status" value={status} /> : null}
      {perm ? <Dump title="permissions" value={perm} /> : null}
      {steps ? <Dump title="steps" value={steps} /> : null}
      {sleep ? <Dump title="sleep" value={sleep} /> : null}
      {caps ? <Dump title="sensors" value={caps} /> : null}
      {motion ? <Dump title="sensor_summary (payload)" value={toSensorSummaryPayload(motion)} /> : null}
      {motion ? <Dump title="live motion (raw summary)" value={motion} /> : null}
    </Screen>
  );
}

function Dump({ title, value }: { title: string; value: unknown }) {
  return (
    <Surface style={styles.card}>
      <Text variant="label" tone="cyan" uppercase>{title}</Text>
      <Text variant="caption" tone="secondary" style={styles.mono} selectable>
        {JSON.stringify(value, null, 2)}
      </Text>
    </Surface>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.m },
  btn: { marginTop: space.s },
  section: { marginTop: space.xl },
  card: { marginTop: space.m },
  mono: { fontFamily: 'monospace', marginTop: space.xs },
});
