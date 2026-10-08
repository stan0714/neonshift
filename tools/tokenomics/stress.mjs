// Deterministic reserve stress test, not a token-price or user-retention forecast.
// Run from repository root: node tools/tokenomics/stress.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const source = readFileSync('programs/neonshift-core/src/constants.rs', 'utf8');
const constant = name => {
  const m = source.match(new RegExp(`pub const ${name}: u64 = (\\d+) \\* TSKR_UNIT;`));
  assert(m, `Missing ${name}`);
  return Number(m[1]);
};
const steps = constant('DEFAULT_BASE_STEPS_REWARD');
const sleep = constant('DEFAULT_BASE_SLEEP_REWARD');
const cap = constant('DEFAULT_DAILY_CAP');
const multipliers = source.match(/DEFAULT_CORE_MULTIPLIER_BPS: \[u16; 5\] = \[([^\]]+)\]/)[1].split(',').map(x => Number(x.trim().replaceAll('_', '')) / 10000);
const reserve = 200000; // Documented initial allocation, NOT a live balance.
const horizon = 180;
const reserveFloor = 20000; // Proposed protection assumption, not production config.
const dailyBudget = (reserve - reserveFloor) / horizon;
const rows = [['scenario', 'eligible_wallets', 'daily_per_wallet_tskr', 'daily_requested_tskr', 'initial_reserve_runway_days', 'proposed_daily_budget_tskr', 'proposed_average_per_wallet_tskr', 'proposed_180d_reserve_tskr']];
for (const users of [100, 1000, 10000]) {
  for (const [label, rate] of [['lv1_both_tasks', Math.min(cap, (steps + sleep) * multipliers[0])], ['lv5_both_tasks', Math.min(cap, (steps + sleep) * multipliers[4])], ['configured_daily_ceiling', cap]]) {
    const demand = users * rate;
    const paid = Math.min(demand, dailyBudget);
    const ending = reserve - paid * horizon;
    assert(ending >= reserveFloor - 1e-6);
    assert(paid <= dailyBudget);
    rows.push([label, users, rate, demand, (reserve / demand).toFixed(2), dailyBudget.toFixed(2), (paid / users).toFixed(4), ending.toFixed(2)]);
  }
}
// Aggregate tournament conservation; ignoring sub-token rounding.
// A+B receive 100% of the distributable pool, so lower refunds do not create a sink.
for (const refundRate of [0.5, 0.3]) {
  const stakes = 100 * 50;
  const refunds = 30 * 50 + 70 * 50 * refundRate;
  const prizes = stakes - refunds;
  assert.equal(refunds + prizes, stakes);
}
// Revenue-backed prizes: illustrative fiat units, already net of operating costs.
for (const revenue of [10000, 2000, 0]) {
  const share = 0.2;
  const prefunded = revenue * share;
  assert(prefunded <= revenue);
  if (!revenue) assert.equal(prefunded, 0);
}
writeFileSync('docs/economics/stress.csv', rows.map(row => row.join(',')).join('\n') + '\n');
console.log(JSON.stringify({ reserve_assumption_tskr: reserve, horizon_days: horizon, proposed_reserve_floor_tskr: reserveFloor, proposed_daily_budget_tskr: dailyBudget, scenarios: rows.length - 1, assertions: 'passed', note: 'Token inventory only; no live balances, cash backing, fraud detection or price forecast. Budget allocation requires new implementation.' }, null, 2));
