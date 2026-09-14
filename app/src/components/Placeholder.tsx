import { StyleSheet, View } from 'react-native';

import { Chip } from '@/components/Chip';
import { space, Text } from '@/theme';

type Props = { title: string; pgItem: string; note?: string };

/** 尚未實作畫面的佔位；正式畫面由對應 PG 項目替換，交付前不得殘留。 */
export function Placeholder({ title, pgItem, note }: Props) {
  return (
    <View style={styles.wrap} testID={`placeholder-${pgItem}`}>
      <Text variant="heading1">{title}</Text>
      <Chip label={pgItem} kind="neutral" style={styles.chip} />
      {note ? (
        <Text variant="bodySmall" tone="secondary" style={styles.note}>
          {note}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'center', alignItems: 'flex-start' },
  chip: { marginTop: space.s },
  note: { marginTop: space.m },
});
