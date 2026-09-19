import { useState } from 'react';

import { InlineState } from '@/components/InlineState';
import { ApiError, apiClient } from '@/services/api/ApiClient';
import { WalletError } from '@/services/wallet/WalletService';
import { useWalletStore } from '@/state/walletStore';
import { useT } from '@/i18n';

/**
 * 後端回 NO_SESSION 時的登入卡：就地以已連接的錢包簽一則登入訊息（SIWS，不是交易），成功後由畫面重新載入。
 * 實機回饋：探索冊只顯示「Sign in required · Try again」，使用者不知道要去哪裡登入；各頁原本都寫「請到競技場分頁完成」。
 * 實機回饋二：跑道上熱點斷線，簽完卻顯示「fetch failed … 確認錢包 App 已開啟」誤導成錢包問題——
 * 現在分成離線（已簽的訊息會保留，連上網再按一次不必重簽）／錢包取消／其他。
 */
export function SignInState({ title, body, onSignedIn, testID }: { title: string; body: string; onSignedIn: () => void | Promise<void>; testID: string }) {
  const { t } = useT();
  const session = useWalletStore((s) => s.session);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ kind: 'offline' | 'rejected' | 'other'; message: string } | null>(null);
  const signIn = async () => {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      await apiClient.signIn(session.address);
      await onSignedIn();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (e instanceof ApiError && e.code === 'NETWORK_ERROR') setError({ kind: 'offline', message });
      else if (e instanceof WalletError && e.code === 'REJECTED') setError({ kind: 'rejected', message });
      else setError({ kind: 'other', message });
    } finally {
      setLoading(false);
    }
  };
  const signedKept = !!session && (apiClient.hasPendingSignIn?.(session.address) ?? false); // 畫面測試的 apiClient mock 可能沒有此方法
  const errorBody = !error ? null
    : error.kind === 'offline' ? `${t('signin.offline')}${signedKept ? ` ${t('signin.offlineKept')}` : ''}`
    : error.kind === 'rejected' ? t('signin.rejected')
    : t('signin.failed', { message: error.message });
  return (
    <InlineState
      kind={error ? 'warning' : 'info'}
      title={title}
      body={errorBody ?? body}
      action={{ label: error?.kind === 'offline' && signedKept ? t('signin.retryVerify') : t('arena.signin.btn'), onPress: () => void signIn(), loading, loadingLabel: t('arena.signin.loading'), disabled: !session, disabledReason: session ? undefined : t('common.reasonConnectWallet'), testID: `${testID}-btn` }}
      testID={testID}
    />
  );
}
