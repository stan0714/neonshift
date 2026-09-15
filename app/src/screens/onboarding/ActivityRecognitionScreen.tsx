import { useNavigation } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { Linking } from 'react-native';

import { Bullet, Button, InlineState, OnboardingLayout } from '@/components';
import { activityRecognition, type ActivityPermissionResult } from '@/services/permissions/ActivityRecognition';
import { useOnboardingStore } from '@/state/onboardingStore';
import { color } from '@/theme';
import { useT } from '@/i18n';

/**
 * Onboarding 3／4 — Activity Recognition（Style 10.3）。
 * 獨立說明其用於動作特徵摘要與提高作弊成本；不宣稱可完全證明真人步行。
 */
export function ActivityRecognitionScreen() {
  const { t } = useT();
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
      title={t('activity.title')}
      lead={t('activity.lead')}
      testID="onboarding-activity"
      actions={
        <>
          {result === 'granted' ? (
            <Button label={t('common.continue')} onPress={next} />
          ) : (
            <Button label={t('activity.allow')} loading={busy} loadingLabel={t('activity.requesting')} onPress={request} />
          )}
          {result === 'never_ask_again' ? <Button label={t('activity.openSettings')} variant="secondary" style={{ marginTop: 12 }} onPress={() => void Linking.openSettings()} /> : null}
          {result !== 'granted' ? <Button label={t('common.notNow')} variant="secondary" style={{ marginTop: 12 }} onPress={defer} /> : null}
        </>
      }
    >
      <Bullet icon="bar-chart-2" text={t('activity.bullet1')} />
      <Bullet icon="shield" text={t('activity.bullet2')} tint={color.cyan} />
      <Bullet icon="clock" text={t('activity.bullet3')} tint={color.textSecondary} />
      {result === 'denied' || result === 'never_ask_again' ? (
        <InlineState kind="warning" title={t('activity.denied.title')} body={t('activity.denied.body')} testID="activity-denied" />
      ) : null}
    </OnboardingLayout>
  );
}
