import { useEffect } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, InlineState } from '@/components';
import { useT } from '@/i18n';
import { useBackendSessionStore } from '@/state/backendSessionStore';
import { useWalletStore } from '@/state/walletStore';
import { color, radius, space } from '@/theme';

/**
 * 「需要重新連結」浮層（2026-09-30）。
 *
 * 解的是實機上最難自己發現的一種狀態：**錢包連著、但後端登入已經失效**。
 * 首頁照常顯示位址，任務、同步、成就卻全都在送出前就被擋下——使用者看到的是
 * 「按了沒反應」，而畫面上沒有任何地方說該做什麼。
 *
 * 三個設計決定：
 * - **只在錢包連著時出現**。沒連錢包時「請登入」是理所當然的，不需要浮層。
 * - **一鍵重新連結，不重走新手流程**。失效的是後端 session，錢包授權還在，
 *   只要再簽一次 SIWS；把人丟回四步新手流程是另一個問題（見 onboarding 的第一次判定）。
 * - **蓋過其他浮層**。session 沒了的時候，核准通知與節日提醒點下去都不會成功，
 *   先解決這一個才有意義。
 */
export function SessionNotice({ visible = true }: { visible?: boolean }) {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const session = useWalletStore((s) => s.session);
  const state = useBackendSessionStore((s) => s.state);
  const reason = useBackendSessionStore((s) => s.reason);
  const restoring = useBackendSessionStore((s) => s.restoring);
  const check = useBackendSessionStore((s) => s.check);
  const restore = useBackendSessionStore((s) => s.restore);

  // 開 App 與回前景各對一次：token 可能在背景期間過期，不必等下一個請求失敗才知道
  useEffect(() => {
    if (!session) return;
    void check();
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') void check(); });
    return () => sub.remove();
  }, [session, check]);

  if (!visible || !session || state !== 'expired') return null;
  /**
   * 文案要分：`missing` 是「本機根本沒有 token」（拒簽 SIWS、登出），`invalid` 才是真的過期。
   * 兩者共用「你的登入已過期」會在使用者剛拒簽完的時候說一句假話（2026-10-02 實機）。
   */
  const k = reason === 'invalid' ? 'expired' : 'incomplete';
  return (
    <View style={[styles.card, { bottom: insets.bottom + space.s }]} accessibilityLiveRegion="polite" testID="session-notice">
      <InlineState kind="warning" title={t(`session.${k}.title`)} body={t(`session.${k}.body`)} />
      <Button
        label={t(`session.${k}.action`)}
        onPress={() => void restore(session.address)}
        loading={restoring}
        loadingLabel={t(`session.${k}.working`)}
        style={styles.button}
        testID="session-restore"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { position: 'absolute', left: space.m, right: space.m, padding: space.s, backgroundColor: color.surface, borderRadius: radius.m, borderWidth: 1, borderColor: color.warning },
  button: { marginTop: space.s },
});
