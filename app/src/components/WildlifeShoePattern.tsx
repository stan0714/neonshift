import { G, Path, Circle, Ellipse } from 'react-native-svg';
import type { ShoeLevel } from '@/config/shoeProgression';
import type { ShoeVariant } from '@/config/shoeCollection';
import { color } from '@/theme';

/** Abstract animal-inspired fabric and geometry; no animal materials. SVG coordinates match ShoeHero. */
export function WildlifeShoePattern({ level, variant, tint }: { level: ShoeLevel; variant: ShoeVariant | null; tint: string }) {
  const ink = variant === 'dusk' ? color.violet : variant === 'aurora' ? color.mint : color.warning;
  const shift = variant === 'dusk' ? 3 : variant === 'aurora' ? -3 : 0;
  if (level === 1) return null;
  return <G testID={`wildlife-pattern-${level}`}>
    {level === 2 ? <G>
      {/* Broad ear-shaped heel guard, curled trunk seam, soft skin-fold stitching. */}
      <Path d="M45 96 Q54 77 72 92 Q88 116 66 129 Q46 127 45 96 Z" fill={color.elevated} stroke={tint} strokeWidth={2} />
      <Path d="M60 93 Q79 107 64 122 M81 103 Q91 121 82 128 Q77 134 73 128" fill="none" stroke={ink} strokeWidth={2.5} strokeLinecap="round" />
      {[0, 1, 2].map(n => <Path key={n} d={`M${95 + n * 9} 119 l5 10`} stroke={ink} strokeOpacity={0.65} />)}
    </G> : null}
    {level === 3 ? <G>
      {/* Overlapping scute panel and a flipper-like heel extension. */}
      <Path d="M38 113 Q22 101 25 91 Q43 95 51 115" fill={color.elevated} stroke={tint} strokeWidth={2} />
      {[0, 1, 2, 3].map(n => <Path key={n} d={`M${67 + n * 14} ${106 + n * 3} l9 -4 l9 9 l-8 10 l-10 -4 Z`} fill={color.surface} stroke={ink} strokeWidth={1.5} />)}
      <Path d="M169 125 Q194 113 215 124 M172 130 Q196 119 214 129" stroke={tint} fill="none" />
    </G> : null}
    {level === 4 ? <G>
      {/* Tapered stripes follow the upper, rather than a pasted animal icon. */}
      {[0, 1, 2, 3, 4].map(n => <Path key={n} d={`M${62 + n * 12 + shift} ${102 + n * 3} l10 2 l-4 12 l-3 5 l-1 -12 Z`} fill={ink} />)}
      <Path d="M181 111 l9 2 l-7 13 l-5 3 Z M197 115 l8 3 l-6 9 l-5 2 Z" fill={ink} />
    </G> : null}
    {level === 5 ? <G>
      {/* Broken rosettes and a pale winter-coat toe panel. */}
      <Path d="M174 109 Q205 109 218 122 L207 130 Q187 135 174 130 Z" fill={color.textSecondary} fillOpacity={0.22} />
      {[0, 1, 2, 3, 4, 5].map(n => <G key={n}>
        <Ellipse cx={68 + (n % 3) * 18 + shift} cy={109 + Math.floor(n / 3) * 13} rx={6} ry={4} fill="none" stroke={ink} strokeWidth={2.4} strokeDasharray="6 3" />
        <Circle cx={68 + (n % 3) * 18 + shift} cy={109 + Math.floor(n / 3) * 13} r={1} fill={tint} />
      </G>)}
      <Path d="M181 120 q5 -7 10 0 q-4 7 -10 0 M200 123 q5 -7 10 0" fill="none" stroke={ink} strokeWidth={2} />
    </G> : null}
    <Path d="M47 136 Q110 151 202 138" fill="none" stroke={ink} strokeWidth={variant === 'aurora' ? 2.5 : 1.5} strokeDasharray={variant === 'dusk' ? '4 3' : undefined} />
  </G>;
}
