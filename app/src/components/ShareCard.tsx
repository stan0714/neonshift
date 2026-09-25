import QRCode from 'qrcode';
import { forwardRef } from 'react';
import Svg, { Circle, G, Path, Polyline, Rect, Text as SvgText, TSpan } from 'react-native-svg';

import { SHARE_IMAGE, type ShareImageLayout } from '@/domain/shareImage';
import { color } from '@/theme';

/**
 * 分享圖卡（docs/social-share §4.2）。1080×1350 的單一 SVG——只有一個 <Svg>，
 * 出圖才能靠 `ref.toDataURL(cb, { width, height })` 用向量重畫成整張點陣，
 * 不必截畫面、不必 react-native-view-shot，縮圖預覽與實際輸出也保證一致。
 *
 * 版面資料全部來自 domain/shareImage（純函式、可測），這裡只決定「長什麼樣」，
 * 色彩一律走 token，不散落 hex。
 */
const W = SHARE_IMAGE.post.width;
const H = SHARE_IMAGE.post.height;
const PAD = 64;
const QR_SIZE = 200;

/** 徽章短標：成就美術以程序繪製，離線也畫得出來（不抓 neonshift.cc 的 SVG） */
const EMBLEM_LABEL: Record<string, string> = {
  first_5k: '5K', first_10k: '10K', first_half: '21K', first_marathon: '42K', first_finish: 'FIN',
  fastest_1k: '1K', fastest_5k: '5K', fastest_10k: '10K', fastest_half: '21K', fastest_marathon: '42K',
  longest_run: 'MAX', event_check_in: 'IN', event_finish: 'FIN',
};
const emblemLabel = (c: string) => EMBLEM_LABEL[c] ?? c.replace(/[^a-z0-9]/gi, '').slice(0, 3).toUpperCase();
const emblemTint = (c: string) => (c.startsWith('fastest') ? color.violet : c.startsWith('event') ? color.cyan : color.mint);

/** 折行：SVG 沒有自動換行。有空白依詞切，中文等無空白語言依字數切 */
export function wrapText(s: string, max: number, maxLines = 2): string[] {
  const words = s.split(' ');
  const lines: string[] = [];
  if (words.length > 1) {
    let cur = '';
    for (const w of words) {
      if (cur && `${cur} ${w}`.length > max) { lines.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
    }
    if (cur) lines.push(cur);
  } else {
    for (let i = 0; i < s.length; i += max) lines.push(s.slice(i, i + max));
  }
  if (lines.length <= maxLines) return lines;
  return [...lines.slice(0, maxLines - 1), `${lines[maxLines - 1]!.slice(0, max - 1)}…`];
}

/** QR 疊成單一 Path（一格一個 Rect 會是上千個節點）；容錯 M 讓縮圖後仍掃得到 */
function qrPath(value: string, size: number): { d: string; modules: number } | null {
  try {
    const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
    const n = qr.modules.size;
    const data = qr.modules.data;
    const quiet = 2;
    const cell = size / (n + quiet * 2);
    let d = '';
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (!data[y * n + x]) continue;
        const px = ((x + quiet) * cell).toFixed(2);
        const py = ((y + quiet) * cell).toFixed(2);
        d += `M${px} ${py}h${cell.toFixed(2)}v${cell.toFixed(2)}h-${cell.toFixed(2)}z`;
      }
    }
    return d ? { d, modules: n } : null;
  } catch {
    return null; // 內容過長等情況：不給 QR 也不讓整張圖失敗
  }
}

