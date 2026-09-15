// PG-V-01：90 天維持情境模擬（shoe-gameplay 8：全勤、睡眠不可用、間歇、長休、回歸）＋ 與舊規則（XP 立即同步升級）的獎勵差異。
// 用法：node tools/maintenance-sim/simulate.mjs [--days 90] [--out docs/economics/maintenance-sim.csv]
import { writeFileSync } from "node:fs";

import { EPOCH_DAYS, MAINTENANCE_RULES_VERSION, MULTIPLIER, XP_THRESHOLDS, settleEpoch, summarize, xpCapLevel } from "./rules.mjs";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const DAYS = Number(arg("--days", 90));
const OUT = arg("--out", "docs/economics/maintenance-sim.csv");
const BASE = { steps: 10, sleep: 5 }; // tSKR 基礎（與 tokenomics 一致）
const XP = { steps: 100, sleep: 50 };

/** 情境：day（1-based）→ { steps, sleep } */
const both = { steps: true, sleep: true };
const stepsOnly = { steps: true, sleep: false };
const none = { steps: false, sleep: false };
const scenarios = {
  full: { label: "全勤（每日雙任務）", day: () => both },
  no_sleep: { label: "睡眠不可用（每日步數）", day: () => stepsOnly },
  intermittent: { label: "間歇（週 4 步數／2 睡眠）", day: (d) => { const w = (d - 1) % 7; return { steps: w < 4, sleep: w === 0 || w === 2 }; } },
  weekend: { label: "週末型（每週 2 天雙任務）", day: (d) => ((d - 1) % 7 >= 5 ? both : none) },
  long_break: { label: "長休（全勤 8 週 → 缺席 5 週 → 全勤）", day: (d) => (d <= 56 ? both : d <= 91 ? none : both) },
  comeback: { label: "回歸（達 Lv5 後缺席 4 期 → 每期 750 點 → 900 點）", day: (d) => (d <= 56 ? both : d <= 84 ? none : d <= 91 ? ((d - 1) % 7 < 5 ? both : none) : both) },
};

const rows = [["scenario", "epoch", "days", "points", "active_days", "double_days", "xp", "xp_cap_level", "active_before", "active_after", "highest", "reason", "multiplier", "tskr_epoch_new", "tskr_epoch_old"]];
const summary = [];
for (const [key, sc] of Object.entries(scenarios)) {
  let st = { active: 1, highest: 1, xp: 0 };
  let oldLevel = 1;
  let tskrNew = 0, tskrOld = 0;
  const firstActivation = {};
  for (let e = 0; e * EPOCH_DAYS < DAYS; e++) {
    const days = [];
    let epochNew = 0, epochOld = 0;
    for (let i = 0; i < EPOCH_DAYS; i++) {
      const d = e * EPOCH_DAYS + i + 1;
      const r = d <= DAYS ? sc.day(d) : none;
      days.push(r);
      // 新規則：期內倍率固定為本期 Active level；舊規則：XP 一達標立即升級
      if (r.steps) { epochNew += BASE.steps * MULTIPLIER[st.active - 1]; st.xp += XP.steps; oldLevel = xpCapLevel(st.xp); epochOld += BASE.steps * MULTIPLIER[oldLevel - 1]; }
      if (r.sleep) { epochNew += BASE.sleep * MULTIPLIER[st.active - 1]; st.xp += XP.sleep; oldLevel = xpCapLevel(st.xp); epochOld += BASE.sleep * MULTIPLIER[oldLevel - 1]; }
    }
    const s = summarize(days);
    const before = st.active;
    st = settleEpoch(st, s);
    tskrNew += epochNew; tskrOld += epochOld;
    if (st.active > before && !firstActivation[st.active]) firstActivation[st.active] = (e + 1) * EPOCH_DAYS;
    rows.push([key, e + 1, `${e * EPOCH_DAYS + 1}-${(e + 1) * EPOCH_DAYS}`, s.points, s.activeDays, s.doubleDays, st.xp, xpCapLevel(st.xp), before, st.active, st.highest, st.reason, MULTIPLIER[st.active - 1], epochNew.toFixed(1), epochOld.toFixed(1)]);
  }
  summary.push({ key, label: sc.label, final: st, firstActivation, tskrNew: Math.round(tskrNew), tskrOld: Math.round(tskrOld) });
}
writeFileSync(OUT, rows.map((r) => r.join(",")).join("\n") + "\n");

console.log(`maintenance rules v${MAINTENANCE_RULES_VERSION} · ${DAYS} 天 · 門檻 XP ${XP_THRESHOLDS.join("/")}`);
for (const s of summary) {
  const fa = Object.entries(s.firstActivation).map(([l, d]) => `Lv${l}@day${d}`).join(" ");
  console.log(`- ${s.label}: 期末 Active Lv${s.final.active}／Highest Lv${s.final.highest}／XP ${s.final.xp}；首次啟用 ${fa || "—"}；tSKR 新規則 ${s.tskrNew} vs 舊規則 ${s.tskrOld}（${((s.tskrNew / Math.max(1, s.tskrOld)) * 100).toFixed(0)}%）`);
}
console.log(`wrote ${rows.length - 1} rows → ${OUT}`);
