import { Feather } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { InlineState, Screen, Surface } from '@/components';
import { APP_CONFIG } from '@/config/app';
import { ApiError, apiClient, type HistoryResponse } from '@/services/api/ApiClient';
import { formatTskr } from '@/state/dashboardStore';
import { color, radius, space, Text } from '@/theme';

const dateOf = (taskDate: number) => new Date(taskDate * 86_400_000).toISOString().slice(0, 10);

/**
 * Activity history（PG-A-20，FR-03.5，Style 19.1 #11）：近 30 天打卡紀錄與累計收益。
 * 資料來自 `/player/history`（attestation 紀錄 + finalized ClockedIn 事件的金額／XP）；
 * 只顯示保留期內資料（BR-25），空／錯誤狀態依 Style 14。
 */
export function ActivityHistoryScreen() {
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [error, setError] = useState<{ message: string; code: string; ref?: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await apiClient.history(30));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? { message: e.message, code: e.code, ...(e.requestId ? { ref: e.requestId } : {}) } : { message: String(e), code: 'UNKNOWN' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const claims = data?.items.length ?? 0;
  const redeemed = data?.items.filter((i) => i.redeemed_signature).length ?? 0;

  return (
    <Screen scroll testID="activity-screen" refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={color.mint} />}>
      <View style={styles.stats}>
        <Stat label="Earned · 30d" value={data ? `${formatTskr(BigInt(data.total_earned))} ${APP_CONFIG.tokenSymbol}` : '—'} tint={color.mint} />
        <Stat label="Clock-ins" value={data ? String(claims) : '—'} tint={color.cyan} />
        <Stat label="Onchain" value={data ? `${redeemed}/${claims}` : '—'} tint={color.violet} />
      </View>
      <Text variant="caption" tone="muted" style={styles.note}>
        Server keeps at most {data?.retention_days ?? 30} days of summaries. Onchain receipts are permanent and public.
      </Text>

      {error ? (
        error.code === 'NO_SESSION' ? (
          <InlineState kind="info" title="Sign in to see your history" body="History comes from your backend session. Sign in from the Arena tab or reconnect your wallet." testID="activity-signin" />
        ) : (
          <InlineState kind={error.code === 'NETWORK_ERROR' ? 'warning' : 'error'} title={error.code === 'NETWORK_ERROR' ? 'Devnet is taking a break' : 'Something interrupted your shift'} body={`${error.message} Your records are safe; nothing changed.`} referenceId={error.ref} action={{ label: 'Try again', onPress: () => void load(), loading }} testID="activity-error" />
        )
      ) : null}

      {data && data.items.length === 0 ? (
        <Surface style={styles.card} testID="activity-empty">
          <Text variant="title">No clock-ins yet</Text>
          <Text variant="bodySmall" tone="secondary" style={styles.mt}>
            Hit 8,000 steps or 7 hours of sleep and clock in from Home. Records show here for 30 days.
          </Text>
        </Surface>
      ) : null}

      {data?.items.map((i) => {
        const explorer = i.redeemed_signature ? `https://explorer.solana.com/tx/${i.redeemed_signature}?cluster=${APP_CONFIG.cluster}` : null;
        return (
          <Pressable key={`${i.task_date}-${i.task_type}`} onPress={() => explorer && void Linking.openURL(explorer)} disabled={!explorer} accessibilityRole={explorer ? 'link' : undefined} testID={`history-${i.task_date}-${i.task_type}`}>
            <Surface style={styles.row}>
              <Feather name={i.task_type === 'steps' ? 'activity' : 'moon'} size={20} color={i.task_type === 'steps' ? color.mint : color.violet} />
              <View style={styles.rowText}>
                <Text variant="title">{i.task_type === 'steps' ? 'Step mission' : 'Sleep mission'}</Text>
                <Text variant="caption" tone="muted" numeric>
                  {dateOf(i.task_date)} UTC{i.xp !== null ? ` · ${i.xp.toLocaleString()} XP` : ''}
                </Text>
              </View>
              <View style={styles.rowRight}>
                <Text variant="title" numeric tone={i.amount ? 'mint' : 'secondary'}>
                  {i.amount ? `+${formatTskr(BigInt(i.amount))}` : '—'}
                </Text>
                <Text variant="caption" tone={i.redeemed_signature ? 'success' : 'muted'}>
                  {i.redeemed_signature ? 'Onchain' : 'Not redeemed'}
                </Text>
              </View>
            </Surface>
          </Pressable>
        );
      })}

      <Text variant="caption" tone="muted" style={styles.disclaimer}>
        Test Token · No monetary value
      </Text>
    </Screen>
  );
}

function Stat({ label, value, tint }: { label: string; value: string; tint: string }) {
  return (
    <Surface style={styles.stat}>
      <Text variant="label" tone="muted" uppercase>
        {label}
      </Text>
      <Text variant="heading2" numeric style={{ color: tint }}>
        {value}
      </Text>
    </Surface>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', gap: space.xs },
  stat: { flex: 1, padding: space.s },
  note: { marginTop: space.xs },
  card: { marginTop: space.m },
  mt: { marginTop: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: space.s, padding: space.s, borderRadius: radius.m },
  rowText: { flex: 1, marginLeft: space.s },
  rowRight: { alignItems: 'flex-end' },
  disclaimer: { marginTop: space.l, textAlign: 'center' },
});
