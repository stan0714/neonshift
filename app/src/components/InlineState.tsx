import { Feather } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/Button';
import { Surface } from '@/components/Surface';
import { color, space, Text } from '@/theme';

type Kind = 'error' | 'warning' | 'info' | 'success';

const icon: Record<Kind, { name: React.ComponentProps<typeof Feather>['name']; tint: string }> = {
  // 16.1：success／warning／danger 形狀不同，不只換色
  error: { name: 'x-octagon', tint: color.danger },
  warning: { name: 'alert-triangle', tint: color.warning },
  info: { name: 'info', tint: color.cyan },
  success: { name: 'check-circle', tint: color.success },
};

type Props = { kind: Kind; title: string; body?: string; testID?: string; /** Style 14 的行動（例如 `Try again`／`Review access`） */ action?: { label: string; onPress: () => void; loading?: boolean; loadingLabel?: string; disabled?: boolean; disabledReason?: string; testID?: string }; /** 次要行動（例如丟棄），danger 樣式 */ secondaryAction?: { label: string; onPress: () => void }; /** generic error 的 reference ID */ referenceId?: string };

/** Style 14：inline 狀態說明「發生什麼、資料是否安全、下一步」；不用只顯示錯誤碼。 */
export function InlineState({ kind, title, body, testID, action, secondaryAction, referenceId }: Props) {
  const i = icon[kind];
  return (
    <Surface style={styles.card} testID={testID} accessibilityRole="alert">
      <View style={styles.row}>
        <Feather name={i.name} size={20} color={i.tint} />
        <Text variant="title" style={styles.title}>
          {title}
        </Text>
      </View>
      {body ? (
        <Text variant="bodySmall" tone="secondary" style={styles.body}>
          {body}
        </Text>
      ) : null}
      {referenceId ? (
        <Text variant="caption" tone="muted" numeric style={styles.body} selectable>
          Ref {referenceId}
        </Text>
      ) : null}
      {action ? <Button label={action.label} variant="secondary" style={styles.action} onPress={action.onPress} loading={action.loading ?? false} loadingLabel={action.loadingLabel} disabled={action.disabled} disabledReason={action.disabledReason} testID={action.testID} /> : null}
      {secondaryAction ? <Button label={secondaryAction.label} variant="danger" style={styles.action} onPress={secondaryAction.onPress} /> : null}
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: space.m },
  row: { flexDirection: 'row', alignItems: 'center' },
  title: { marginLeft: space.s, flex: 1 },
  body: { marginTop: space.xs },
  action: { marginTop: space.s },
});
