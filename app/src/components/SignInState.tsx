import { useState } from 'react';

import { InlineState } from '@/components/InlineState';
import { apiClient } from '@/services/api/ApiClient';
import { useWalletStore } from '@/state/walletStore';
import { useT } from '@/i18n';

/**
 * 後端回 NO_SESSION 時的登入卡：就地以已連接的錢包簽一則登入訊息（SIWS，不是交易），成功後由畫面重新載入。
 * 實機回饋：探索冊只顯示「Sign in required · Try again」，使用者不知道要去哪裡登入；各頁原本都寫「請到競技場分頁完成」。
 */
export function SignInState({ title, body, onSignedIn, testID }: { title: string; body: string; onSignedIn: () => void | Promise<void>; testID: string }) {
  const { t } = useT();
  const session = useWalletStore((s) => s.session);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signIn = async () => {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      await apiClient.signIn(session.address);
      await onSignedIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };
  return (
    <InlineState
      kind={error ? 'warning' : 'info'}
      title={title}
      body={error ? t('signin.failed', { message: error }) : body}
      action={{ label: t('arena.signin.btn'), onPress: () => void signIn(), loading, loadingLabel: t('arena.signin.loading'), disabled: !session, disabledReason: session ? undefined : t('common.reasonConnectWallet'), testID: `${testID}-btn` }}
      testID={testID}
    />
  );
}
