import { ShoePreview } from '@/components/ShoePreview';
import { useNavigation } from '@react-navigation/native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Chip, Screen, Surface, Wordmark } from '@/components';
import { RevealCeremony } from '@/components/EvolutionReveal';
import { ShoeStory } from '@/components/ShoeStory';
import { SHOE_PROGRESSION, type ShoeLevel } from '@/config/shoeProgression';
import { space, Text } from '@/theme';
import { stageDetail, stageName } from '@/domain/collectibles';
import { useT } from '@/i18n';

/**
 * Demo Preview（Style 9.3）：帶 `DEMO` badge 的唯讀瀏覽，不建立錢包、NFT 或健康資料假象。
 * 唯讀 Dashboard 內容待 PG-A-12 完成後以 demo 模式渲染；目前先呈現說明與返回。
 */
export function DemoPreviewScreen() {
  const { t } = useT();
  const navigation = useNavigation();
  const [previewLevel, setPreviewLevel] = useState<ShoeLevel | null>(null);
  return (
    <Screen scroll testID="demo-preview-screen">
      <View style={styles.header}>
        <Wordmark withMark />
        <View style={styles.chips}>
          <Chip label={t('common.demo')} kind="level" />
          <Chip label={t('common.devnet')} kind="devnet" style={styles.chipGap} />
        </View>
      </View>
      <Surface style={styles.card}>
        <Text variant="heading2">{t('demo.title')}</Text>
        <Text variant="body" tone="secondary" style={styles.body}>
          {t('demo.body')}
        </Text>
      </Surface>
      {SHOE_PROGRESSION.stages.map((stage) => (
        <Surface key={stage.level} style={styles.card}>
          <Text variant="heading2">{stageName(t, stage.level)} · {t('common.lv', { n: stage.level })}</Text>
          <View style={{ alignItems: 'center' }}><ShoePreview owner={null} level={stage.level} /></View>
          <ShoeStory level={stage.level} preview />
          <Text variant="body">{t('demo.totalXp', { n: stage.xp })}</Text>
          <Text variant="caption" tone="secondary">{stageDetail(t, stage.level)}</Text>
          <Text variant="caption" tone="muted">{stage.xp === 0 ? t('demo.unlockedStart') : t('demo.taskDays', { n: Math.ceil(stage.xp / 150) })}</Text>
          {stage.level > 1 ? <Button label={t('wild.previewReveal')} variant="secondary" style={styles.secondary} onPress={() => setPreviewLevel(stage.level)} testID={`demo-preview-reveal-${stage.level}`} /> : null}
        </Surface>
      ))}
      <Text variant="caption" tone="secondary" style={styles.body}>
        {t('demo.rules')}
      </Text>
      <View style={styles.actions}>
        <Button label={t('common.connectWallet')} onPress={() => navigation.navigate('Onboarding', { screen: 'WalletConnect' })} />
        <Button label={t('common.back')} variant="secondary" style={styles.secondary} onPress={() => navigation.goBack()} />
        {__DEV__ ? (
          <Button label={t('demo.devOpenTabs')} variant="secondary" style={styles.secondary} onPress={() => navigation.navigate('Main', { screen: 'Profile' })} />
        ) : null}
      </View>
      {previewLevel ? <RevealCeremony from={(previewLevel - 1) as ShoeLevel} to={previewLevel} preview onClose={() => setPreviewLevel(null)} /> : null}
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
