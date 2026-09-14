import { StyleSheet, View } from 'react-native';

import { space, Text } from '@/theme';

import { BrandMark } from './BrandMark';

type Props = { withMark?: boolean; markSize?: number };

/** `NEONSHIFT` 全大寫、字距略寬、無 glitch（Style 3.2）；正式 UI 不加文字 glow。 */
export function Wordmark({ withMark = false, markSize = 24 }: Props) {
  return (
    <View style={styles.row} accessible accessibilityRole="header" accessibilityLabel="NeonShift">
      {withMark ? <BrandMark size={markSize} /> : null}
      <Text variant="title" style={[styles.word, withMark && { marginLeft: space.xs }]}>
        NEONSHIFT
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  word: { letterSpacing: 3 },
});
