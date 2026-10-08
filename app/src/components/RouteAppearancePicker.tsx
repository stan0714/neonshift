import { Pressable, StyleSheet, View } from 'react-native';
import { HABITAT_SCENES, resolveTraceLayer, SCENE_LEVEL } from '@/domain/appearance';
import { useAppearance } from '@/hooks/useAppearance';
import { useT, type TKey } from '@/i18n';
import { useWorkoutPrefs } from '@/state/workoutPrefsStore';
import { color, radius, space, Text } from '@/theme';
import { RouteThumb } from './RouteThumb';

/** Pre-workout artwork selection only. Saved sessions never read these preferences. */
export function RouteAppearancePicker() {
  const { t } = useT();
  const prefs = useWorkoutPrefs();
  const ap = useAppearance();
  const highest = ap.owned.reduce<number>((n, shoe) => Math.max(n, shoe.level), 1) as typeof ap.level;
  const layer = resolveTraceLayer(prefs.traceLayer, ap.level, highest);
  return <View style={styles.root} testID="start-route-picker">
    <View style={styles.preview}>
      <RouteThumb points={[]} layer={layer} />
      <View style={styles.copy}><Text variant="title">{t('route.title')} · {t(`sum.layer.${layer}` as TKey)}</Text><Text variant="caption" tone="secondary">{t('route.before')}</Text></View>
    </View>
    <View style={styles.options} accessibilityRole="radiogroup">
      {(['shoe', 'grid', 'mars', 'chain', 'space', ...HABITAT_SCENES] as const).map((value) => {
        const locked = value in SCENE_LEVEL && SCENE_LEVEL[value as keyof typeof SCENE_LEVEL] > highest;
        const label = t(`sum.layer.${value}` as TKey);
        return <Pressable key={value} disabled={locked} accessibilityRole="radio" accessibilityState={{ disabled: locked, selected: prefs.traceLayer === value }} onPress={() => void prefs.set({ traceLayer: value })} style={[styles.option, prefs.traceLayer === value && styles.selected]} testID={`start-route-layer-${value}`}>
          <Text variant="caption" tone={locked ? 'muted' : prefs.traceLayer === value ? 'mint' : 'secondary'}>{label}{locked ? ` · ${t('sum.layer.locked', { n: SCENE_LEVEL[value as keyof typeof SCENE_LEVEL] })}` : ''}</Text>
        </Pressable>;
      })}
    </View>
  </View>;
}
const styles = StyleSheet.create({
  root: { marginVertical: space.m, gap: space.s },
  preview: { flexDirection: 'row', gap: space.s, alignItems: 'center' },
  copy: { flex: 1, gap: space.xs },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  option: { minHeight: 48, justifyContent: 'center', paddingHorizontal: space.s, borderWidth: 1, borderColor: color.borderSubtle, borderRadius: radius.m },
  selected: { backgroundColor: color.elevated, borderColor: color.mint },
});
