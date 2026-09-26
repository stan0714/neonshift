import * as SecureStore from 'expo-secure-store';
import { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, InlineState } from '@/components';
import { useT, type TKey } from '@/i18n';
import { apiClient, type MySeasonalItem } from '@/services/api/ApiClient';
import { useWalletStore } from '@/state/walletStore';
import { color, radius, space } from '@/theme';

/**
 * 節日資格核准通知（PG-SEASON-05；設計 §4.3／§4.4）。
 *
 * 只在**資格核准**（`status: 'eligible'`）時出現，而且文案跟著後端的 `mint_enabled`：
 * 目前一律 false，所以說的是「本屆尚未開放領取，達標紀錄會留著」，**不是**「可以領取了」。
 * 伺服器核准的是資格，不是 NFT（§4.3 明寫不能直接播放「NFT 已到手」），所以這裡
 * 沒有領取按鈕、沒有揭曉動畫——那兩件事要等 PG-SEASON-04 真的有 mint 路徑。
 *
 * `pending_review`（已上傳、等待驗證）不彈通知：那個狀態在收藏頁上本來就看得到，
 * 為「還沒核准」跳一個浮層只會讓人以為已經拿到了。
 *
 * 輪詢間隔比成就核准通知（30 s）長很多：一屆的資格一生只會轉一次，
 * 沒有必要每半分鐘問一次伺服器。回到前景時會立刻檢查一次。
 */
const POLL_MS = 5 * 60 * 1000;
const storageKeyOf = (address: string) => `seasonal-notices-v1.${address}`;

export function SeasonalNotice({ onOpen, visible = true }: { visible?: boolean; onOpen: () => void }) {
  const { t } = useT();
  const address = useWalletStore((s) => s.session?.address);
  const insets = useSafeAreaInsets();
  const [notice, setNotice] = useState<{ address: string; item: MySeasonalItem } | null>(null);
  const acknowledgedRef = useRef(new Set<string>());
  const [seen, setSeen] = useState<Set<string>>(new Set());

  useEffect(() => {
    setNotice(null);
    acknowledgedRef.current = new Set();
    if (!address) return;
    let disposed = false;
    let running = false;
    let acknowledged = new Set<string>();
    const check = async () => {
      if (disposed || running || AppState.currentState !== 'active') return;
      running = true;
      try {
        const { items } = await apiClient.mySeasonal();
        if (disposed) return;
        const item = items.find((c) => c.status === 'eligible' && !acknowledgedRef.current.has(c.campaign_id));
        setNotice(item ? { address, item } : null);
      } catch {
        // 連不上不代表資格有變，也不清掉上一次的通知
      } finally {
        running = false;
      }
    };
    void (async () => {
      try {
        const ids: unknown = JSON.parse((await SecureStore.getItemAsync(storageKeyOf(address))) ?? '[]');
        if (Array.isArray(ids)) acknowledged = new Set(ids.filter((id): id is string => typeof id === 'string'));
      } catch {
        // 本機收據讀不到就當沒讀過：寧可多提醒一次，也不要漏掉一屆
      }
      if (disposed) return;
      acknowledgedRef.current = acknowledged;
      setSeen(acknowledged);
      await check();
    })();
    const timer = setInterval(() => void check(), POLL_MS);
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') void check(); });
    return () => { disposed = true; clearInterval(timer); subscription.remove(); };
  }, [address]);

  // 已關掉的也在本機比一次，避免進行中的刷新把浮層又打開
  if (!visible || !notice || notice.address !== address || seen.has(notice.item.campaign_id)) return null;
  const dismiss = () => {
    const next = new Set(seen).add(notice.item.campaign_id);
    acknowledgedRef.current = next;
    setSeen(next);
    setNotice(null);
    void SecureStore.setItemAsync(storageKeyOf(address!), JSON.stringify([...next])).catch(() => {});
  };
  const name = (() => {
    const key = `season.name.${notice.item.theme_id}` as TKey;
    const s = t(key);
    return s === key ? notice.item.theme_id : s;
  })();
  return (
    <View style={[styles.card, { bottom: insets.bottom + space.s }]} accessibilityLiveRegion="polite" testID="seasonal-notice">
      <InlineState
        kind="success"
        title={t('season.notice.title')}
        body={t(notice.item.mint_enabled ? 'season.notice.claimable' : 'season.notice.notOpen', { name: `${name} ${notice.item.year}` })}
      />
      <View style={styles.actions}>
        <Button label={t('season.notice.open')} onPress={() => { onOpen(); dismiss(); }} style={styles.button} testID="seasonal-notice-open" />
        <Button label={t('common.close')} variant="secondary" onPress={dismiss} style={styles.button} testID="seasonal-notice-dismiss" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { position: 'absolute', left: space.m, right: space.m, padding: space.s, backgroundColor: color.surface, borderRadius: radius.m, borderWidth: 1, borderColor: color.mint },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  button: { flexGrow: 1 },
});
