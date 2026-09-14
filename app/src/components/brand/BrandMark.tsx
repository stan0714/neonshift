import Svg, { Defs, G, LinearGradient, Mask, Polygon, Rect, Stop } from 'react-native-svg';

import { color, gradient } from '@/theme';

type Props = {
  /** dp；Launch 為 72，navigation 24 */
  size?: number;
  /** 單色版本（小尺寸、NFC 印刷） */
  mono?: boolean;
  accessibilityLabel?: string;
};

// 幾何與 assets/brand/mark.svg 相同；Forward Shift：N 的負空間為向右上的箭頭（Style 3.2／3.3）
const STEMS = ['10,90 22,10 40,10 28,90', '22,10 42,10 78,90 58,90', '60,90 72,10 90,10 78,90'];
const ARROW = '74.5,26.5 72.6,43.6 68.3,39.5 53.0,54.7 46.3,48.0 61.5,32.7 57.4,28.4';

export function BrandMark({ size = 72, mono = false, accessibilityLabel = 'NeonShift' }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityLabel={accessibilityLabel} accessibilityRole="image">
      <Defs>
        <LinearGradient id="brand" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={gradient.brand[0]} />
          <Stop offset="0.55" stopColor={gradient.brand[1]} />
          <Stop offset="1" stopColor={gradient.brand[2]} />
        </LinearGradient>
        <Mask id="cut">
          <Rect width="100" height="100" fill="#fff" />
          <Polygon points={ARROW} fill="#000" />
        </Mask>
      </Defs>
      <G mask="url(#cut)" fill={mono ? color.textPrimary : 'url(#brand)'}>
        {STEMS.map((p) => (
          <Polygon key={p} points={p} />
        ))}
      </G>
    </Svg>
  );
}
