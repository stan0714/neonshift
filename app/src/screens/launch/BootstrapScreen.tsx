import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useEffect } from 'react';
import { AccessibilityInfo, ActivityIndicator, Linking, StyleSheet, View } from 'react-native';

import { useBootstrap, type StepState } from '@/bootstrap';
import { Button, Chip, PulseMark, Screen, Surface, Wordmark } from '@/components';
import { APP_CONFIG } from '@/config/app';
import { color, space, Text } from '@/theme';

/**
 * App Bootstrap Loading（Style 8.2）。
 * < 300ms 不顯示；300ms–3s logo pulse＋目前步驟；> 3s 列出步驟與 `Use offline data`（有快取）；
 * > 10s 顯示 Retry、診斷摘要並停止無限 spinner。強制更新／維護中各有明確狀態，不偽裝成一般 loading。
 */
export function BootstrapScreen() {
  const navigation = useNavigation();
  const { phase, steps, currentLabel, result, diagnostics, retry, canUseOffline, continueOffline } = useBootstrap();

  // 8.4：Back／重試／離線進入不造成重複 stack → 一律 reset。
  // __DEV__：冷啟動帶 `neonshift://dev/health` 時，在 Landing 之上疊出診斷頁供實機驗證。
  useEffect(() => {
    if (phase !== 'done' || result?.kind !== 'ok') return;
    let cancelled = false;
    (async () => {
      const routes: { name: 'Landing' | 'Main' | 'DevHealth' }[] = [{ name: result.route }];
      if (__DEV__) {
        // `EXPO_PUBLIC_DEV_ROUTE=DevHealth npx expo start` 或冷啟動帶 neonshift://dev/health
        const url = await Linking.getInitialURL();
        if (process.env.EXPO_PUBLIC_DEV_ROUTE === 'DevHealth' || (url && /\/dev\/health(\?|$)/.test(url))) {
          routes.push({ name: 'DevHealth' });
        }
        // `EXPO_PUBLIC_DEV_ROUTE=Main`：程式尚未部署時直接看 tabs 版面（只有錢包已連線才有意義）
        if (process.env.EXPO_PUBLIC_DEV_ROUTE === 'Main' && result.route !== 'Main') routes.splice(0, 1, { name: 'Landing' }, { name: 'Main' });
      }
      if (!cancelled) navigation.reset({ index: routes.length - 1, routes });
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, result, navigation]);

  // 8.4：狀態更新使用 polite announcement
  useEffect(() => {
    if (currentLabel) AccessibilityInfo.announceForAccessibility(currentLabel);
  }, [currentLabel]);

  if (phase === 'hidden' || phase === 'done') {
    return <Screen testID="bootstrap-hidden" />;
  }

  const showSteps = phase === 'slow' || phase === 'stalled';
  const headline =
    phase === 'forceUpdate' ? 'Update required' : phase === 'maintenance' ? 'Under maintenance' : (currentLabel ?? 'Syncing your shift');

  return (
    <Screen testID="bootstrap-screen">
      <View style={styles.header}>
        <Wordmark />
        <Chip label="DEVNET" kind="devnet" />
      </View>

      <View style={styles.hero}>
        <PulseMark size={72} active={phase === 'loading' || phase === 'slow'} />
        <Text variant="heading2" style={styles.headline} accessibilityLiveRegion="polite">
          {headline}
        </Text>
        {phase === 'stalled' ? (
          <Text variant="bodySmall" tone="secondary" style={styles.sub}>
            This is taking longer than expected.
          </Text>
        ) : null}
        {phase === 'forceUpdate' ? (
          <Text variant="bodySmall" tone="secondary" style={styles.sub}>
            {result?.kind === 'blocked' && result.detail ? result.detail : 'This version is no longer supported.'}
          </Text>
        ) : null}
        {phase === 'maintenance' ? (
          <Text variant="bodySmall" tone="secondary" style={styles.sub}>
            {result?.kind === 'blocked' && result.retryAfter ? `Expected back ${result.retryAfter}` : 'Please try again shortly.'}
          </Text>
        ) : null}
      </View>

      {showSteps ? (
        <Surface style={styles.steps} accessibilityRole="list">
          {steps.map((s) => (
            <StepRow key={s.id} step={s} />
          ))}
        </Surface>
      ) : null}

      {phase === 'stalled' && diagnostics.length ? (
        <View style={styles.diag} accessibilityLabel="Diagnostics">
          {diagnostics.map((d) => (
            <Text key={d} variant="caption" tone="muted">
              {d}
            </Text>
          ))}
        </View>
      ) : null}

      <View style={styles.actions}>
        {phase === 'stalled' || phase === 'maintenance' ? <Button label="Retry" onPress={retry} /> : null}
        {phase === 'forceUpdate' ? <Button label="Update app" onPress={() => Linking.openURL(APP_CONFIG.storeUrl)} /> : null}
        {canUseOffline ? (
          <Button label="Use offline data" variant="secondary" onPress={continueOffline} style={styles.secondary} />
        ) : null}
      </View>

      <Text variant="caption" tone="muted" style={styles.footer}>
        Test environment · tSKR has no monetary value
      </Text>
    </Screen>
  );
}

function StepRow({ step }: { step: StepState }) {
  const icon = {
    pending: <Feather name="circle" size={20} color={color.textMuted} />,
    running: <ActivityIndicator size="small" color={color.cyan} />,
    done: <Feather name="check-circle" size={20} color={color.mint} />,
    skipped: <Feather name="minus-circle" size={20} color={color.textMuted} />,
    failed: <Feather name="alert-triangle" size={20} color={color.warning} />,
  }[step.status];
  const tone = step.status === 'done' ? 'primary' : step.status === 'failed' ? 'warning' : 'secondary';
  return (
    <View style={styles.stepRow} accessible accessibilityLabel={`${step.label}: ${step.status}`}>
      <View style={styles.stepIcon}>{icon}</View>
      <Text variant="body" tone={tone}>
        {step.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  hero: { alignItems: 'center', marginTop: space.hero },
  headline: { marginTop: space.xl, textAlign: 'center' },
  sub: { marginTop: space.xs, textAlign: 'center' },
  steps: { marginTop: space.xxl },
  stepRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.s },
  stepIcon: { width: 32, alignItems: 'center', marginRight: space.xs },
  diag: { marginTop: space.m },
  actions: { marginTop: 'auto', paddingTop: space.xl },
  secondary: { marginTop: space.s },
  footer: { textAlign: 'center', marginTop: space.m },
});
