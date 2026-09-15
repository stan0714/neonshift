import { useNavigation } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, InlineState, OnboardingLayout, Surface } from '@/components';
import { ShoeHero } from '@/components/ShoeHero';
import { APP_CONFIG } from '@/config/app';
import { ClaimError, lamportsToSol, starterShoeService, type ClaimQuote } from '@/services/chain/StarterShoeService';
import { useOnboardingStore } from '@/state/onboardingStore';
import { shortAddress, useWalletStore } from '@/state/walletStore';
import { color, space, Text } from '@/theme';
import { useT, type TKey } from '@/i18n';

type Phase = 'idle' | 'claiming' | 'success' | 'error';

/**
 * Onboarding 4／4 — Starter Shoe Claim（Style 10.4，2026-09-14 由 Mint 改為免費贈與）。
 * 不鑄造 NFT、不收費；跑鞋隨鏈上 PlayerProfile 建立直接給予。依序顯示 Action、Asset、Network、
 * Owner、Expected result、Fee（僅 rent＋交易費）；失敗保留重試，重試不會建立第二個 profile。
 */
export function StarterShoeScreen() {
  const { t } = useT();
  const navigation = useNavigation();
  const session = useWalletStore((s) => s.session);
  const onboarding = useOnboardingStore();
  const [quote, setQuote] = useState<ClaimQuote | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<ClaimError | null>(null);

  useEffect(() => {
    void starterShoeService.quote(session?.publicKey ?? null).then(setQuote);
  }, [session]);

  const claim = async () => {
    if (!session) return;
    setPhase('claiming');
    setError(null);
    try {
      await starterShoeService.claim(session.publicKey);
      await onboarding.set({ shoeMinted: true });
      setPhase('success');
      // 10.4：成功後播放一次 800ms reveal 再進入 Dashboard（PG-A-17 接正式動畫）
      setTimeout(() => navigation.reset({ index: 0, routes: [{ name: 'Main' }] }), 800);
    } catch (e) {
      setError(e instanceof ClaimError ? e : new ClaimError('FAILED', String(e)));
      setPhase('error');
    }
  };

  const errorCopy = error ? { title: t(`starter.err.${error.code}.title` as TKey), body: t(`starter.err.${error.code}.body` as TKey) } : null;

  return (
    <OnboardingLayout
      step={4}
      title={t('starter.title')}
      lead={t('starter.lead')}
      testID="onboarding-shoe"
      actions={
        <>
          <Button label={t('starter.claim')} loading={phase === 'claiming'} loadingLabel={t('starter.waiting')} disabled={!session || phase === 'success'} disabledReason={!session ? t('starter.connectFirst') : undefined} onPress={claim} />
          <Button label={t('common.back')} variant="secondary" style={styles.secondary} onPress={() => navigation.goBack()} />
        </>
      }
    >
      <View style={styles.hero}>
        <ShoeHero level={1} size={200} active={phase !== 'success'} />
      </View>
      <Surface hero>
        <Row label={t('starter.action')} value={t('starter.actionValue')} />
        <Row label={t('starter.asset')} value={t('starter.assetName')} />
        <Row label={t('starter.network')} value={quote?.network ?? `Solana ${APP_CONFIG.cluster}`} />
        <Row label={t('starter.owner')} value={session ? shortAddress(session.address) : t('common.notConnected')} />
        <Row label={t('starter.expected')} value={t('starter.expectedValue')} />
        <Row label={t('starter.fee')} value={quote ? t('starter.feeValue', { sol: lamportsToSol(quote.estimatedFeeLamports) }) : '—'} last />
      </Surface>
      <Text variant="caption" tone="muted" style={styles.note}>
        Test Token · No monetary value. Runs on Solana devnet.
      </Text>
      {phase === 'success' ? <InlineState kind="success" title={t('starter.success.title')} body={t('starter.success.body')} testID="claim-success" /> : null}
      {errorCopy ? <InlineState kind={error?.code === 'NOT_AVAILABLE' ? 'info' : 'error'} title={errorCopy.title} body={errorCopy.body} testID="claim-error" /> : null}
    </OnboardingLayout>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.row, !last && styles.rowBorder]}>
      <Text variant="label" tone="muted" uppercase>
        {label}
      </Text>
      <Text variant="body" style={styles.value}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', marginBottom: space.l },
  row: { paddingVertical: space.s },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: color.borderSubtle },
  value: { marginTop: space.xxs },
  note: { marginTop: space.m, textAlign: 'center' },
  secondary: { marginTop: space.s },
});
