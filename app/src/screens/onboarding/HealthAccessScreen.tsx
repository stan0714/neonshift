import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';

import { Bullet, Button, InlineState, OnboardingLayout } from '@/components';
import { HealthError, healthConnect, type HealthPermissionSummary } from '@/services/health/HealthConnectService';
import { useOnboardingStore } from '@/state/onboardingStore';
import { color } from '@/theme';

type Phase = 'idle' | 'checking' | 'requesting' | 'granted' | 'denied' | 'unavailable' | 'update_required' | 'unsupported';

/**
 * Onboarding 2／4 — Health Access（Style 10.2）。
 * 先說明只讀 Steps 與 Sleep，再由 CTA 觸發系統權限頁；拒絕後提供設定入口與 Not now，不反覆彈出。
 */
export function HealthAccessScreen() {
  const navigation = useNavigation();
  const onboarding = useOnboardingStore();
  const [phase, setPhase] = useState<Phase>('idle');
  const [summary, setSummary] = useState<HealthPermissionSummary | null>(null);

  const next = useCallback(() => navigation.navigate('Onboarding', { screen: 'ActivityRecognition' }), [navigation]);

  // 進入時只檢查狀態，不主動彈出權限 dialog（8.2 載入順序 3）
  useEffect(() => {
    let alive = true;
    (async () => {
      setPhase('checking');
      try {
        await healthConnect.assertUsable();
        const s = await healthConnect.getPermissions();
        if (!alive) return;
        setSummary(s);
        setPhase(s.state === 'granted' ? 'granted' : 'idle');
        if (s.state === 'granted') await onboarding.set({ healthGranted: true });
      } catch (e) {
        if (!alive) return;
        const code = e instanceof HealthError ? e.code : 'HC_UNAVAILABLE';
        setPhase(code === 'HC_UPDATE_REQUIRED' ? 'update_required' : code === 'HC_UNSUPPORTED_DEVICE' ? 'unsupported' : 'unavailable');
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const request = async () => {
    setPhase('requesting');
    try {
      const s = await healthConnect.requestRequiredPermissions();
      setSummary(s);
      if (s.state === 'granted') {
        await onboarding.set({ healthGranted: true, healthDeferred: false });
        setPhase('granted');
        next();
      } else {
        setPhase('denied');
      }
    } catch {
      setPhase('denied');
    }
  };

  const defer = async () => {
    await onboarding.set({ healthDeferred: true });
    next();
  };

  const blocked = phase === 'unavailable' || phase === 'update_required' || phase === 'unsupported';

  return (
    <OnboardingLayout
      step={2}
      title="Power missions with Health Connect"
      lead="NeonShift reads only your Steps and Sleep from Health Connect to check daily missions."
      testID="onboarding-health"
      actions={
        <>
          {phase === 'granted' ? (
            <Button label="Continue" onPress={next} />
          ) : blocked ? (
            <Button label="Continue without health data" variant="secondary" onPress={defer} />
          ) : (
            <Button label="Allow health access" loading={phase === 'requesting' || phase === 'checking'} loadingLabel="Opening Health Connect…" onPress={request} />
          )}
          {phase === 'denied' ? <Button label="Open Health Connect settings" variant="secondary" style={{ marginTop: 12 }} onPress={() => void healthConnect.openSettings()} /> : null}
          {phase !== 'granted' ? <Button label="Not now" variant="secondary" style={{ marginTop: 12 }} onPress={defer} /> : null}
        </>
      }
    >
      <Bullet icon="activity" text="Steps: unlock the daily 8,000-step mission." />
      <Bullet icon="moon" text="Sleep: unlock the 7-hour rest mission." tint={color.violet} />
      <Bullet icon="database" text="Only summaries reach our servers, kept for at most 30 days." tint={color.cyan} />
      <Bullet icon="settings" text="Manage later in Settings. Raw records never leave your device." tint={color.textSecondary} />

      {phase === 'denied' ? (
        <InlineState
          kind="warning"
          title="Health access is off"
          body={
            summary?.state === 'partial'
              ? 'Only some data types were allowed. Missions need both Steps and Sleep. Review access in Health Connect settings.'
              : 'Missions stay locked until access is allowed. Nothing else changes; you can enable it any time in Health Connect settings.'
          }
          testID="health-denied"
        />
      ) : null}
      {phase === 'unavailable' ? <InlineState kind="error" title="Health Connect is unavailable" body="This device does not provide Health Connect, so step and sleep missions cannot run here." /> : null}
      {phase === 'update_required' ? <InlineState kind="warning" title="Health Connect needs an update" body="Update Health Connect from the Play Store, then come back to allow access." /> : null}
      {phase === 'unsupported' ? <InlineState kind="warning" title="Device steps not supported" body="This Health Connect version cannot attribute steps to the device. Missions may be limited until the system updates." /> : null}
    </OnboardingLayout>
  );
}
