import type { PropsWithChildren, ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Chip } from '@/components/Chip';
import { Screen } from '@/components/Screen';
import { Wordmark } from '@/components/brand/Wordmark';
import { space, Text } from '@/theme';
import { useT } from '@/i18n';

type Props = PropsWithChildren<{
  step: 1 | 2 | 3 | 4;
  title: string;
  lead?: string;
  /** 底部 CTA 區，固定在捲動內容之後、safe-area 之上 */
  actions: ReactNode;
  testID?: string;
}>;

const TOTAL = 4;

/** Style 10：Landing 後採單一步驟頁面，不用 carousel；Header 固定品牌 mark 與 DEVNET badge。 */
export function OnboardingLayout({ step, title, lead, actions, children, testID }: Props) {
  const { t } = useT();
  return (
    <Screen scroll testID={testID} style={styles.content}>
      <View style={styles.header}>
        <Wordmark withMark />
        <Chip label={t('common.devnet')} kind="devnet" />
      </View>
      <Text variant="label" tone="muted" uppercase style={styles.step} accessibilityLabel={t('onb.stepA11y', { n: step, total: TOTAL })}>
        {t('onb.step', { n: step, total: TOTAL })}
      </Text>
      <Text variant="heading1" accessibilityRole="header">
        {title}
      </Text>
      {lead ? (
        <Text variant="body" tone="secondary" style={styles.lead}>
          {lead}
        </Text>
      ) : null}
      <View style={styles.body}>{children}</View>
      <View style={styles.actions}>{actions}</View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  step: { marginTop: space.xxl, marginBottom: space.xs },
  lead: { marginTop: space.s },
  body: { marginTop: space.xl },
  actions: { marginTop: 'auto', paddingTop: space.xxl, gap: space.s },
});