export const ShareCard = forwardRef<Svg, { layout: ShareImageLayout; width?: number; a11yLabel?: string; testID?: string }>(
  function ShareCard({ layout, width = 340, a11yLabel, testID = 'share-card' }, ref) {
    const tint = layout.emblem ? emblemTint(layout.emblem) : color.mint;
    const isAchievement = layout.kind === 'achievement';
    // 主數字（§4.2 一張圖一個主數字）：成就卡的章名比距離長，字級隨長度縮
    const heroLines = isAchievement ? wrapText(layout.hero.value, 15) : [layout.hero.value];
    const heroSize = isAchievement ? (layout.hero.value.length <= 12 ? 112 : 88) : 200;
    let y = isAchievement ? 300 : 260;
    const heroTop = y;
    y += heroSize * heroLines.length + (isAchievement ? 24 : 0);
    const emblemY = isAchievement ? y + 190 : 0;
    if (isAchievement) y += 400;
    const lineTop = y + 56;
    y = lineTop + (layout.lines.length - 1) * 58;
    const chipTop = layout.chips.length ? y + 72 : y;
    const chipRows = Math.ceil(layout.chips.length / 4);
    y = chipTop + chipRows * 86;
    const routeSize = layout.route ? Math.min(400, 1060 - y) : 0;
    const routeTop = y + 24;
    const qr = layout.qr ? qrPath(layout.qr, QR_SIZE) : null;
    const tagline = wrapText(layout.tagline, qr ? 42 : 58);
    return (
      <Svg
        ref={ref}
        width={width}
        height={(width * H) / W}
        viewBox={`0 0 ${W} ${H}`}
        accessible
        accessibilityRole="image"
        accessibilityLabel={a11yLabel ?? `${layout.label} ${layout.hero.value} ${layout.hero.unit}`}
        testID={testID}
      >
        <Rect x={0} y={0} width={W} height={H} fill={color.canvas} />
        {/* 品牌列：霓虹只打在這裡與主數字（§4.2 Signal over spectacle） */}
        <Rect x={PAD} y={84} width={8} height={48} fill={tint} />
        <SvgText x={PAD + 28} y={124} fontSize={44} fontWeight="700" fill={color.textPrimary} letterSpacing={6}>NEONSHIFT</SvgText>
        <SvgText x={W - PAD} y={124} fontSize={32} fill={color.textSecondary} textAnchor="end" testID="share-card-label">{layout.label}</SvgText>
        <Rect x={PAD} y={168} width={W - PAD * 2} height={2} fill={color.borderSubtle} />

        {heroLines.map((l, i) => (
          <SvgText key={`hero${i}`} x={PAD} y={heroTop + heroSize * (i + 1) * 0.82} fontSize={heroSize} fontWeight="700" fill={tint} testID={i === 0 ? 'share-card-hero' : undefined}>
            {l}
            {i === heroLines.length - 1 && layout.hero.unit ? (
              <TSpan fontSize={heroSize * 0.36} fontWeight="400" fill={color.textSecondary} dx={18}>{layout.hero.unit}</TSpan>
            ) : null}
          </SvgText>
        ))}

        {isAchievement && layout.emblem ? (
          <G testID={`share-card-emblem-${layout.emblem}`}>
            <Circle cx={W / 2} cy={emblemY} r={176} fill={color.surface} stroke={tint} strokeWidth={4} />
            <Circle cx={W / 2} cy={emblemY} r={148} fill="none" stroke={tint} strokeOpacity={0.35} strokeWidth={2} strokeDasharray="8 14" />
            <SvgText x={W / 2} y={emblemY + 34} fontSize={96} fontWeight="700" fill={tint} textAnchor="middle">{emblemLabel(layout.emblem)}</SvgText>
          </G>
        ) : null}

        {layout.lines.map((l, i) => (
          <SvgText key={`line${i}`} x={PAD} y={lineTop + i * 58} fontSize={40} fill={color.textPrimary} testID={`share-card-line-${i}`}>{l}</SvgText>
        ))}

        {layout.chips.map((c, i) => {
          const cx = PAD + (i % 4) * 232;
          const cy = chipTop + Math.floor(i / 4) * 86;
          return (
            <G key={`chip${i}`}>
              <Rect x={cx} y={cy} width={216} height={72} rx={16} fill={color.surface} stroke={color.borderSubtle} strokeWidth={2} />
              <SvgText x={cx + 108} y={cy + 47} fontSize={34} fill={color.textSecondary} textAnchor="middle">{c}</SvgText>
            </G>
          );
        })}

        {/* 路線形狀：無底圖、無座標、無起終點標記、無比例尺（§5.2） */}
        {layout.route && routeSize > 120 ? (
          <G testID="share-card-route">
            <Rect x={(W - routeSize) / 2} y={routeTop} width={routeSize} height={routeSize} rx={24} fill={color.surface} stroke={color.borderSubtle} strokeWidth={2} />
            {layout.route.segments.map((seg, i) => (
              <Polyline
                key={`seg${i}`}
                points={seg.map((p) => `${((W - routeSize) / 2 + 24 + p.x * (routeSize - 48)).toFixed(1)},${(routeTop + 24 + p.y * (routeSize - 48)).toFixed(1)}`).join(' ')}
                fill="none"
                stroke={color.mint}
                strokeWidth={8}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          </G>
        ) : null}

        <Rect x={PAD} y={H - 268} width={W - PAD * 2} height={2} fill={color.borderSubtle} />
        {tagline.map((l, i) => (
          <SvgText key={`tag${i}`} x={PAD} y={H - 208 + i * 46} fontSize={36} fill={color.textSecondary} testID={`share-card-tagline-${i}`}>{l}</SvgText>
        ))}
        <SvgText x={PAD} y={H - 96} fontSize={38} fontWeight="700" fill={color.mint} testID="share-card-site">{layout.site}</SvgText>
        {layout.notice ? (
          <SvgText x={PAD} y={H - 44} fontSize={30} fill={color.textMuted} testID="share-card-notice">{layout.notice}</SvgText>
        ) : null}
        {qr ? (
          <G testID="share-card-qr">
            <Rect x={W - PAD - QR_SIZE} y={H - PAD - QR_SIZE} width={QR_SIZE} height={QR_SIZE} rx={12} fill={color.textPrimary} />
            <G x={W - PAD - QR_SIZE} y={H - PAD - QR_SIZE}>
              <Path d={qr.d} fill={color.canvas} />
            </G>
          </G>
        ) : null}
      </Svg>
    );
  },
);
