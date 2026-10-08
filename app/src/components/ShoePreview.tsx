import { useRef, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import { Button } from './Button';
import { ShoeHero, type ShoeHeroProps } from './ShoeHero';
import { useT } from '@/i18n';
import { color, space, Text } from '@/theme';

/** Side artwork rotates rigidly in its own plane; this is not a 3D model. */
export function ShoePreview(props: ShoeHeroProps) {
  // Remount on shoe/owner changes so another collectible opens in its neutral pose.
  return <Inspector key={`${props.level}-${props.owner}`} {...props} />;
}
function Inspector({ size = 240, ...props }: ShoeHeroProps) {
  const { t } = useT();
  const [angle, setAngle] = useState(0);
  const [zoom, setZoom] = useState(false);
  const current = useRef(0);
  const start = useRef(0);
  const rotate = (value: number) => {
    current.current = ((value % 360) + 360) % 360;
    setAngle(current.current);
  };
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => g.numberActiveTouches === 1 && Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
    onPanResponderGrant: () => { start.current = current.current; },
    onPanResponderMove: (_, g) => rotate(start.current + g.dx * 0.8),
    onPanResponderTerminationRequest: () => true,
  })).current;
  return <View style={styles.wrapper}>
    <Text variant="caption" tone="secondary">{t('wild.rotateHint')}</Text>
    <View testID="shoe-rotate-surface" {...pan.panHandlers} style={[styles.stage, { width: size, height: size }]}>
      <View testID="shoe-rotation" style={{ transform: [{ rotate: `${angle}deg` }, { scale: zoom ? 1.3 : 1 }] }}>
        <ShoeHero {...props} size={size} active={false} badge={false} />
      </View>
    </View>
    <Text variant="caption" tone="muted">{t('wild.rotation', { angle: Math.round(angle) })}</Text>
    <View style={styles.controls}>
      <Button variant="secondary" label={t('wild.rotateLeft')} onPress={() => rotate(current.current - 30)} />
      <Button variant="secondary" label={t('wild.rotateRight')} onPress={() => rotate(current.current + 30)} />
      <Button variant="secondary" label={t(zoom ? 'wild.zoomOut' : 'wild.zoomIn')} onPress={() => setZoom(v => !v)} accessibilityState={{ selected: zoom }} />
      <Button variant="secondary" label={t('wild.resetView')} onPress={() => { rotate(0); setZoom(false); }} />
    </View>
  </View>;
}
const styles = StyleSheet.create({
  wrapper: { alignItems: 'center', alignSelf: 'stretch', gap: space.s },
  stage: { maxWidth: '100%', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: color.canvas, borderRadius: 16 },
  controls: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.xs },
});
