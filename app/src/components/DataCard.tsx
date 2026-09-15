import { Feather } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { Surface } from '@/components/Surface';
import { color, radius, space, Text } from '@/theme';

type Props = {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  value: string;
  unit: string;
  goalLabel: string;
  ratio: number;
  /** Steps 用 mint；Sleep 用 violet（7.2）；不得只靠顏色區分 */
  tint: string;
  statusText: string;
  outdated?: boolean;
  testID?: string;
};

/** 7.2 Data Card：上方 icon／label、中段數值與單位、下方 progress bar、目標與狀態文字。 */
export function DataCard({ icon, label, value, unit, goalLabel, ratio, tint, statusText, outdated, testID }: Props) {
  return (
    <Surface style={styles.card} testID={testID} accessible accessibilityLabel={`${label}: ${value} ${unit}, ${statusText}`}>
      <View style={styles.head}>
        <Feather name={icon} size={20} color={tint} />
        <Text variant="label" tone="secondary" uppercase style={styles.label}>
          {label}
        </Text>
      </View>
      <View style={styles.valueRow}>
        <Text variant="displayM" numeric>
          {value}
        </Text>
        <Text variant="bodySmall" tone="secondary" style={styles.unit}>
          {unit}
        </Text>
      </View>
      <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(ratio * 100) }}>
        <View style={[styles.fill, { width: `${Math.round(ratio * 100)}%`, backgroundColor: tint }]} />
      </View>
      <View style={styles.foot}>
        <Text variant="caption" tone="muted">
          {goalLabel}
        </Text>
        {statusText ? (
          <Text variant="caption" tone={outdated ? 'warning' : 'muted'} numberOfLines={2}>
            {statusText}
          </Text>
        ) : null}
      </View>
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center' },
  label: { marginLeft: space.xs },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: space.s },
  unit: { marginLeft: space.xs },
  track: { height: 6, borderRadius: radius.s, backgroundColor: color.elevated, marginTop: space.s, overflow: 'hidden' },
  fill: { height: 6, borderRadius: radius.s },
  foot: { marginTop: space.xs, gap: 2 },
});
