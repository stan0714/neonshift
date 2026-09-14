import { useNavigation } from '@react-navigation/native';
import { useEffect } from 'react';

import { Bullet, Button, InlineState, OnboardingLayout } from '@/components';
import { APP_CONFIG } from '@/config/app';
import type { WalletErrorCode } from '@/services/wallet/WalletService';
import { shortAddress, useWalletStore } from '@/state/walletStore';
import { color } from '@/theme';

/** Style 10.1／14 的錯誤文案：說明發生什麼、資料是否安全、下一步 */
const ERROR_COPY: Record<WalletErrorCode, { title: string; body: string }> = {
  REJECTED: { title: 'Request canceled', body: 'You closed the wallet before approving. Nothing was signed. Try again when you are ready.' },
  WALLET_UNAVAILABLE: {
    title: 'No compatible wallet found',
    body: 'NeonShift connects through Mobile Wallet Adapter. Install a Seeker-compatible wallet (for example Seed Vault Wallet or Phantom) and try again.',
  },
  SESSION_EXPIRED: { title: 'Wallet session expired', body: 'Your previous authorization is no longer valid. Connect again to continue.' },
  NETWORK_ERROR: { title: 'Devnet is taking a break', body: 'The wallet session timed out. Check your connection and retry.' },
  UNKNOWN: { title: 'Something interrupted your shift', body: 'The wallet did not respond as expected. Nothing was signed. Try again.' },
};

/**
 * Onboarding 1／4 — Wallet Connection（Style 10.1）。
 * MWA 會開啟相容錢包；NeonShift 不會取得 seed phrase。
 */
export function WalletConnectScreen() {
  const navigation = useNavigation();
  const { status, session, error, connect, clearError } = useWalletStore();

  useEffect(() => {
    if (status === 'connected' && session) {
      navigation.navigate('Onboarding', { screen: 'HealthAccess' });
    }
  }, [status, session, navigation]);

  const copy = error ? ERROR_COPY[error.code] : null;

  return (
    <OnboardingLayout
      step={1}
      title="Connect your mission wallet"
      lead="NeonShift opens your Solana Mobile wallet to link an account. Your seed phrase never leaves the wallet."
      testID="onboarding-wallet"
      actions={
        <>
          <Button
            label={status === 'connecting' ? 'Connect wallet' : session ? `Continue as ${shortAddress(session.address)}` : 'Connect wallet'}
            loading={status === 'connecting'}
            loadingLabel="Opening wallet…"
            onPress={() => {
              clearError();
              void connect();
            }}
          />
        </>
      }
    >
      <Bullet icon="shield" text="Approve once in your wallet. NeonShift only receives your public address." />
      <Bullet icon="globe" text={`Network: Solana ${APP_CONFIG.cluster === 'devnet' ? 'Devnet' : APP_CONFIG.cluster}`} />
      <Bullet icon="info" text={`Rewards use ${APP_CONFIG.tokenSymbol} test tokens with no monetary value.`} tint={color.warning} />
      {copy ? <InlineState kind={error?.code === 'WALLET_UNAVAILABLE' ? 'warning' : 'error'} title={copy.title} body={copy.body} testID="wallet-error" /> : null}
    </OnboardingLayout>
  );
}
