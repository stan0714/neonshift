import { useNavigation } from '@react-navigation/native';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { Button, InlineState, Screen, Surface } from '@/components';
import { SPLIT_KM_MM, SPLIT_MILE_MM } from '@/domain/gps/engine';
import { useT, type TKey } from '@/i18n';
import { workoutRecorder } from '@/services/workouts/WorkoutRecorder';
import { color, radius, space, Text } from '@/theme';

type Seg<T extends string> = { value: T; label: string };
function Segmented<T extends string>({ items, value, onChange, testID }: { items: Seg<T>[]; value: T; onChange: (v: T) => void; testID: string }) {
  return (
    <View style={styles.segment} accessibilityRole="radiogroup">
      {items.map((it) => (
        <Pressable key={it.value} onPress={() => onChange(it.value)} accessibilityRole="radio" accessibilityState={{ selected: value === it.value }} style={[styles.segmentItem, value === it.value && styles.segmentOn]} testID={`${testID}-${it.value}`}>
          <Text variant="bodySmall" tone={value === it.value ? undefined : 'secondary'} style={value === it.value && styles.segmentOnText}>
            {it.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/** 開始頁（Style 23）：選 Walking／Running、戶外／室內、自動圈與分段單位；室內不啟用 GPS */
export function WorkoutStartScreen() {
  const { t } = useT();
  const navigation = useNavigation();
  const [sport, setSport] = useState<'run' | 'walk'>('run');
  const [env, setEnv] = useState<'outdoor' | 'indoor'>('outdoor');
  const [autoLap, setAutoLap] = useState<'off' | '400' | '1000'>('off');
  const [units, setUnits] = useState<'km' | 'mi'>('km');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ kind: 'permission' | 'generic'; message?: string } | null>(null);

  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (!(await workoutRecorder.ensurePermission())) {
        setErr({ kind: 'permission' });
        return;
      }
      await workoutRecorder.start({ sport, environment: env, autoLapMm: autoLap === 'off' ? null : Number(autoLap) * 1000, splitLengthMm: units === 'km' ? SPLIT_KM_MM : SPLIT_MILE_MM });
      navigation.navigate('WorkoutRecord');
    } catch (e) {
      setErr({ kind: 'generic', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll testID="workout-start-screen">
      <Text variant="label" tone="muted" uppercase>
        {t('rec.sport')}
      </Text>
      <Segmented items={[{ value: 'run', label: t('wo.sport.run') }, { value: 'walk', label: t('wo.sport.walk') }]} value={sport} onChange={setSport} testID="start-sport" />
      <Text variant="label" tone="muted" uppercase style={styles.mt}>
        {t('rec.env')}
      </Text>
      <Segmented items={[{ value: 'outdoor', label: t('rec.env.outdoor') }, { value: 'indoor', label: t('rec.env.indoor') }]} value={env} onChange={setEnv} testID="start-env" />
      {env === 'indoor' ? <InlineState kind="info" title={t('rec.indoorHint')} action={{ label: t('wo.import'), onPress: () => navigation.navigate('Workouts') }} testID="start-indoor" /> : null}
      <Surface style={styles.card}>
        <Text variant="label" tone="muted" uppercase>
          {t('rec.autoLap')}
        </Text>
        <Segmented items={(['off', '400', '1000'] as const).map((v) => ({ value: v, label: t(`rec.autoLap.${v}` as TKey) }))} value={autoLap} onChange={setAutoLap} testID="start-autolap" />
        <Text variant="label" tone="muted" uppercase style={styles.mt}>
          {t('rec.units')}
        </Text>
        <Segmented items={[{ value: 'km', label: t('rec.units.km') }, { value: 'mi', label: t('rec.units.mi') }]} value={units} onChange={setUnits} testID="start-units" />
      </Surface>
      {err?.kind === 'permission' ? <InlineState kind="warning" title={t('rec.permissionTitle')} body={t('rec.permissionBody')} action={{ label: t('rec.permissionOpen'), onPress: () => void Linking.openSettings() }} testID="start-permission" /> : null}
      {err?.kind === 'generic' ? <InlineState kind="error" title={t('rec.err', { message: err.message ?? '' })} testID="start-error" /> : null}
      <Button label={t('rec.go')} style={styles.mt} onPress={() => void go()} loading={busy} loadingLabel={t('rec.starting')} disabled={busy || env === 'indoor'} disabledReason={env === 'indoor' ? t('rec.indoorHint') : undefined} testID="start-go" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  mt: { marginTop: space.m },
  card: { marginTop: space.m },
  segment: { flexDirection: 'row', borderWidth: 1, borderColor: color.borderSubtle, borderRadius: radius.m, overflow: 'hidden', marginTop: space.xs },
  segmentItem: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { backgroundColor: color.mint },
  segmentOnText: { color: color.onMint },
});
