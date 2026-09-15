// PG-D-06：tSKR 經濟模擬（BRD 8.2／8.4／8.5）。100 位使用者 × 30 天；輸出 CSV 與摘要（消耗／產出比）。
// 參數與鏈上一致：基礎 10／5 tSKR、Core 倍率 [1.0,1.2,1.5,1.8,2.2]、XP 100／50、門檻 [0,450,1500,3600,7500]、
// 每日上限 40；錦標賽質押 50、得獎 30%（A 10%）、未得獎退 50%、A/B 池 60/40、國庫挹注上限 1,000。
// 用法：node tools/tokenomics/simulate.mjs [--users 100] [--days 30] [--seed 7] [--out docs/economics/sim.csv]
import { writeFileSync } from "node:fs";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const USERS = Number(arg("--users", 100));
const DAYS = Number(arg("--days", 30));
const OUT = arg("--out", "docs/economics/sim.csv");
let seed = Number(arg("--seed", 7));
const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) % 1_000_000) / 1_000_000; };

const P = { baseSteps: 10, baseSleep: 5, dailyCap: 40, mult: [1.0, 1.2, 1.5, 1.8, 2.2], xpSteps: 100, xpSleep: 50, thresholds: [0, 450, 1500, 3600, 7500], stake: 50, winnerPct: 0.3, groupAPct: 0.1, loserRefund: 0.5, prizeA: 0.6, prizeB: 0.4, injectionCap: 1000, rewardFund: 200_000 };

// 使用者分群（假設）：活躍 30% 每日兩任務、一般 50% 步數 4 天/週睡眠 2 天/週、輕度 20% 每週 1～2 次
const users = Array.from({ length: USERS }, (_, i) => {
  const r = i / USERS;
  const seg = r < 0.3 ? "active" : r < 0.8 ? "regular" : "light";
  const pSteps = seg === "active" ? 0.9 : seg === "regular" ? 0.57 : 0.2;
  const pSleep = seg === "active" ? 0.8 : seg === "regular" ? 0.3 : 0.1;
  const pJoin = seg === "active" ? 0.7 : seg === "regular" ? 0.3 : 0.05;
  return { id: i, seg, pSteps, pSleep, pJoin, xp: 0, level: 1, balance: 0, earned: 0, staked: 0, back: 0 };
});
const levelOf = (xp) => P.thresholds.filter((t) => xp >= t).length;

const rows = [["day", "steps_claims", "sleep_claims", "emitted_tskr", "cum_emitted", "avg_level", "tournament_staked", "tournament_paid_out", "treasury_remainder", "cum_sink"]];
let cumEmitted = 0, cumSink = 0, treasury = 0;
for (let day = 1; day <= DAYS; day++) {
  let stepsClaims = 0, sleepClaims = 0, emitted = 0;
  for (const u of users) {
    let today = 0;
    if (rnd() < u.pSteps) { const amt = Math.min(P.baseSteps * P.mult[u.level - 1], P.dailyCap - today); today += amt; u.xp += P.xpSteps; stepsClaims++; }
    if (rnd() < u.pSleep) { const amt = Math.min(P.baseSleep * P.mult[u.level - 1], P.dailyCap - today); today += amt; u.xp += P.xpSleep; sleepClaims++; }
    u.level = levelOf(u.xp);
    u.balance += today; u.earned += today; emitted += today;
  }
  cumEmitted += emitted;
  // 週末錦標賽：週六開賽（day % 7 === 6），週一結算；在此以開賽日一次結清
  let staked = 0, paid = 0, remainder = 0;
  if (day % 7 === 6) {
    const entrants = users.filter((u) => u.balance >= P.stake && rnd() < u.pJoin);
    if (entrants.length >= 10) {
      const n = entrants.length; staked = n * P.stake;
      const winners = Math.max(1, Math.ceil(n * P.winnerPct)); const a = Math.max(1, Math.ceil(n * P.groupAPct)); const b = winners - a;
      const injection = Math.min(P.injectionCap, treasury);
      treasury -= injection;
      const totalRefund = winners * P.stake + (n - winners) * P.stake * P.loserRefund;
      const pool = staked + injection - totalRefund;
      const poolA = Math.floor(pool * P.prizeA), poolB = Math.floor(pool * P.prizeB);
      const share = (poolG, k, pos) => (k === 0 ? 0 : Math.floor((poolG * (k - pos + 1)) / ((k * (k + 1)) / 2)));
      // 名次：以活躍度加隨機
      const ranked = entrants.map((u) => ({ u, s: u.pSteps * 10_000 + rnd() * 5_000 })).sort((x, y) => y.s - x.s);
      ranked.forEach(({ u }, i) => {
        const rank = i + 1; u.balance -= P.stake; u.staked += P.stake;
        const refund = rank <= winners ? P.stake : P.stake * P.loserRefund;
        const prize = rank <= a ? share(poolA, a, rank) : rank <= winners ? share(poolB, b, rank - a) : 0;
        u.balance += refund + prize; u.back += refund + prize; paid += refund + prize;
      });
      remainder = staked + injection - paid;
      treasury += remainder;
      cumSink += staked - (paid - injection); // 使用者淨流出（質押 − 取回中非國庫來源部分）
    }
  }
  const avgLevel = users.reduce((s, u) => s + u.level, 0) / USERS;
  rows.push([day, stepsClaims, sleepClaims, emitted.toFixed(0), cumEmitted.toFixed(0), avgLevel.toFixed(2), staked, paid.toFixed(0), remainder.toFixed(0), cumSink.toFixed(0)]);
}
writeFileSync(OUT, rows.map((r) => r.join(",")).join("\n") + "\n");
const levels = [1, 2, 3, 4, 5].map((l) => users.filter((u) => u.level === l).length);
const summary = {
  users: USERS, days: DAYS,
  emitted_total: Math.round(cumEmitted), emitted_per_user_per_day: (cumEmitted / USERS / DAYS).toFixed(2),
  reward_fund_runway_days: Math.round(P.rewardFund / (cumEmitted / DAYS)),
  tournament_gross_stake: users.reduce((s, u) => s + u.staked, 0), tournament_returned: Math.round(users.reduce((s, u) => s + u.back, 0)),
  treasury_balance: Math.round(treasury),
  sink_over_emission: (cumSink / cumEmitted).toFixed(2),
  level_distribution: levels,
  note: "升級免費（2026-09-14）後主要消耗來源只剩錦標賽質押淨流出；BRD 8.5 目標消耗／產出 ≥ 0.6 需以賽事參與率或新增消耗項達成",
};
console.log(JSON.stringify(summary, null, 2));
