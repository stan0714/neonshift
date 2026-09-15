import { Feather } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { color, space, Text } from '@/theme';

type Props = { icon: React.ComponentProps<typeof Feather>['name']; text: string; tint?: string };

export function Bullet({ icon, text, tint = color.mint }: Props) {
  return (
    <View style={styles.row} accessible accessibilityLabel={text}>
      <Feather name={icon} size={20} color={tint} />
      <Text variant="body" style={styles.text}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: space.xs },
  text: { marginLeft: space.s, flex: 1 },
});
