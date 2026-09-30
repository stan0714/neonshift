import * as SecureStore from 'expo-secure-store';
import { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, InlineState } from '@/components';
import { useT } from '@/i18n';
import { apiClient, type AchievementView } from '@/services/api/ApiClient';
import { useWalletStore } from '@/state/walletStore';
import { color, radius, space } from '@/theme';

/**
 * R4（2026-09-29 review）：「查看」的**標已讀交給呼叫端**——導航成功才標。
 * 原本是 `onOpen(item); dismiss();`，導航失敗（例如 navRef 還沒 ready）時通知照樣消失，
 * 那枚核准就再也不會提醒第二次。
 */
export function ApprovalNotice({ onOpen, visible = true }: { visible?: boolean; onOpen: (item: AchievementView, markRead: () => void) => void }) {
  const { t } = useT();
  const address = useWalletStore(s => s.session?.address);
  const insets = useSafeAreaInsets();
  const [notice, setNotice] = useState<{ address: string; item: AchievementView } | null>(null);
  const acknowledgedRef = useRef(new Set<string>());
  const [seen, setSeen] = useState<Set<string>>(new Set());
  useEffect(() => {
    setNotice(null);
    acknowledgedRef.current = new Set();
    if (!address) return;
    let disposed = false;
    let running = false;
    const storageKey = `approval-notices-v1.${address}`;
    let acknowledged = new Set<string>();
    const check = async () => {
      if (disposed || running || AppState.currentState !== 'active') return;
      running = true;
      try {
        const { items } = await apiClient.myAchievements();
        if (disposed) return;
        const item = items.find(a => a.status === 'approved' && !a.minted && !acknowledgedRef.current.has(a.achievement_id));
        setNotice(item ? { address, item } : null);
      } catch { /* Network failures never imply approval or erase the last known notification. */ }
      finally { running = false; }
    };
    void (async () => {
      try {
        const ids: unknown = JSON.parse(await SecureStore.getItemAsync(storageKey) ?? '[]');
        if (Array.isArray(ids)) acknowledged = new Set(ids.filter((id): id is string => typeof id === 'string'));
      } catch { /* A missing local receipt should not hide an available claim. */ }
      if (disposed) return;
      acknowledgedRef.current = acknowledged;
      setSeen(acknowledged);
      await check();
    })();
    const timer = setInterval(() => void check(), 30_000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void check(); });
    return () => { disposed = true; clearInterval(timer); subscription.remove(); };
  }, [address]);
  // Dismissed IDs are also checked locally so an in-flight refresh cannot re-open the banner.
  if (!visible || !notice || notice.address !== address || seen.has(notice.item.achievement_id)) return null;
  const dismiss = () => {
    const next = new Set(seen).add(notice.item.achievement_id);
    acknowledgedRef.current = next;
    setSeen(next);
    setNotice(null);
    void SecureStore.setItemAsync(`approval-notices-v1.${address}`, JSON.stringify([...next])).catch(() => {});
  };
  return <View style={[styles.card, { bottom: insets.bottom + space.s }]} accessibilityLiveRegion="polite" testID="approval-notice">
    <InlineState kind="success" title={t('mint.flow.notice')} body={t('mint.flow.notice.body')} />
    <View style={styles.actions}>
      <Button label={t('mint.flow.open')} onPress={() => onOpen(notice.item, dismiss)} style={styles.button} testID="approval-open" />
      <Button label={t('common.close')} variant="secondary" onPress={dismiss} style={styles.button} testID="approval-dismiss" />
    </View>
  </View>;
}
const styles = StyleSheet.create({ card: { position: 'absolute', left: space.m, right: space.m, padding: space.s, backgroundColor: color.surface, borderRadius: radius.m, borderWidth: 1, borderColor: color.mint }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s }, button: { flexGrow: 1 } });
