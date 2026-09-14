import { useNavigation } from '@react-navigation/native';
import { StyleSheet, View } from 'react-native';

import { Button, Chip, Screen, Surface, Wordmark } from '@/components';
import { space, Text } from '@/theme';

/**
 * Demo Preview（Style 9.3）：帶 `DEMO` badge 的唯讀瀏覽，不建立錢包、NFT 或健康資料假象。
 * 唯讀 Dashboard 內容待 PG-A-12 完成後以 demo 模式渲染；目前先呈現說明與返回。
 */
export function DemoPreviewScreen() {
  const navigation = useNavigation();
  return (
    <Screen testID="demo-preview-screen">
      <View style={styles.header}>
        <Wordmark withMark />
        <View style={styles.chips}>
          <Chip label="DEMO" kind="level" />
          <Chip label="DEVNET" kind="devnet" style={styles.chipGap} />
        </View>
      </View>
      <Surface style={styles.card}>
        <Text variant="heading2">Read-only preview</Text>
        <Text variant="body" tone="secondary" style={styles.body}>
          Browse how missions, gear and the weekend arena work. Nothing here is saved, and no wallet, NFT or health data is created.
        </Text>
      </Surface>
      <View style={styles.actions}>
        <Button label="Connect wallet" onPress={() => navigation.navigate('Onboarding', { screen: 'WalletConnect' })} />
        <Button label="Back" variant="secondary" style={styles.secondary} onPress={() => navigation.goBack()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chips: { flexDirection: 'row' },
  chipGap: { marginLeft: space.xs },
  card: { marginTop: space.xxl },
  body: { marginTop: space.s },
  actions: { marginTop: 'auto' },
  secondary: { marginTop: space.s },
});
