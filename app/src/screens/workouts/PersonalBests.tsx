import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Chip, Surface } from '@/components';
import { formatDuration, formatKm } from '@/domain/workouts';
import { useT, type TKey } from '@/i18n';
import { apiClient, type PersonalBests as Pbs } from '@/services/api/ApiClient';
import { color, space, Text } from '@/theme';

/**
 * 個人最佳（PG-R-07，FR-15.1／BR-38）：固定類別、官方與裝置分開、戶外與室內分開；Baseline／刷新次數；
 * 來源更正或刪除後重算並提示。只比較本平台已匯入的有效紀錄（顯示「自 YYYY-MM-DD」）。
 */
export function PersonalBests({ reloadKey = 0 }: { reloadKey?: number }) {
  const { t } = useT();
  const [data, setData] = useState<Pbs | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await apiClient.personalBests());
    } catch {
      setData((d) => d ?? { rules_major: 1, imported_since: null, groups: [] });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load, reloadKey]);
  if (!data) return null;
  const groups = data.groups.filter((g) => g.current || g.history.length);
  return (
    <Surface style={styles.card} testID="pbs">
      <Text variant="title">{t('pb.title')}</Text>
      {data.imported_since ? (
        <Text variant="caption" tone="muted">
          {t('pb.since', { date: data.imported_since.slice(0, 10) })}
        </Text>
      ) : null}
      {groups.length === 0 ? (
        <Text variant="bodySmall" tone="secondary" style={styles.mt} testID="pbs-empty">
          {t('pb.empty')}
        </Text>
      ) : null}
      {groups.map((g) => {
        const improvements = g.history.filter((h) => h.status === 'historical').length;
        const hadInvalid = g.history.some((h) => h.status === 'invalidated');
        return (
          <View key={g.key} style={styles.row} testID={`pb-${g.category}-${g.verification_class}`}>
            <View style={styles.flex}>
              <Text variant="body">{t(`pb.cat.${g.category}` as TKey)}</Text>
              <Text variant="caption" tone="muted">
                {t(`pb.class.${g.verification_class}` as TKey)}
                {g.environment === 'indoor' ? ` · ${t('wo.env.indoor')}` : ''}
                {g.current ? ` · ${new Date(g.current.achieved_at).toLocaleDateString()}` : ''}
              </Text>
              {hadInvalid ? (
                <Text variant="caption" tone="warning">
                  {t('pb.invalidated')}
                </Text>
              ) : null}
            </View>
            <View style={styles.right}>
              <Text variant="heading2" numeric>
                {g.current ? (g.current.unit === 'ms' ? formatDuration(g.current.value) : formatKm(g.current.value)) : '—'}
              </Text>
              {g.current ? <Chip label={g.current.is_baseline ? t('pb.baseline') : t('pb.improved', { n: improvements, count: improvements })} kind={g.current.is_baseline ? 'neutral' : 'synced'} /> : null}
            </View>
          </View>
        );
      })}
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: space.m },
  mt: { marginTop: space.s },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.s, paddingVertical: space.s, borderBottomWidth: 1, borderBottomColor: color.borderSubtle },
  flex: { flex: 1 },
  right: { alignItems: 'flex-end', gap: space.xs },
});
