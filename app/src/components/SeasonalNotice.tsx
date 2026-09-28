import * as SecureStore from 'expo-secure-store';
import { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, InlineState } from '@/components';
import { seasonalEditionName, seasonalReminderBody } from '@/domain/seasonalCopy';
import { seasonalNotificationPlan } from '@/domain/seasonalNotificationPlan';
import { nextSeasonalReminder, type SeasonalReminder } from '@/domain/seasonalReminder';
import { cancelAllSeasonalNotifications, syncSeasonalNotifications } from '@/services/notifications/seasonalNotifications';
import { useT, type TKey } from '@/i18n';
import { apiClient, type MySeasonalItem, type SeasonalCampaignView } from '@/services/api/ApiClient';
import { useSeasonalReminderStore } from '@/state/seasonalReminderStore';
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
 *
 * ── PG-SEASON-06：同一個浮層也負責「訂閱的一屆要開始／進行中／還能補同步」的提醒 ──
 * 兩種浮層互相蓋住才是真正的問題，所以共用這一個位置，**資格核准優先**（那是已經發生的事，
 * 提醒只是還沒發生的事）。這個浮層負責的是「打開 App 當下」該看到的提醒；
 * 不必打開 App 的那一半由本機排程通知負責（`services/notifications/seasonalNotifications.ts`，
 * 這支元件每次拿到活動資料時順手對齊排程）。仍然沒有遠端推播，訂閱清單只存在這台裝置上
 * （見 seasonalReminderStore）。
 * 未登入也會提醒——公開目錄看得到的活動就該能被提醒，但**沒有訂閱任何一屆時完全不發請求**。
 */
const POLL_MS = 5 * 60 * 1000;
const storageKeyOf = (address: string) => `seasonal-notices-v1.${address}`;

type Row = SeasonalCampaignView & Partial<Pick<MySeasonalItem, 'status'>>;

export function SeasonalNotice({ onOpen, visible = true }: { visible?: boolean; onOpen: () => void }) {
  const { t } = useT();
  const address = useWalletStore((s) => s.session?.address);
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<{ address: string | null; items: Row[] } | null>(null);
  const acknowledgedRef = useRef(new Set<string>());
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const reminders = useSeasonalReminderStore();
  const subscribed = reminders.subscribed;
  const dismissedReminders = reminders.dismissed;

  useEffect(() => { void reminders.load(); }, [reminders.load]);

  useEffect(() => {
    setRows(null);
    acknowledgedRef.current = new Set();
    // 沒登入又沒訂閱任何一屆：沒有要查的東西，不發請求。
    // 但**已排的通知要清掉**：使用者剛把最後一屆的提醒關掉時就是走到這裡，
    // 留著排程等於「關掉開關還是會被通知」。登入時走下面的路徑，空的計畫同樣會取消。
    if (!address && subscribed.length === 0) { void cancelAllSeasonalNotifications(); return; }
    let disposed = false;
    let running = false;
    let acknowledged = new Set<string>();
    const check = async () => {
      if (disposed || running || AppState.currentState !== 'active') return;
      running = true;
      try {
        const { items } = address ? await apiClient.mySeasonal() : await apiClient.seasonal();
        if (disposed) return;
        setRows({ address: address ?? null, items });
        // PG-SEASON-06：同一份資料順手把本機排程通知對齊（沒有權限時 service 直接跳過）。
        // 放在這裡是因為這支元件本來就會在回到前景與每 5 分鐘各拿一次活動資料，
        // 不必為排程另外發請求；排程算法是純函式，不需要畫面。
        void syncSeasonalNotifications(seasonalNotificationPlan(items, { now: new Date(), subscribed: new Set(subscribed) }));
      } catch {
        // 連不上不代表資格或窗口有變，也不清掉上一次的通知
      } finally {
        running = false;
      }
    };
    void (async () => {
      if (address) {
        try {
          const ids: unknown = JSON.parse((await SecureStore.getItemAsync(storageKeyOf(address))) ?? '[]');
          if (Array.isArray(ids)) acknowledged = new Set(ids.filter((id): id is string => typeof id === 'string'));
        } catch {
          // 本機收據讀不到就當沒讀過：寧可多提醒一次，也不要漏掉一屆
        }
      }
      if (disposed) return;
      acknowledgedRef.current = acknowledged;
      setSeen(acknowledged);
      await check();
    })();
    const timer = setInterval(() => void check(), POLL_MS);
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') void check(); });
    return () => { disposed = true; clearInterval(timer); subscription.remove(); };
  }, [address, subscribed.length]);

  const items = rows && rows.address === (address ?? null) ? rows.items : [];
  const nameOf = (themeId: string, year: number) => seasonalEditionName(t, themeId, year);

  if (!visible) return null;

  // 資格核准優先：那是已經發生的事，提醒只是還沒發生的事
  const approved = items.find((c) => c.status === 'eligible' && !seen.has(c.campaign_id) && !acknowledgedRef.current.has(c.campaign_id));
  if (approved && address) {
    const dismiss = () => {
      const next = new Set(seen).add(approved.campaign_id);
      acknowledgedRef.current = next;
      setSeen(next);
      void SecureStore.setItemAsync(storageKeyOf(address), JSON.stringify([...next])).catch(() => {});
    };
    return (
      <View style={[styles.card, { bottom: insets.bottom + space.s }]} accessibilityLiveRegion="polite" testID="seasonal-notice">
        <InlineState
          kind="success"
          title={t('season.notice.title')}
          body={t(approved.mint_enabled ? 'season.notice.claimable' : 'season.notice.notOpen', { name: nameOf(approved.theme_id, approved.year) })}
        />
        <View style={styles.actions}>
          <Button label={t('season.notice.open')} onPress={() => { onOpen(); dismiss(); }} style={styles.button} testID="seasonal-notice-open" />
          <Button label={t('common.close')} variant="secondary" onPress={dismiss} style={styles.button} testID="seasonal-notice-dismiss" />
        </View>
      </View>
    );
  }

  const reminder = nextSeasonalReminder(items, { now: new Date(), subscribed: new Set(subscribed), dismissed: new Set(dismissedReminders) });
  if (!reminder) return null;
  return (
    <View style={[styles.card, { bottom: insets.bottom + space.s }]} accessibilityLiveRegion="polite" testID={`seasonal-reminder-${reminder.phase}`}>
      <InlineState kind="info" title={t('season.reminder.title')} body={seasonalReminderBody(t, reminder, nameOf(reminder.themeId, reminder.year))} />
      <View style={styles.actions}>
        <Button label={t('season.notice.open')} onPress={() => { onOpen(); void reminders.dismiss(reminder.campaignId, reminder.phase); }} style={styles.button} testID="seasonal-reminder-see" />
        <Button label={t('common.close')} variant="secondary" onPress={() => void reminders.dismiss(reminder.campaignId, reminder.phase)} style={styles.button} testID="seasonal-reminder-close" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { position: 'absolute', left: space.m, right: space.m, padding: space.s, backgroundColor: color.surface, borderRadius: radius.m, borderWidth: 1, borderColor: color.mint },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  button: { flexGrow: 1 },
});
