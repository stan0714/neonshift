// DEC-04 候選比較：node tools/maintenance-sim/simulate-v2.mjs [--days 98]
import { CANDIDATES, EPOCH_DAYS, MULTIPLIER, XP_THRESHOLDS, minimalCombo, settleEpoch, summarize, xpCapLevel } from "./rules-v2.mjs";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const DAYS = Number(arg("--days", 98));
const BASE = { steps: 10, workout: 5 }; // tSKR 基礎；運動任務暫比照原第二任務（睡眠）5
const XP = { steps: 100, workout: 100 }; // XP 與維持點同數字（候選 A 時運動 XP 仍以維持點 50 計）

const wk = (d) => (d - 1) % 7; // 0=週一
const scenarios = {
  steps_only: { label: "只走路（每日步數，不運動）", day: () => ({ steps: true, workout: false }) },
  steps_2run: { label: "每日步數＋每週 2 次運動（二／四）", day: (d) => ({ steps: true, workout: wk(d) === 1 || wk(d) === 3 }) },
  steps_3run: { label: "每日步數＋每週 3 次運動（一／三／六），週日休息", day: (d) => ({ steps: wk(d) !== 6, workout: [0, 2, 5].includes(wk(d)) }) },
  runner_4: { label: "跑者：每週 4 次運動＋只在運動日達步數", day: (d) => { const r = [0, 2, 4, 5].includes(wk(d)); return { steps: r, workout: r }; } },
  weekend: { label: "週末型：週六日運動＋步數", day: (d) => { const r = wk(d) >= 5; return { steps: r, workout: r }; } },
  intermittent: { label: "間歇：週 4 天步數／1 次運動", day: (d) => ({ steps: wk(d) < 4, workout: wk(d) === 2 }) },
};

for (const [ck, rules] of Object.entries(CANDIDATES)) {
  console.log(`\n=== 候選 ${rules.label} ===`);
  console.log("最省力組合：" + [2, 3, 4, 5].map((l) => { const c = minimalCombo(rules, l); return `Lv${l}=${c ? `${c.workouts} 次運動＋${c.stepDays} 天步數` : "不可能"}`; }).join("；"));
  for (const [key, sc] of Object.entries(scenarios)) {
    let st = { active: 1, highest: 1, xp: 0 };
    let tskr = 0;
    const first = {};
    const xpW = rules.points.workout === 0 ? 0 : rules.points.workout === 50 ? 50 : XP.workout;
    for (let e = 0; e * EPOCH_DAYS < DAYS; e++) {
      const days = [];
      for (let i = 0; i < EPOCH_DAYS; i++) {
        const d = e * EPOCH_DAYS + i + 1;
        const r = d <= DAYS ? sc.day(d) : { steps: false, workout: false };
        days.push(r);
        if (r.steps) { tskr += BASE.steps * MULTIPLIER[st.active - 1]; st.xp += XP.steps; }
        if (r.workout && rules.points.workout > 0) { tskr += BASE.workout * MULTIPLIER[st.active - 1]; st.xp += xpW; }
      }
      const before = st.active;
      st = settleEpoch(rules, st, summarize(rules, days));
      if (st.active > before && !first[st.active]) first[st.active] = (e + 1) * EPOCH_DAYS;
    }
    const fa = Object.entries(first).map(([l, d]) => `Lv${l}@day${d}`).join(" ");
    console.log(`- ${sc.label}: 期末 Lv${st.active}（highest Lv${st.highest}，XP ${st.xp}，XP 上限 Lv${xpCapLevel(st.xp)}）；首次啟用 ${fa || "—"}；tSKR ${Math.round(tskr)}`);
  }
}
console.log(`\n門檻 XP ${XP_THRESHOLDS.join("/")}，${DAYS} 天`);
