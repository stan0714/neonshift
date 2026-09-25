import Svg, { Circle, ClipPath, Defs, G, Line, Path, Polygon, Rect, Text as SvgText } from 'react-native-svg';

import { color } from '@/theme';

/**
 * 節日章徽章（PG-SEASON-03；docs/design/seasonal-achievement-nfts.md §2）。
 *
 * 原創插畫、程序繪製：圓角盾牌＋雙層軌道邊框，主題插畫佔中央約 60%，年份獨立置底。
 * 不重用參考截圖裡的任何圖形，也不照搬六角形斜年份帶。
 *
 * 狀態不只靠顏色：`locked` 用輪廓＋鎖圖示，`pending` 用虛線軌道，`earned` 才填滿並發光。
 * 主題色是「該章專屬美術色」（同 ShoeHero 各階 tint、LayerArt 圖層色），不是 UI token；
 * 邊框、文字與狀態一律吃 token。
 */
export type SeasonalBadgeState = 'locked' | 'pending' | 'earned';

type Motif = { tint: string; accent: string };
const MOTIF: Record<string, Motif> = {
  genesis_stride: { tint: color.violet, accent: '#7BE3A0' },
  seeker_horizon: { tint: '#9B6CFF', accent: color.cyan },
  moonlit_steps: { tint: '#F2D07A', accent: color.mint },
  pizza_miles: { tint: '#FF9A4D', accent: '#FFCB66' },
  mobile_trail: { tint: color.mint, accent: color.cyan },
};
const motifOf = (themeId: string): Motif => MOTIF[themeId] ?? { tint: color.mint, accent: color.cyan };

/** 中央插畫：每章一個主角＋一個可辨識物件，縮到 24 px 仍看得出剪影 */
function ThemeArt({ themeId, tint, accent, outline }: { themeId: string; tint: string; accent: string; outline: boolean }) {
  const fill = (c: string) => (outline ? 'none' : c);
  const stroke = outline ? color.textMuted : c2(tint);
  switch (themeId) {
    case 'genesis_stride': // 萌芽＋三道平行光帶
      return (
        <G>
          {[0, 1, 2].map((i) => (
            <Line key={i} x1={14} y1={30 + i * 9} x2={46} y2={22 + i * 9} stroke={outline ? color.textMuted : accent} strokeWidth={3} strokeLinecap="round" opacity={outline ? 0.7 : 0.9} />
          ))}
          <Path d="M30 54 V34" stroke={stroke} strokeWidth={3} strokeLinecap="round" />
          <Path d="M30 38 C22 36 18 28 20 22 C28 22 33 30 30 38 Z" fill={fill(accent)} stroke={stroke} strokeWidth={2} />
          <Path d="M30 42 C38 40 43 32 41 26 C33 26 28 34 30 42 Z" fill={fill(tint)} stroke={stroke} strokeWidth={2} />
        </G>
      );
    case 'seeker_horizon': // 探索動物跨過掌上地平線：星軌、抽象手機、遠山
      return (
        <G>
          <Path d="M8 34 Q30 10 52 34" fill="none" stroke={outline ? color.textMuted : tint} strokeWidth={2} strokeDasharray="3 5" />
          <Rect x={18} y={30} width={24} height={26} rx={5} fill={fill(color.surface)} stroke={stroke} strokeWidth={2} />
          <Path d="M20 48 L27 38 L33 46 L38 41 L40 48 Z" fill={fill(accent)} stroke={stroke} strokeWidth={1.5} />
          <Circle cx={30} cy={24} r={3.5} fill={fill(accent)} stroke={stroke} strokeWidth={1.5} />
          <Path d="M25 20 L22 14 M35 20 L38 14" stroke={stroke} strokeWidth={2} strokeLinecap="round" />
        </G>
      );
    case 'moonlit_steps': // 月下野兔：滿月、兔耳剪影、葉片
      return (
        <G>
          <Circle cx={40} cy={20} r={10} fill={fill(tint)} stroke={stroke} strokeWidth={2} />
          <Path d="M18 54 C16 44 20 38 26 36 C30 35 34 37 35 41 C36 47 32 53 26 55 Z" fill={fill(color.elevated)} stroke={stroke} strokeWidth={2} />
          <Path d="M24 37 C22 30 23 22 26 18 C29 23 29 31 27 37 Z M30 38 C30 31 33 24 36 21 C37 27 35 34 32 38 Z" fill={fill(color.elevated)} stroke={stroke} strokeWidth={2} />
          <Path d="M8 56 Q14 48 20 56" fill="none" stroke={outline ? color.textMuted : accent} strokeWidth={2} />
        </G>
      );
    case 'pizza_miles': // 暖橘圓盤＋三角切片＋軌道線
      return (
        <G>
          <Circle cx={30} cy={32} r={16} fill={fill(tint)} stroke={stroke} strokeWidth={2} />
          <Polygon points="30,32 46,28 44,42" fill={fill(accent)} stroke={stroke} strokeWidth={1.5} />
          {[[24, 26], [34, 24], [26, 38], [36, 36]].map(([cx, cy], i) => (
            <Circle key={i} cx={cx} cy={cy} r={2.2} fill={outline ? 'none' : color.canvas} stroke={stroke} strokeWidth={1} />
          ))}
          <Path d="M10 52 Q30 44 50 52" fill="none" stroke={outline ? color.textMuted : accent} strokeWidth={2} strokeDasharray="4 4" />
        </G>
      );
    case 'mobile_trail': // 手機輪廓化為森林入口＋腳印
      return (
        <G>
          <Rect x={16} y={12} width={28} height={36} rx={7} fill={fill(color.surface)} stroke={stroke} strokeWidth={2} />
          <Path d="M22 48 V30 Q30 18 38 30 V48 Z" fill={fill(tint)} stroke={stroke} strokeWidth={2} />
          <Circle cx={26} cy={53} r={2.6} fill={fill(accent)} stroke={stroke} strokeWidth={1} />
          <Circle cx={34} cy={57} r={2.6} fill={fill(accent)} stroke={stroke} strokeWidth={1} />
        </G>
      );
    default:
      return <Circle cx={30} cy={34} r={14} fill={fill(tint)} stroke={stroke} strokeWidth={2} />;
  }
}
/** 深色底上的描邊色：主題色本身太亮時用它 */
const c2 = (tint: string) => tint;

