import { useNavigation } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, InlineState, OnboardingLayout, Surface } from '@/components';
import { ShoeHero } from '@/components/ShoeHero';
import { APP_CONFIG } from '@/config/app';
import { lamportsToSol, MintError, shoeMintService, type MintQuote } from '@/services/chain/ShoeMintService';
import { useOnboardingStore } from '@/state/onboardingStore';
import { shortAddress, useWalletStore } from '@/state/walletStore';
import { color, space, Text } from '@/theme';

type Phase = 'idle' | 'minting' | 'success' | 'error';

/**
 * Onboarding 4／4 — Shoe Mint Confirmation（Style 10.4／7.7）。
 * 依序顯示 Action、Asset、Network、Owner、Expected result、Fee；失敗保留重試，不重複建立資產。
 */
export function ShoeMintScreen() {
  const navigation = useNavigation();
  const session = useWalletStore((s) => s.session);
  const onboarding = useOnboardingStore();
  const [quote, setQuote] = useState<MintQuote | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<MintError | null>(null);

  useEffect(() => {
    void shoeMintService.quote().then(setQuote);
  }, []);

  const mint = async () => {
    setPhase('minting');
    setError(null);
    try {
      await shoeMintService.mint();
      await onboarding.set({ shoeMinted: true });
      setPhase('success');
      // 10.4：成功後播放一次 800ms reveal 再進入 Dashboard（PG-A-17 接正式動畫）
      setTimeout(() => navigation.reset({ index: 0, routes: [{ name: 'Main' }] }), 800);
    } catch (e) {
      setError(e instanceof MintError ? e : new MintError('FAILED', String(e)));
      setPhase('error');
    }
  };

  const errorCopy = error
    ? {
        NOT_AVAILABLE: { title: 'Minting opens soon', body: 'Onchain minting is not enabled in this build. Your wallet and permissions are saved; nothing was charged.' },
        REJECTED: { title: 'Request canceled', body: 'You closed the wallet before approving. No asset was created and no fee was paid.' },
        NETWORK_ERROR: { title: 'Devnet is taking a break', body: 'The transaction could not be sent. Your wallet was not charged. Retry in a moment.' },
        ALREADY_MINTED: { title: 'Starter shoe already minted', body: 'This wallet already owns its starter shoe. Continuing to your dashboard.' },
        FAILED: { title: 'Something interrupted your shift', body: 'The mint did not complete. If a fee was charged the transaction will show in your wallet; retrying will not create a second shoe.' },
      }[error.code]
    : null;

  return (
    <OnboardingLayout
      step={4}
      title="Mint your starter shoe"
      lead="Your gear lives onchain and evolves with every verified mission. Approve the mint in your wallet."
      testID="onboarding-mint"
      actions={
        <>
          <Button label="Mint starter shoe" loading={phase === 'minting'} loadingLabel="Waiting for wallet…" disabled={!session || phase === 'success'} disabledReason={!session ? 'Connect a wallet first' : undefined} onPress={mint} />
          <Button label="Back" variant="secondary" style={styles.secondary} onPress={() => navigation.goBack()} />
        </>
      }
    >
      <View style={styles.hero}>
        <ShoeHero level={1} size={200} active={phase !== 'success'} />
      </View>
      <Surface hero>
        <Row label="Action" value="Mint starter shoe NFT" />
        <Row label="Asset" value={quote?.nftName ?? '—'} />
        <Row label="Network" value={quote?.network ?? `Solana ${APP_CONFIG.cluster}`} />
        <Row label="Owner" value={session ? shortAddress(session.address) : 'Not connected'} />
        <Row label="Expected result" value="One Lv.1 shoe in your wallet. Never a second one." />
        <Row label="Network fee" value={quote ? `~${lamportsToSol(quote.estimatedFeeLamports)} SOL` : '—'} last />
      </Surface>
      <Text variant="caption" tone="muted" style={styles.note}>
        Test Token · No monetary value. Runs on Solana devnet.
      </Text>
      {phase === 'success' ? <InlineState kind="success" title="Starter shoe minted" body="Welcome to your first shift." testID="mint-success" /> : null}
      {errorCopy ? <InlineState kind={error?.code === 'NOT_AVAILABLE' ? 'info' : 'error'} title={errorCopy.title} body={errorCopy.body} testID="mint-error" /> : null}
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
