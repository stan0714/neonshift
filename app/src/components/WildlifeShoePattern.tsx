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
      <Path d="M48 97 Q58 83 71 97 Q81 113 65 124 M49 104 Q55 100 58 101 M51 112 Q57 108 60 110" fill="none" stroke={ink} strokeOpacity={0.55} strokeWidth={0.8} />
      <Path d="M85 116 Q98 109 119 123 M96 117 L100 111 M105 119 L113 115" fill="none" stroke={tint} strokeWidth={1.1} strokeLinecap="round" />
      {[0, 1, 2].map(n => <Path key={n} d={`M${95 + n * 9} 119 l5 10`} stroke={ink} strokeOpacity={0.65} />)}
    </G> : null}
    {level === 3 ? <G>
      {/* Overlapping scute panel and a flipper-like heel extension. */}
      <Path d="M38 113 Q22 101 25 91 Q43 95 51 115" fill={color.elevated} stroke={tint} strokeWidth={2} />
      <Path d="M29 97 Q39 104 45 114 M31 102 L40 113" fill="none" stroke={ink} strokeWidth={0.8} />
      {[0, 1, 2, 3].map(n => <Path key={n} d={`M${67 + n * 14} ${106 + n * 3} l9 -4 l9 9 l-8 10 l-10 -4 Z`} fill={color.surface} stroke={ink} strokeWidth={1.5} />)}
      {[0, 1, 2, 3].map(n => <Path key={`scute-${n}`} d={`M${70+n*14} ${108+n*3} l6 -2 l5 5 M${71+n*14} ${116+n*3} l5 2`} fill="none" stroke={tint} strokeWidth={0.65} strokeOpacity={0.7} />)}
      <Path d="M169 125 Q194 113 215 124 M172 130 Q196 119 214 129" stroke={tint} fill="none" />
    </G> : null}
    {level === 4 ? <G>
      <Path d="M58 102 Q87 97 126 119 L123 134 Q86 130 58 119 Z" fill={ink} fillOpacity={0.12} />
      <Path d="M33 86 Q40 91 42 112 M36 84 Q43 90 45 107" fill="none" stroke={ink} strokeWidth={0.9} />
      {/* Tapered stripes follow the upper, rather than a pasted animal icon. */}
      {[0, 1, 2, 3, 4].map(n => <Path key={n} d={`M${62 + n * 12 + shift} ${102 + n * 3} l${n % 2 ? 7 : 10} 2 l-4 ${n % 2 ? 9 : 12} l-3 5 l-1 -12 Z`} fill={ink} />)}
      {[0, 2, 4].map(n => <Path key={`stripe-${n}`} d={`M${66+n*12+shift} ${106+n*3} l2 5 l-2 5`} fill="none" stroke={color.canvas} strokeOpacity={0.5} strokeWidth={0.8} />)}
      <Path d="M181 111 l9 2 l-7 13 l-5 3 Z M197 115 l8 3 l-6 9 l-5 2 Z" fill={ink} />
    </G> : null}
    {level === 5 ? <G>
      {/* Broken rosettes and a pale winter-coat toe panel. */}
      <Path d="M174 109 Q205 109 218 122 L207 130 Q187 135 174 130 Z" fill={color.textSecondary} fillOpacity={0.22} />
      {[0, 1, 2, 3, 4, 5].map(n => <G key={n}>
        <Ellipse cx={68 + (n % 3) * 18 + shift} cy={109 + Math.floor(n / 3) * 13} rx={n % 2 ? 5 : 6.5} ry={n % 2 ? 4.5 : 3.5} fill="none" stroke={ink} strokeWidth={2.4} strokeDasharray="6 3" />
        <Circle cx={68 + (n % 3) * 18 + shift} cy={109 + Math.floor(n / 3) * 13} r={1} fill={tint} />
      </G>)}
      <Path d="M34 87 Q43 92 45 118 M37 84 Q46 91 49 120 M177 112 Q197 113 208 119" fill="none" stroke={color.textPrimary} strokeOpacity={0.65} strokeWidth={0.75} />
      <Path d="M181 120 q5 -7 10 0 q-4 7 -10 0 M200 123 q5 -7 10 0" fill="none" stroke={ink} strokeWidth={2} />
    </G> : null}
    {level === 3 ? <Path d="M47 139 Q75 137 100 145 Q137 151 201 141" fill="none" stroke={tint} strokeWidth={0.8} strokeOpacity={0.7} /> : null}
    {level === 4 ? <Path d="M61 143 l6 2 l5 -1 M83 148 l7 1 l5 -2 M175 147 l6 -2 l5 0" stroke={ink} strokeWidth={1.1} fill="none" /> : null}
    {level === 5 ? [0, 1, 2, 3, 4].map(n => <G key={`trail-${n}`}><Ellipse cx={89+n*17} cy={147-(n%2)*2} rx={1.5} ry={0.8} fill={ink} /><Circle cx={92+n*17} cy={145-(n%2)*2} r={0.6} fill={tint} /></G>) : null}
    <Path d="M47 136 Q110 151 202 138" fill="none" stroke={ink} strokeWidth={variant === 'aurora' ? 2.5 : 1.5} strokeDasharray={variant === 'dusk' ? '4 3' : undefined} />
  </G>;
}
