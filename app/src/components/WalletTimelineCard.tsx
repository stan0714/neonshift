import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Surface } from '@/components';
import { useT, type TKey } from '@/i18n';
import { walletTimeline, type WalletTimelineEntry } from '@/services/wallet/walletTimeline';
import { color, radius, space, Text } from '@/theme';

/**
 * XD-02：錢包互動時間線（Profile）。每次錢包操作分開列出 App 等待／錢包等待／回來後等待與結果；
 * 摘要列「記錄中 N 次」用來驗收「運動中自動彈出錢包＝0」（本 App 所有錢包操作都由使用者按鈕觸發，記錄中若出現也是使用者主動）。
 * 不含地址、簽章或交易內容。
 */
const sec = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)}s`);

export function WalletTimelineCard({ limit = 8 }: { limit?: number }) {
  const { t } = useT();
  const [entries, setEntries] = useState<WalletTimelineEntry[]>([]);
  useEffect(() => {
    const refresh = () => setEntries(walletTimeline.list());
    void walletTimeline.load().then(refresh);
    return walletTimeline.subscribe(refresh);
  }, []);
  const s = walletTimeline.summary();
  const recent = [...entries].reverse().slice(0, limit);
  return (
    <Surface testID="wallet-timeline">
      <Text variant="title">{t('wtl.title')}</Text>
      <Text variant="bodySmall" tone="secondary" style={styles.mtXs}>{t('wtl.body')}</Text>
      <View style={styles.summary} testID="wallet-timeline-summary">
        <Text variant="caption" tone="secondary">{t('wtl.summary', { total: s.total, recording: s.duringRecording, noReply: s.noReply, median: s.medianWalletWaitMs === null ? '—' : (s.medianWalletWaitMs / 1000).toFixed(1) })}</Text>
      </View>
      {recent.length === 0 ? <Text variant="caption" tone="muted" style={styles.mtXs}>{t('wtl.empty')}</Text> : null}
      {recent.map((e) => (
        <View key={e.id} style={styles.row} testID={`wallet-timeline-${e.id}`}>
          <View style={styles.flex}>
            <Text variant="bodySmall">{t(`wtl.op.${opKey(e.op)}` as TKey)}{e.duringRecording ? ` · ${t('wtl.duringRecording')}` : ''}</Text>
            <Text variant="caption" tone="muted">{new Date(e.startedAt).toLocaleString()} · {t('wtl.waits', { app: sec(e.appWaitMs), wallet: sec(e.walletWaitMs), back: sec(e.returnWaitMs) })}</Text>
          </View>
          <Text variant="caption" tone={e.result === 'ok' ? 'mint' : e.result === 'pending' ? 'secondary' : 'warning'} numeric>{t(`wtl.result.${e.result}` as TKey)}{e.code && e.result === 'error' ? ` (${e.code})` : ''}</Text>
        </View>
      ))}
      {entries.length ? <Button label={t('wtl.clear')} variant="secondary" style={styles.mtS} onPress={() => void walletTimeline.clear()} testID="wallet-timeline-clear" /> : null}
    </Surface>
  );
}

const KNOWN = new Set(['connect', 'signMessage', 'signAndSend', 'deauthorize', 'authorized', 'wallet']);
function opKey(op: string): string {
  if (op.startsWith('signAndSend:')) return 'signAndSendOn';
  return KNOWN.has(op) ? op : 'wallet';
}

const styles = StyleSheet.create({
  mtXs: { marginTop: space.xs },
  mtS: { marginTop: space.s },
  flex: { flex: 1, minWidth: 0 },
  summary: { marginTop: space.s, padding: space.s, borderRadius: radius.m, backgroundColor: color.elevated },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.s, paddingVertical: space.xs, borderBottomWidth: 1, borderBottomColor: color.borderSubtle },
});
