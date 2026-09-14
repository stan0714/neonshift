// PG-G-04：產生 neonshift.cc/nft/<kind>.json 與 img/<kind>.svg（Metaplex JSON 標準）。
// 五階跑鞋幾何與色彩對齊 app/src/components/ShoeHero.tsx 與 style.md 16.2；徽章為品牌色 icon。
// 用法：node tools/nft-assets/build.mjs  → 寫入 web/nft/
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = resolve(ROOT, "web/nft");
const BASE = "https://neonshift.cc/nft";

const color = { canvas: "#050711", surface: "#0B1020", elevated: "#121A2E", borderSubtle: "#26324A", textPrimary: "#F4F8FF", textSecondary: "#AAB7CC", textMuted: "#718099", mint: "#30EBC8", cyan: "#24C8FF", violet: "#9B6CFF", magenta: "#FF4FD8", warning: "#FFCB66" };
const stages = [
  { level: 1, name: "Origin", xp: 0, tint: color.textSecondary, accent: color.textMuted, material: color.elevated, detail: "Graphite mesh · single light rail" },
  { level: 2, name: "Pulse", xp: 450, tint: color.cyan, accent: color.mint, material: color.borderSubtle, detail: "Twin rails · reinforced heel" },
  { level: 3, name: "Phase", xp: 1500, tint: color.violet, accent: color.cyan, material: color.elevated, detail: "Side exoskeleton · split sole" },
  { level: 4, name: "Surge", xp: 3600, tint: color.magenta, accent: color.violet, material: color.borderSubtle, detail: "Heel fins · energy chamber" },
  { level: 5, name: "Zenith", xp: 7500, tint: color.mint, accent: color.violet, material: color.textMuted, detail: "Pearl armor · floating sole pods" },
];

