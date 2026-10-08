// COMP-07／08：產生 web/licenses/index.html（App 內 Profile「Open-source licenses」連結目標）。
// 來源：app 與 backend 的 production 依賴（license-checker JSON）＋ Rust／素材固定條目。不要手改輸出檔。
//   node tools/licenses/build.mjs
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("../..", import.meta.url).pathname);
const read = (dir) => JSON.parse(execSync("npx --yes license-checker --production --json", { cwd: resolve(root, dir), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const merge = new Map();
for (const dir of ["app", "backend"]) {
  for (const [name, v] of Object.entries(read(dir))) {
    if (name.startsWith("@neonshift/")) continue;
    const key = name.replace(/@[^@]+$/, "");
    const cur = merge.get(key) ?? { licenses: new Set(), versions: new Set(), repo: v.repository ?? "", where: new Set() };
    cur.licenses.add(String(v.licenses)); cur.versions.add(name.slice(key.length + 1)); cur.where.add(dir); if (!cur.repo && v.repository) cur.repo = v.repository;
    merge.set(key, cur);
  }
}
const rows = [...merge.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([n, v]) => `<tr><td>${esc(n)}</td><td>${esc([...v.versions].join(", "))}</td><td>${esc([...v.licenses].join(" / "))}</td><td>${[...v.where].join("+")}</td><td>${v.repo ? `<a href="${esc(v.repo)}">source</a>` : ""}</td></tr>`).join("\n");
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NeonShift Open-Source Licenses</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #050711; color: #F4F8FF; font: 16px/1.6 Inter, Roboto, Helvetica, Arial, sans-serif; }
  main { max-width: 900px; margin: 0 auto; padding: 40px 20px 80px; }
  h1 { font-size: 28px; margin: 0 0 4px; }
  h2 { font-size: 18px; margin: 32px 0 8px; color: #30EBC8; }
  p, li { color: #AAB7CC; }
  .meta { color: #718099; font-size: 14px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #26324A; vertical-align: top; }
  th { color: #F4F8FF; }
  a { color: #24C8FF; }
  code { background: #121A2E; padding: 1px 6px; border-radius: 6px; }
</style>
</head>
<body>
<main>
  <h1>Open-Source Licenses</h1>
  <p class="meta">Generated ${new Date().toISOString().slice(0, 10)} from the production dependencies of the NeonShift app (<code>cc.neonshift.app</code>) and API. NeonShift source: <a href="https://github.com/">repository link published with the hackathon submission</a>.</p>

  <h2>Notices</h2>
  <ul>
    <li><strong>rpc-websockets</strong> (LGPL-3.0-only) is used unmodified as a transitive dependency of <code>@solana/web3.js</code>. You may obtain its source at <a href="https://github.com/elpheria/rpc-websockets">github.com/elpheria/rpc-websockets</a>; the app links it dynamically as a JavaScript module, so it can be replaced with a modified copy in a rebuilt bundle.</li>
    <li><strong>node-forge</strong> is used under the BSD-3-Clause option of its dual license.</li>
    <li>Icons: <strong>Feather</strong> via <code>@expo/vector-icons</code> (MIT). Fonts: Android system fonts. Species facts are paraphrased from public WWF species pages with attribution and links inside the app; no WWF imagery or logo is used.</li>
    <li>Solana programs are built with <strong>Anchor</strong> and <strong>solana-program</strong> (Apache-2.0).</li>
  </ul>

  <h2>Packages</h2>
  <table>
    <thead><tr><th>Package</th><th>Version</th><th>License</th><th>Used in</th><th></th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
</main>
</body>
</html>
`;
mkdirSync(resolve(root, "web/licenses"), { recursive: true });
writeFileSync(resolve(root, "web/licenses/index.html"), html);
console.log(`web/licenses/index.html: ${merge.size} packages`);
