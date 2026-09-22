#!/usr/bin/env bash
# XD-07 量測：任務漏斗與玩家概況（只有計數，無錢包）。OPS_TOKEN 由 ssh 於執行時讀取，不落地。
#   scripts/ops/funnel.sh                       # 近 30 天（cohort＝30 天前起 7 天內首見）
#   scripts/ops/funnel.sh 2026-09-15T00:00:00Z  # 指定 since
set -euo pipefail
HOST="${OPS_HOST:-root@l2.neonshift.cc}"; API="${API:-http://l2.neonshift.cc:6080}"
SINCE="${1:-}"
TOKEN="$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" "grep '^OPS_TOKEN=' /etc/neonshift/api.env | cut -d= -f2-")"
[ -n "$TOKEN" ] || { echo "取不到 OPS_TOKEN" >&2; exit 1; }
curl -fsS -m 30 -H "Authorization: Bearer $TOKEN" "$API/v1/ops/metrics/funnel${SINCE:+?since=$SINCE}" | node -e '
const b = JSON.parse(require("fs").readFileSync(0, "utf8"));
console.log(`區間 ${b.since.slice(0,10)} → ${b.until.slice(0,10)}（as of ${b.as_of}）`);
console.log(`玩家 ${b.players.players} · 7 天新增 ${b.players.new7d} · 7 天活躍 ${b.players.active7d} · cohort ${b.players.cohort.size}（D7 ${b.players.cohort.retainedD7}／D30 ${b.players.cohort.retainedD30}，觀察值）`);
console.log("任務漏斗（接受 → 開始 → 合格完成 → 領取；撤銷／過期）");
for (const r of b.quest_funnel) console.log(`  ${r.template_id.padEnd(12)} ${r.accepted} → ${r.started} (${pct(r.rates.start)}) → ${r.completed} (${pct(r.rates.complete)}) → ${r.claimed} (${pct(r.rates.claim)})   revoked ${r.revoked} · expired ${r.expired}`);
if (!b.quest_funnel.length) console.log("  （區間內沒有任務接受）");
console.log("註：" + b.notes.join("；"));
function pct(x) { return x === null ? "—" : Math.round(x * 100) + "%"; }
'