export function SeasonalBadge({ themeId, year, state, size = 96, testID }: { themeId: string; year: number; state: SeasonalBadgeState; size?: number; testID?: string }) {
  const { tint, accent } = motifOf(themeId);
  const outline = state === 'locked';
  const orbit = state === 'earned' ? tint : state === 'pending' ? color.textSecondary : color.borderSubtle;
  return (
    <Svg width={size} height={(size * 140) / 120} viewBox="0 0 120 140" accessible accessibilityRole="image" testID={testID ?? `seasonal-badge-${themeId}-${state}`}>
      <Defs>
        <ClipPath id="shield">
          <Path d="M60 6 L108 24 V78 Q108 112 60 134 Q12 112 12 78 V24 Z" />
        </ClipPath>
      </Defs>
      {/* 圓角盾牌＋雙層軌道邊框 */}
      <Path d="M60 6 L108 24 V78 Q108 112 60 134 Q12 112 12 78 V24 Z" fill={color.surface} stroke={orbit} strokeWidth={4} />
      <Path d="M60 15 L100 30 V78 Q100 106 60 124 Q20 106 20 78 V30 Z" fill="none" stroke={orbit} strokeWidth={2} strokeOpacity={0.6} strokeDasharray={state === 'pending' ? '6 6' : undefined} />
      <G clipPath="url(#shield)">
        {/* 插畫佔中央約 60%：viewBox 60×70 的圖放大 1.2 倍置中 */}
        <G transform="translate(24 22) scale(1.2)">
          <ThemeArt themeId={themeId} tint={tint} accent={accent} outline={outline} />
        </G>
      </G>
      {/* 年份獨立置底 */}
      <SvgText x={60} y={120} fontSize={17} fontWeight="700" fill={outline ? color.textMuted : color.textPrimary} textAnchor="middle">{String(year)}</SvgText>
      {/* 上鎖不只靠灰色：加鎖圖示 */}
      {outline ? (
        <G testID="seasonal-badge-lock">
          <Rect x={52} y={64} width={16} height={13} rx={3} fill={color.elevated} stroke={color.textMuted} strokeWidth={2} />
          <Path d="M55 64 V60 Q60 54 65 60 V64" fill="none" stroke={color.textMuted} strokeWidth={2} />
        </G>
      ) : null}
    </Svg>
  );
}
