import { useNavigation } from '@react-navigation/native';
import { StyleSheet, View } from 'react-native';

import { Button, Chip, Screen, Surface, Wordmark } from '@/components';
import { ShoeHero } from '@/components/ShoeHero';
import { SHOE_PROGRESSION } from '@/config/shoeProgression';
import { space, Text } from '@/theme';

/**
 * Demo Preview（Style 9.3）：帶 `DEMO` badge 的唯讀瀏覽，不建立錢包、NFT 或健康資料假象。
 * 唯讀 Dashboard 內容待 PG-A-12 完成後以 demo 模式渲染；目前先呈現說明與返回。
 */
export function DemoPreviewScreen() {
  const navigation = useNavigation();
  return (
    <Screen scroll testID="demo-preview-screen">
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
      {SHOE_PROGRESSION.stages.map((stage) => (
        <Surface key={stage.level} style={styles.card}>
          <Text variant="heading2">{stage.name} · LV. {stage.level}</Text>
          <View style={{ alignItems: 'center' }}><ShoeHero level={stage.level} active={false} /></View>
          <Text variant="body">{stage.xp.toLocaleString()} total XP</Text>
          <Text variant="caption" tone="secondary">{stage.detail}</Text>
          <Text variant="caption" tone="muted">{stage.xp === 0 ? 'Unlocked after minting' : `${Math.ceil(stage.xp / 150)} task days with both daily missions`}</Text>
        </Surface>
      ))}
      <Text variant="caption" tone="secondary" style={styles.body}>
        Preview rules: steps +100 XP, sleep +50 XP per successful daily claim. Shoe level changes appearance; paid Core upgrades change rewards. Final rules follow onchain configuration.
      </Text>
      <View style={styles.actions}>
        <Button label="Connect wallet" onPress={() => navigation.navigate('Onboarding', { screen: 'WalletConnect' })} />
        <Button label="Back" variant="secondary" style={styles.secondary} onPress={() => navigation.goBack()} />
        {__DEV__ ? (
          <Button label="Dev: open tabs" variant="secondary" style={styles.secondary} onPress={() => navigation.navigate('Main', { screen: 'Profile' })} />
        ) : null}
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
  actions: { marginTop: space.xxl },
  secondary: { marginTop: space.s },
});
