import { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { Button, Surface } from '@/components';
import { useT } from '@/i18n';
import { useBody, WEIGHT_RANGE } from '@/state/bodyStore';
import { color, radius, space, Text } from '@/theme';

/**
 * PG-R-11：熱量估算用體重（選填）。只存在手機、不上傳；清除即停止估算。
 * 文案明說：估算值、不作 PB／XP／排名依據、不是醫療或飲食建議。
 */
export function BodyWeightCard({ testID = 'body-weight' }: { testID?: string }) {
  const { t } = useT();
  const body = useBody();
  const [text, setText] = useState('');
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { void useBody.getState().load(); }, []);
  useEffect(() => { setText(body.weightKg === null ? '' : String(body.weightKg)); }, [body.weightKg]);
  const save = async () => {
    const n = Number(text.replace(',', '.').trim());
    if (!Number.isFinite(n) || n < WEIGHT_RANGE.min || n > WEIGHT_RANGE.max) { setInvalid(true); return; }
    setInvalid(false);
    await body.setWeight(n);
  };
  return (
    <Surface testID={testID}>
      <Text variant="title">{t('body.title')}</Text>
      <Text variant="bodySmall" tone="secondary" style={styles.mtXs}>{t('body.body')}</Text>
      <View style={styles.row}>
        <TextInput value={text} onChangeText={(v) => { setText(v); setInvalid(false); }} keyboardType="decimal-pad" maxLength={5} placeholder={t('body.placeholder')} placeholderTextColor={color.textMuted} style={styles.input} accessibilityLabel={t('body.a11y')} testID={`${testID}-input`} />
        <Text variant="bodySmall" tone="secondary">kg</Text>
        <Button label={t('body.save')} variant="secondary" onPress={() => void save()} testID={`${testID}-save`} />
      </View>
      {invalid ? <Text variant="caption" tone="warning" style={styles.mtXs} testID={`${testID}-invalid`}>{t('body.invalid', { min: WEIGHT_RANGE.min, max: WEIGHT_RANGE.max })}</Text> : null}
      <Text variant="caption" tone="muted" style={styles.mtXs} testID={`${testID}-status`}>
        {body.weightKg === null ? t('body.unset') : t('body.set', { kg: body.weightKg, when: body.updatedAt ? new Date(body.updatedAt).toLocaleDateString() : '' })}
      </Text>
      {body.weightKg !== null ? <Button label={t('body.clear')} variant="secondary" style={styles.mtXs} onPress={() => void body.setWeight(null)} testID={`${testID}-clear`} /> : null}
      <Text variant="caption" tone="muted" style={styles.mtXs}>{t('body.disclaimer')}</Text>
    </Surface>
  );
}

const styles = StyleSheet.create({
  mtXs: { marginTop: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.s, marginTop: space.s, flexWrap: 'wrap' },
  input: { minWidth: 96, minHeight: 44, paddingHorizontal: space.s, borderWidth: 1, borderColor: color.borderSubtle, borderRadius: radius.m, color: color.textPrimary, fontSize: 18, backgroundColor: color.elevated },
});
