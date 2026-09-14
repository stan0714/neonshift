import { useNavigation } from '@react-navigation/native';
import { useEffect } from 'react';

import { Bullet, Button, InlineState, OnboardingLayout } from '@/components';
import { APP_CONFIG } from '@/config/app';
import type { WalletErrorCode } from '@/services/wallet/WalletService';
import { shortAddress, useWalletStore } from '@/state/walletStore';
import { color } from '@/theme';
import { useT, type TKey } from '@/i18n';

/** Style 10.1／14 的錯誤文案：說明發生什麼、資料是否安全、下一步 */
const ERROR_CODES: WalletErrorCode[] = ['REJECTED', 'WALLET_UNAVAILABLE', 'SESSION_EXPIRED', 'NETWORK_ERROR', 'UNKNOWN'];

/**
 * Onboarding 1／4 — Wallet Connection（Style 10.1）。
 * MWA 會開啟相容錢包；NeonShift 不會取得 seed phrase。
 */
export function WalletConnectScreen() {
  const { t } = useT();
  const navigation = useNavigation();
  const { status, session, error, connect, clearError } = useWalletStore();

  useEffect(() => {
    if (status === 'connected' && session) {
      navigation.navigate('Onboarding', { screen: 'HealthAccess' });
    }
  }, [status, session, navigation]);

  const code = error && ERROR_CODES.includes(error.code) ? error.code : error ? 'UNKNOWN' : null;
  const copy = code ? { title: t(`wallet.err.${code}.title` as TKey), body: t(`wallet.err.${code}.body` as TKey) } : null;

  return (
    <OnboardingLayout
      step={1}
      title={t('wallet.title')}
      lead={t('wallet.lead')}
      testID="onboarding-wallet"
      actions={
        <>
          <Button
            label={status === 'connecting' ? t('common.connectWallet') : session ? t('wallet.continueAs', { address: shortAddress(session.address) }) : t('common.connectWallet')}
            loading={status === 'connecting'}
            loadingLabel={t('wallet.opening')}
            onPress={() => {
              clearError();
              void connect();
            }}
          />
        </>
      }
    >
      <Bullet icon="shield" text={t('wallet.bullet1')} />
      <Bullet icon="globe" text={t('wallet.bullet2', { network: APP_CONFIG.cluster === 'devnet' ? 'Devnet' : APP_CONFIG.cluster })} />
      <Bullet icon="info" text={t('wallet.bullet3', { symbol: APP_CONFIG.tokenSymbol })} tint={color.warning} />
      {copy ? <InlineState kind={error?.code === 'WALLET_UNAVAILABLE' ? 'warning' : 'error'} title={copy.title} body={copy.body} testID="wallet-error" /> : null}
    </OnboardingLayout>
  );
}
