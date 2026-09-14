import { useNavigation } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { Linking } from 'react-native';

import { Bullet, Button, InlineState, OnboardingLayout } from '@/components';
import { activityRecognition, type ActivityPermissionResult } from '@/services/permissions/ActivityRecognition';
import { useOnboardingStore } from '@/state/onboardingStore';
import { color } from '@/theme';

/**
 * Onboarding 3／4 — Activity Recognition（Style 10.3）。
 * 獨立說明其用於動作特徵摘要與提高作弊成本；不宣稱可完全證明真人步行。
 */
export function ActivityRecognitionScreen() {
  const navigation = useNavigation();
  const onboarding = useOnboardingStore();
  const [result, setResult] = useState<ActivityPermissionResult | 'unknown'>('unknown');
  const [busy, setBusy] = useState(false);

  const next = () => navigation.navigate('Onboarding', { screen: 'StarterShoe' });

  useEffect(() => {
    void activityRecognition.check().then((ok) => {
      if (ok) {
        setResult('granted');
        void onboarding.set({ activityGranted: true });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const request = async () => {
    setBusy(true);
    const r = await activityRecognition.request();
    setBusy(false);
    setResult(r);
    if (r === 'granted') {
      await onboarding.set({ activityGranted: true, activityDeferred: false });
      next();
    }
  };

  const defer = async () => {
    await onboarding.set({ activityDeferred: true });
    next();
  };

  return (
    <OnboardingLayout
      step={3}
      title="Add a short motion check"
      lead="Before your first step claim each day, NeonShift samples your phone's motion for 20 seconds while you walk."
      testID="onboarding-activity"
      actions={
        <>
          {result === 'granted' ? (
            <Button label="Continue" onPress={next} />
          ) : (
            <Button label="Allow activity recognition" loading={busy} loadingLabel="Requesting…" onPress={request} />
          )}
          {result === 'never_ask_again' ? <Button label="Open app settings" variant="secondary" style={{ marginTop: 12 }} onPress={() => void Linking.openSettings()} /> : null}
          {result !== 'granted' ? <Button label="Not now" variant="secondary" style={{ marginTop: 12 }} onPress={defer} /> : null}
        </>
      }
    >
      <Bullet icon="bar-chart-2" text="Only a statistical summary (cadence, rhythm, amplitude) is produced. No raw motion data is stored or uploaded." />
      <Bullet icon="shield" text="This raises the cost of faking steps. It is one signal among several, not proof of a real walk." tint={color.cyan} />
      <Bullet icon="clock" text="Runs in the foreground only, for 20 seconds, when you clock in." tint={color.textSecondary} />
      {result === 'denied' || result === 'never_ask_again' ? (
        <InlineState kind="warning" title="Motion check unavailable" body="Step missions need this check to submit a claim. Sleep missions are not affected. You can allow it later from Settings." testID="activity-denied" />
      ) : null}
    </OnboardingLayout>
  );
}
