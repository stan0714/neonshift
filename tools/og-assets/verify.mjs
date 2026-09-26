// PG-SHARE-04：靜態檢查每個可分享頁面的社群預覽 head（social-share §9.1「OG」）。
// 只驗證檔案內容——爬蟲實際抓取結果仍要部署後實測，這裡先擋掉「忘了加標籤／圖片路徑打錯／canonical 帶來源參數」。
// 用法：node tools/og-assets/verify.mjs
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const WEB = resolve(ROOT, "web");
const PAGES = ["index.html", "en/index.html", "e/index.html", "s/index.html", "s/workout.html", "s/achievement.html", "s/gear.html", "s/guardian.html", "s/passport.html", "s/seasonal.html"];
const REQUIRED = ["og:title", "og:type", "og:url", "og:image", "og:description", "og:image:alt", "og:image:width", "og:image:height", "twitter:card"];

const meta = (html, name) => {
  const m = new RegExp(`<meta (?:property|name)="${name}" content="([^"]*)"`).exec(html);
  return m ? m[1] : null;
};

let fail = 0;
const bad = (page, msg) => { console.error(`FAIL ${page}: ${msg}`); fail++; };

for (const page of PAGES) {
  const file = resolve(WEB, page);
  if (!existsSync(file)) { bad(page, "檔案不存在"); continue; }
  const html = readFileSync(file, "utf8");
  for (const name of REQUIRED) if (meta(html, name) === null) bad(page, `缺 ${name}`);
  const url = meta(html, "og:url");
  // canonical 必須是不含來源參數的絕對 HTTPS URL，否則各平台會把同一頁當成多頁
  if (url && !/^https:\/\/neonshift\.cc\//.test(url)) bad(page, `og:url 不是絕對 HTTPS：${url}`);
  if (url && /[?#]/.test(url)) bad(page, `og:url 含 query／fragment：${url}`);
  const canonical = /<link rel="canonical" href="([^"]*)"/.exec(html)?.[1];
  if (canonical && url && canonical !== url) bad(page, `canonical（${canonical}）與 og:url（${url}）不一致`);
  const img = meta(html, "og:image");
  if (img) {
    if (!/^https:\/\/neonshift\.cc\/og\/[a-z]+-v\d+\.png$/.test(img)) bad(page, `og:image 必須是版本化的絕對 PNG：${img}`);
    else if (!existsSync(resolve(WEB, img.replace("https://neonshift.cc/", "")))) bad(page, `og:image 檔案不存在：${img}`);
    if (meta(html, "twitter:image") !== img) bad(page, "twitter:image 與 og:image 不一致");
  }
  if (meta(html, "twitter:card") !== "summary_large_image") bad(page, "twitter:card 不是 summary_large_image");
  // 安裝入口：尚未上架就要說清楚，不假裝可安裝
  if (page.startsWith("s/") && !/尚未開放下載/.test(html)) bad(page, "缺少尚未上架的安裝說明");
  // deep link 與計數 kind 必須與檔名一致：這幾頁是互相複製出來的，漏改一處就會把人導到別的畫面
  const kind = /^s\/(.+)\.html$/.exec(page)?.[1];
  if (kind && kind !== "index") {
    for (const m of html.matchAll(/neonshift:\/\/s\/([a-z]+)/g)) if (m[1] !== kind) bad(page, `deep link 指向別的 kind：${m[0]}`);
    const declared = /var KIND = '([a-z]*)'/.exec(html)?.[1];
    if (declared !== kind) bad(page, `計數 KIND（${declared}）與檔名（${kind}）不一致`);
    if (!new RegExp(`https://neonshift\\.cc/s/${kind}`).test(html)) bad(page, "複製連結的 URL 不是這一頁");
  }
  if (fail === 0) console.log(`PASS ${page}`);
}

if (fail) { console.error(`\n${fail} 項不合格`); process.exit(1); }
console.log(`\n${PAGES.length} 個頁面通過社群預覽 head 檢查`);
