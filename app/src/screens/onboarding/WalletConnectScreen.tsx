import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';

import { Bullet, Button, InlineState, OnboardingLayout } from '@/components';
import { APP_CONFIG } from '@/config/app';
import type { WalletErrorCode } from '@/services/wallet/WalletService';
import { shortAddress, useWalletStore } from '@/state/walletStore';
import { color } from '@/theme';
import { useT, type TKey } from '@/i18n';
import { accountExists } from '@/services/chain/ChainClient';
import { playerPda } from '@/chain/program';
import { nextOnboardingStep } from '@/domain/onboardingStep';
import { useOnboardingStore } from '@/state/onboardingStore';

/** Style 10.1／14 的錯誤文案：說明發生什麼、資料是否安全、下一步 */
const ERROR_CODES: WalletErrorCode[] = ['REJECTED', 'WALLET_UNAVAILABLE', 'SESSION_EXPIRED', 'NETWORK_ERROR', 'WALLET_NO_REPLY', 'STORAGE_ERROR', 'UNKNOWN'];

/**
 * Onboarding 1／4 — Wallet Connection（Style 10.1）。
 * MWA 會開啟相容錢包；NeonShift 不會取得 seed phrase。
 */
export function WalletConnectScreen() {
  const { t } = useT();
  // 只取 load 本身（zustand 的 action identity 穩定）。取整個 store 會讓 effect 的依賴在
  // load() 內部 set() 之後改變 → effect 重跑 → 再 load()，形成無窮迴圈（實際踩到，OOM）。
  const loadOnboarding = useOnboardingStore((st) => st.load);
  const navigation = useNavigation();
  const { status, session, error, connect, phase, loginIncomplete } = useWalletStore();

  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (status !== 'connecting') return;
    const timer = setTimeout(() => setSlow(true), 12000);
    return () => clearTimeout(timer);
  }, [status, phase]);

  /**
   * 連上之後去哪一步由**實際狀態**決定，不是無條件從第一步開始（2026-09-30）。
   * 斷線重連的人權限早就給了、起始鞋也早就有了，卻被迫再走一次四步——實機上使用者
   * 第一個反應就是問這是不是正常的。權限看本機 flags（裝置層），起始鞋看鏈上 profile（錢包層）。
   */
  /**
   * 依實際狀態決定下一步。effect（連線成功）與「Continue as …」按鈕共用同一套——
   * 後者存在是為了「錢包連上但後端登入未完成」那個情境：畫面先說明問題，
   * 使用者仍可選擇照樣前進，所以它**不能**是 no-op。
   */
  const goNext = useCallback(async (): Promise<void> => {
    if (!session) return;
    const flags = await loadOnboarding();
    let exists: boolean | null = null;
    try { exists = await accountExists(playerPda(session.publicKey)); } catch { exists = null; }
    const step = nextOnboardingStep(flags, { profileExists: exists });
    if (step === 'Main') navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
    else navigation.navigate('Onboarding', { screen: step });
  }, [session, loadOnboarding, navigation]);

  useEffect(() => {
    if (status !== 'connected' || !session || loginIncomplete) return;
    let cancelled = false;
    void (async () => {
      const flags = await loadOnboarding();
      // 整段包起來：playerPda() 是**同步** throw（公鑰不合法時），
      // 掛在 accountExists(...) 上的 .catch 在參數求值時還沒接上，effect 會整個死掉、
      // 使用者卡在錢包頁不動。查不到就當 null，交給 nextOnboardingStep 保守處理。
      let exists: boolean | null = null;
      try { exists = await accountExists(playerPda(session.publicKey)); } catch { exists = null; }
      if (cancelled) return;
      const step = nextOnboardingStep(flags, { profileExists: exists });
      if (step === 'Main') navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
      else navigation.navigate('Onboarding', { screen: step });
    })();
    return () => { cancelled = true; };
  }, [status, session, loginIncomplete, navigation, loadOnboarding]);

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
            loadingLabel={t(`wallet.phase.${phase ?? 'opening'}` as TKey)}
            onPress={() => {
              if (session && status === 'connected') void goNext();
              else void connect();
            }}
          />
        </>
      }
    >
      <Bullet icon="shield" text={t('wallet.bullet1')} />
      <Bullet icon="globe" text={t('wallet.bullet2', { network: APP_CONFIG.cluster === 'devnet' ? 'Devnet' : APP_CONFIG.cluster })} />
      <Bullet icon="info" text={t('wallet.bullet3', { symbol: APP_CONFIG.tokenSymbol })} tint={color.warning} />
      {status === 'connecting' ? <InlineState kind="info" title={t(`wallet.phase.${phase ?? 'opening'}` as TKey)} body={t(slow ? 'wallet.waitLong' : 'wallet.waitHint')} testID="wallet-progress" /> : null}
      {status === 'connected' && loginIncomplete ? <InlineState kind="warning" title={t('wallet.loginIncomplete.title')} body={t('wallet.loginIncomplete.body')} testID="wallet-login-incomplete" /> : null}
      {copy ? <InlineState kind={error?.code === 'WALLET_UNAVAILABLE' ? 'warning' : 'error'} title={copy.title} body={`${phase ? t(`wallet.phase.${phase}` as TKey) + ' · ' : ''}${copy.body}`} referenceId={code ?? undefined} testID="wallet-error" /> : null}
    </OnboardingLayout>
  );
}