function shoeSvg(s) {
  const level = s.level;
  const tint = s.tint;
  const g = (id, stops, attrs) => `<linearGradient id="${id}" ${attrs}>${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join("")}</linearGradient>`;
  const stage = [
    level >= 2 ? `<path d="M32 90 L44 99 L49 122 L36 120 Z" fill="${s.material}" stroke="${tint}" stroke-width="1.2"/>` : "",
    level >= 3 ? `<path d="M70 103 L84 97 L91 127 L81 126 Z M108 113 L117 112 L122 134 L112 132 Z M167 115 L175 117 L169 135 L160 137 Z" fill="${s.material}" stroke="${tint}" stroke-opacity="0.75"/><path d="M102 143 L113 150 L143 149 L157 142" stroke="${color.canvas}" stroke-width="3" fill="none"/>` : "",
    level >= 4 ? `<path d="M34 99 L23 76 L38 83 L28 64 L44 77 L47 98 Z" fill="${s.material}" stroke="${tint}" stroke-width="1.2"/><path d="M49 139 Q68 144 89 145 L84 151 L52 147 Z" fill="${color.canvas}" stroke="${tint}"/><path d="M56 142 L79 146" stroke="${tint}" stroke-width="2"/>` : "",
    level === 5 ? `<path d="M174 108 L193 108 L215 120 L199 120 Z M69 101 L78 89 L86 96 L83 106 Z" fill="${color.textSecondary}" stroke="${color.textPrimary}" stroke-opacity="0.7"/><path d="M61 151 L88 155 L86 160 L60 156 Z M154 154 L178 151 L177 157 L153 160 Z" fill="${s.material}" stroke="${tint}"/><path d="M93 155 H145" stroke="${s.accent}" stroke-dasharray="3 4"/>` : "",
    level >= 2 ? `<path d="M48 132 Q110 147 196 136" stroke="${tint}" stroke-width="1" fill="none"/>` : "",
    level >= 3 ? `<path d="M176 111 L183 119 M186 113 L193 121" stroke="${tint}" stroke-width="1.5"/>` : "",
    level >= 4 ? `<circle cx="47" cy="110" r="4" fill="${tint}" fill-opacity="0.7"/>` : "",
    level === 5 ? `<path d="M51 100 L57 95 L63 102" stroke="${color.mint}" fill="none" stroke-width="2"/>` : "",
  ].join("");
  const laces = [0, 1, 2, 3].map((n) => `<circle cx="${95 + n * 9}" cy="${78 + n * 7}" r="2.3" fill="${color.canvas}" stroke="${tint}" stroke-opacity="0.5"/><path d="M${94 + n * 9} ${78 + n * 7} l19 -2 l-12 10" fill="none" stroke="${color.textSecondary}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`).join("");
  const mesh = [0, 1, 2].flatMap((row) => [0, 1, 2, 3, 4].map((col) => `<circle cx="${73 + col * 8 + row * 3}" cy="${109 + row * 6}" r="0.8" fill="${color.textSecondary}" fill-opacity="0.4"/>`)).join("");
  const tread = [46, 63, 80, 97, 151, 168, 185, 202].map((x) => `<path d="M${x} 143 l-3 5" stroke="${color.canvas}" stroke-width="3" stroke-linecap="round"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 520" width="520" height="520">
<defs>
<radialGradient id="halo"><stop offset="0" stop-color="${tint}" stop-opacity="0.16"/><stop offset="1" stop-color="${tint}" stop-opacity="0"/></radialGradient>
${g("upper", [[0, color.textMuted], [0.36, s.material], [1, color.surface]], 'x1="0%" y1="0%" x2="80%" y2="100%"')}
${g("sole", [[0, color.textSecondary], [0.35, color.borderSubtle], [1, color.surface]], 'x1="0%" y1="0%" x2="0%" y2="100%"')}
${g("energy", [[0, s.accent], [0.55, tint], [1, s.accent]], 'x1="0%" y1="0%" x2="100%" y2="0%"')}
</defs>
<rect width="520" height="520" rx="48" fill="${color.canvas}"/>
<g transform="translate(0 40) scale(2)">
<ellipse cx="130" cy="108" rx="120" ry="88" fill="url(#halo)"/>
<ellipse cx="130" cy="173" rx="111" ry="23" fill="${color.surface}" fill-opacity="0.6" stroke="${tint}" stroke-opacity="0.16"/>
<ellipse cx="130" cy="173" rx="96" ry="17" fill="none" stroke="${tint}" stroke-opacity="0.3" stroke-dasharray="3 9"/>
<path d="M22 169 H35 M225 169 H238" stroke="${tint}" stroke-opacity="0.5" stroke-width="1.5"/>
<path d="M29 127 Q21 138 35 148 Q110 166 207 148 Q236 143 234 130 L224 119 Z" fill="${color.canvas}" stroke="${color.borderSubtle}" stroke-width="1.5"/>
<path d="M28 118 Q65 125 125 129 Q181 133 219 116 L234 127 Q241 136 218 141 Q127 163 35 139 Q23 135 28 118 Z" fill="url(#sole)" stroke="${color.textMuted}" stroke-opacity="0.6"/>
<path d="M36 138 Q119 158 216 140" fill="none" stroke="${tint}" stroke-opacity="0.45"/>
${tread}
<path d="M30 121 L34 73 Q36 62 48 66 L63 81 Q76 87 87 67 L101 51 Q112 47 120 61 L139 84 Q159 101 192 104 Q217 105 228 119 Q232 124 216 130 Q157 147 91 135 L39 128 Z" fill="url(#upper)" stroke="${color.textMuted}" stroke-width="1.2"/>
<path d="M38 72 Q47 72 57 86 Q73 98 93 67 L102 59 Q103 77 89 91 Q69 111 43 90 Z" fill="${color.canvas}" stroke="${color.borderSubtle}" stroke-width="2"/>
<path d="M40 83 L40 118 L64 124 L68 101" fill="${color.elevated}" stroke="${color.textMuted}" stroke-opacity="0.45"/>
<path d="M102 62 L123 87 L149 105 L131 117 L86 97 Z" fill="${color.elevated}" stroke="${color.borderSubtle}"/>
<path d="M153 107 Q184 106 202 112 Q216 118 219 123" fill="none" stroke="${color.textSecondary}" stroke-opacity="0.48"/>
<path d="M170 117 Q193 114 216 124 L214 130 Q190 139 168 138" fill="${color.surface}" fill-opacity="0.6" stroke="${color.borderSubtle}"/>
${laces}${mesh}${stage}
<path d="M125 124 L136 103 L144 105 L150 117 L157 106 L166 109 L153 130 L145 128 L139 116 L133 126 Z" fill="url(#energy)"/>
<path d="M36 125 Q104 148 214 131" fill="none" stroke="${tint}" stroke-opacity="0.12" stroke-width="7"/>
<path d="M36 125 Q104 148 214 131" fill="none" stroke="url(#energy)" stroke-width="2" stroke-linecap="round"/>
<path d="M36 78 L34 103" stroke="${tint}" stroke-width="2" stroke-linecap="round"/>
</g>
<text x="40" y="472" font-family="Inter, Roboto, Helvetica, Arial, sans-serif" font-size="22" font-weight="600" letter-spacing="3" fill="${color.textSecondary}">NEONSHIFT · LV. ${level}</text>
<text x="480" y="472" text-anchor="end" font-family="Inter, Roboto, Helvetica, Arial, sans-serif" font-size="22" font-weight="700" fill="${tint}">${s.name.toUpperCase()}</text>
</svg>`;
}

function badgeSvg({ title, tint, glyph }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 520" width="520" height="520">
<defs><radialGradient id="halo"><stop offset="0" stop-color="${tint}" stop-opacity="0.22"/><stop offset="1" stop-color="${tint}" stop-opacity="0"/></radialGradient></defs>
<rect width="520" height="520" rx="48" fill="${color.canvas}"/>
<circle cx="260" cy="230" r="200" fill="url(#halo)"/>
<circle cx="260" cy="230" r="118" fill="${color.surface}" stroke="${tint}" stroke-width="3"/>
<circle cx="260" cy="230" r="140" fill="none" stroke="${tint}" stroke-opacity="0.35" stroke-dasharray="4 12"/>
<g transform="translate(260 230)" fill="none" stroke="${tint}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>
<text x="260" y="440" text-anchor="middle" font-family="Inter, Roboto, Helvetica, Arial, sans-serif" font-size="26" font-weight="700" letter-spacing="2" fill="${color.textPrimary}">${title.toUpperCase()}</text>
<text x="260" y="478" text-anchor="middle" font-family="Inter, Roboto, Helvetica, Arial, sans-serif" font-size="18" letter-spacing="3" fill="${color.textMuted}">NEONSHIFT BADGE</text>
</svg>`;
}

const glyphs = {
  zap: `<path d="M12 -70 L-32 6 L-2 6 L-12 70 L32 -6 L2 -6 Z"/>`,
  calendar: `<rect x="-58" y="-46" width="116" height="104" rx="12"/><path d="M-58 -12 H58 M-30 -70 V-30 M30 -70 V-30"/><path d="M-22 22 L-6 38 L26 6" stroke-width="12"/>`,
  award: `<circle cx="0" cy="-22" r="42"/><path d="M-26 12 L-40 72 L0 52 L40 72 L26 12"/>`,
};
const badges = [
  { kind: 101, title: "First Clock-In", tint: color.cyan, glyph: glyphs.zap, description: "Awarded for the first verified NeonShift clock-in. Health data stays on the phone; only this badge is public.", trait: "First Clock-In" },
  { kind: 102, title: "7-Day Streak", tint: color.mint, glyph: glyphs.calendar, description: "Seven consecutive days of verified missions. Earned once, kept forever.", trait: "7-Day Streak" },
  { kind: 111, title: "Arena #1", tint: color.warning, glyph: glyphs.award, description: "Weekend step marathon champion.", trait: "Arena Rank 1" },
  { kind: 112, title: "Arena #2", tint: color.textSecondary, glyph: glyphs.award, description: "Weekend step marathon runner-up.", trait: "Arena Rank 2" },
  { kind: 113, title: "Arena #3", tint: color.magenta, glyph: glyphs.award, description: "Weekend step marathon third place.", trait: "Arena Rank 3" },
];

mkdirSync(resolve(OUT, "img"), { recursive: true });
const index = [];
for (const s of stages) {
  writeFileSync(resolve(OUT, `img/${s.level}.svg`), shoeSvg(s));
  const json = {
    name: `NeonShift Shoe · ${s.name}`,
    symbol: "NSHOE",
    description: `Level ${s.level} NeonShift gear, earned with ${s.xp.toLocaleString("en-US")} XP of verified movement. ${s.detail}. A free achievement collectible — no purchase, no monetary value.`,
    image: `${BASE}/img/${s.level}.png`,
    external_url: "https://neonshift.cc",
    attributes: [
      { trait_type: "Type", value: "Shoe" },
      { trait_type: "Level", value: s.level },
      { trait_type: "Stage", value: s.name },
      { trait_type: "XP threshold", value: s.xp },
      { trait_type: "Detail", value: s.detail },
    ],
    properties: { category: "image", files: [{ uri: `${BASE}/img/${s.level}.png`, type: "image/png" }, { uri: `${BASE}/img/${s.level}.svg`, type: "image/svg+xml" }] },
  };
  writeFileSync(resolve(OUT, `${s.level}.json`), JSON.stringify(json, null, 2) + "\n");
  index.push({ kind: s.level, name: json.name, uri: `${BASE}/${s.level}.json` });
}
for (const b of badges) {
  writeFileSync(resolve(OUT, `img/${b.kind}.svg`), badgeSvg(b));
  const json = {
    name: `NeonShift Badge · ${b.title}`,
    symbol: "NSBADGE",
    description: `${b.description} A free achievement collectible — no purchase, no monetary value.`,
    image: `${BASE}/img/${b.kind}.png`,
    external_url: "https://neonshift.cc",
    attributes: [
      { trait_type: "Type", value: "Badge" },
      { trait_type: "Achievement", value: b.trait },
      { trait_type: "Kind", value: b.kind },
    ],
    properties: { category: "image", files: [{ uri: `${BASE}/img/${b.kind}.png`, type: "image/png" }, { uri: `${BASE}/img/${b.kind}.svg`, type: "image/svg+xml" }] },
  };
  writeFileSync(resolve(OUT, `${b.kind}.json`), JSON.stringify(json, null, 2) + "\n");
  index.push({ kind: b.kind, name: json.name, uri: `${BASE}/${b.kind}.json` });
}
writeFileSync(resolve(OUT, "index.json"), JSON.stringify({ base: BASE, collectibles: index }, null, 2) + "\n");
// PNG fallback（Style 16.2；部分錢包不渲染 SVG）：需要 rsvg-convert（brew install librsvg）
import { execFileSync } from "node:child_process";
let png = 0;
for (const { kind } of index) {
  try {
    execFileSync("rsvg-convert", ["-w", "1024", "-h", "1024", "-o", resolve(OUT, `img/${kind}.png`), resolve(OUT, `img/${kind}.svg`)]);
    png++;
  } catch {
    console.warn(`rsvg-convert 不可用，略過 ${kind}.png`);
    break;
  }
}
console.log(`wrote ${index.length} metadata files + svg to ${OUT}（png ${png}）`);
