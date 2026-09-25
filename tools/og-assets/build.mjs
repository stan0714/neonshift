// PG-SHARE-04：產生 web/og/<kind>-v<n>.svg 與 .png（1200×630 社群預覽圖）。
// 靜態圖、版本化檔名：第三方快取不保證即時更新，改圖就改版本號（social-share §6.2）。
// 色彩對齊 app/src/theme/tokens.ts 與 style.md；用法：node tools/og-assets/build.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = resolve(ROOT, "web/og");
export const OG_VERSION = 1;

const color = { canvas: "#050711", surface: "#0B1020", borderSubtle: "#26324A", textPrimary: "#F4F8FF", textSecondary: "#AAB7CC", textMuted: "#718099", mint: "#30EBC8", cyan: "#24C8FF", violet: "#9B6CFF" };

/** 每種分享落地頁一張；文字兩語並列，社群預覽無法依讀者語言換圖 */
const cards = [
  { kind: "brand", tint: color.mint, en: "Walk or run. Grow your shoes.", zh: "走路跑步養跑鞋，逐步解鎖成就收藏", badge: "NEONSHIFT" },
  { kind: "workout", tint: color.mint, en: "A verified walk or run", zh: "一次經過驗證的跑步或健走", badge: "WORKOUT" },
  { kind: "achievement", tint: color.violet, en: "An on-chain achievement collectible", zh: "一枚鏈上成就收藏", badge: "ACHIEVEMENT" },
  { kind: "gear", tint: color.cyan, en: "Shoes that level up as you move", zh: "會隨著你移動而升階的跑鞋", badge: "GEAR" },
  { kind: "guardian", tint: color.cyan, en: "Wildlife stories behind the shoes", zh: "跑鞋背後的野生動物故事", badge: "GUARDIAN" },
  { kind: "passport", tint: color.mint, en: "Every achievement, with its source", zh: "每一枚成就都看得到來源與有效性", badge: "PASSPORT" },
  { kind: "event", tint: color.violet, en: "Join a NeonShift event", zh: "一起參加 NeonShift 活動", badge: "EVENT" },
];

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function svg(c) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs>
  <linearGradient id="edge" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="${color.mint}"/><stop offset="0.5" stop-color="${color.cyan}"/><stop offset="1" stop-color="${color.violet}"/>
  </linearGradient>
  <radialGradient id="glow" cx="18%" cy="22%" r="70%">
    <stop offset="0" stop-color="${c.tint}" stop-opacity="0.18"/><stop offset="1" stop-color="${c.tint}" stop-opacity="0"/>
  </radialGradient>
</defs>
<rect width="1200" height="630" fill="${color.canvas}"/>
<rect width="1200" height="630" fill="url(#glow)"/>
<rect x="0" y="0" width="1200" height="6" fill="url(#edge)"/>
<rect x="72" y="86" width="8" height="44" fill="${c.tint}"/>
<text x="100" y="122" font-family="Inter, Roboto, Helvetica, Arial, sans-serif" font-size="34" font-weight="700" letter-spacing="6" fill="${color.textPrimary}">NEONSHIFT</text>
<text x="1128" y="122" text-anchor="end" font-family="Inter, Roboto, Helvetica, Arial, sans-serif" font-size="24" letter-spacing="4" fill="${c.tint}">${esc(c.badge)}</text>
<text x="72" y="300" font-family="Inter, Roboto, Helvetica, Arial, sans-serif" font-size="62" font-weight="700" fill="${color.textPrimary}">${esc(c.en)}</text>
<text x="72" y="372" font-family="Inter, Roboto, Helvetica, Arial, sans-serif" font-size="36" fill="${color.textSecondary}">${esc(c.zh)}</text>
<rect x="72" y="436" width="1056" height="2" fill="${color.borderSubtle}"/>
<text x="72" y="496" font-family="Inter, Roboto, Helvetica, Arial, sans-serif" font-size="30" fill="${color.textSecondary}">Android · Solana Mobile Seeker</text>
<text x="72" y="546" font-family="Inter, Roboto, Helvetica, Arial, sans-serif" font-size="34" font-weight="700" fill="${color.mint}">neonshift.cc</text>
<text x="1128" y="546" text-anchor="end" font-family="Inter, Roboto, Helvetica, Arial, sans-serif" font-size="24" fill="${color.textMuted}">DEVNET · Test tokens · No monetary value</text>
</svg>
`;
}

mkdirSync(OUT, { recursive: true });
let png = 0;
for (const c of cards) {
  const base = `${c.kind}-v${OG_VERSION}`;
  writeFileSync(resolve(OUT, `${base}.svg`), svg(c));
  try {
    // 社群爬蟲幾乎都不吃 SVG：PNG 才是實際的 og:image（同 tools/nft-assets 的做法）
    execFileSync("rsvg-convert", ["-w", "1200", "-h", "630", "-o", resolve(OUT, `${base}.png`), resolve(OUT, `${base}.svg`)]);
    png++;
  } catch {
    console.warn(`rsvg-convert 不可用，略過 ${base}.png（brew install librsvg）`);
  }
}
console.log(`wrote ${cards.length} og svg + ${png} png to ${OUT}`);
