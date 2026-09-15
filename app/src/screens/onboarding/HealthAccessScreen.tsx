import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';

import { Bullet, Button, InlineState, OnboardingLayout } from '@/components';
import { HealthError, healthConnect, type HealthPermissionSummary } from '@/services/health/HealthConnectService';
import { useOnboardingStore } from '@/state/onboardingStore';
import { color } from '@/theme';
import { useT } from '@/i18n';

type Phase = 'idle' | 'checking' | 'requesting' | 'granted' | 'denied' | 'unavailable' | 'update_required' | 'unsupported';

/**
 * Onboarding 2／4 — Health Access（Style 10.2）。
 * 先說明只讀 Steps 與 Sleep，再由 CTA 觸發系統權限頁；拒絕後提供設定入口與 Not now，不反覆彈出。
 */
export function HealthAccessScreen() {
  const { t } = useT();
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
      title={t('health.title')}
      lead={t('health.lead')}
      testID="onboarding-health"
      actions={
        <>
          {phase === 'granted' ? (
            <Button label={t('common.continue')} onPress={next} />
          ) : blocked ? (
            <Button label={t('health.continueWithout')} variant="secondary" onPress={defer} />
          ) : (
            <Button label={t('health.allow')} loading={phase === 'requesting' || phase === 'checking'} loadingLabel={t('health.opening')} onPress={request} />
          )}
          {phase === 'denied' ? <Button label={t('health.openSettings')} variant="secondary" style={{ marginTop: 12 }} onPress={() => void healthConnect.openSettings()} /> : null}
          {phase !== 'granted' ? <Button label={t('common.notNow')} variant="secondary" style={{ marginTop: 12 }} onPress={defer} /> : null}
        </>
      }
    >
      <Bullet icon="activity" text={t('health.bullet1')} />
      <Bullet icon="moon" text={t('health.bullet2')} tint={color.violet} />
      <Bullet icon="database" text={t('health.bullet3')} tint={color.cyan} />
      <Bullet icon="settings" text={t('health.bullet4')} tint={color.textSecondary} />

      {phase === 'denied' ? (
        <InlineState
          kind="warning"
          title={t('health.off.title')}
          body={summary?.state === 'partial' ? t('health.off.partial') : t('health.off.denied')}
          testID="health-denied"
        />
      ) : null}
      {phase === 'unavailable' ? <InlineState kind="error" title={t('health.unavailable.title')} body={t('health.unavailable.body')} /> : null}
      {phase === 'update_required' ? <InlineState kind="warning" title={t('health.update.title')} body={t('health.update.body')} /> : null}
      {phase === 'unsupported' ? <InlineState kind="warning" title={t('health.unsupported.title')} body={t('health.unsupported.body')} /> : null}
    </OnboardingLayout>
  );
}
