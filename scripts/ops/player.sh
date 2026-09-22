#!/usr/bin/env bash
# 真機驗收／評審支援：印出某錢包的診斷摘要（運動為何不算 PB／首次、成就狀態、SKR 訂單）。
#   scripts/ops/player.sh <wallet>            # 走 l2 直連（http://l2.neonshift.cc:6080；l1 對外路徑 2026-09-22 起有封包遺失）
#   OPS_HOST=root@l2.neonshift.cc API=http://l2.neonshift.cc:6080 scripts/ops/player.sh <wallet>
#   scripts/ops/player.sh <wallet> --json     # 原始 JSON
# OPS_TOKEN 由 ssh 於執行時從 /etc/neonshift/api.env 讀取，不落地、不進 repo。
set -euo pipefail
WALLET="${1:-}"; [ -n "$WALLET" ] || { echo "用法：$0 <wallet> [--json]" >&2; exit 2; }
HOST="${OPS_HOST:-root@l2.neonshift.cc}"
API="${API:-http://l2.neonshift.cc:6080}"
TOKEN="$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" "grep '^OPS_TOKEN=' /etc/neonshift/api.env | cut -d= -f2-")"
[ -n "$TOKEN" ] || { echo "取不到 OPS_TOKEN（$HOST:/etc/neonshift/api.env）" >&2; exit 1; }
JSON="$(curl -fsS -m 30 -H "Authorization: Bearer $TOKEN" "$API/v1/ops/players/$WALLET")"
unset TOKEN
if [ "${2:-}" = "--json" ]; then echo "$JSON"; exit 0; fi
node -e '
const b = JSON.parse(require("fs").readFileSync(0, "utf8"));
const km = (mm) => mm == null ? "-" : (Number(mm) / 1e6).toFixed(2) + " km";
const min = (ms) => { const s = Math.round(Number(ms) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
console.log(`錢包 ${b.wallet}  （as of ${b.as_of}）`);
console.log(`玩家：${b.player ? `first_seen ${b.player.first_seen_at} · last_seen ${b.player.last_seen_at}` : "（無紀錄）"}`);
console.log(`等級歷史：${b.level_history.map((h) => `day${h.effective_from_date}→Lv${h.active_level}(${h.source})`).join(", ") || "（無）"}`);
console.log(`\n運動（${b.workouts.length}）`);
for (const w of b.workouts) console.log(`  ${w.started_at.slice(0, 16)} ${w.sport.padEnd(4)} ${w.origin.padEnd(14)} ${km(w.distance_mm).padStart(9)} ${min(w.elapsed_ms).padStart(6)}  ${w.status}/${w.quality}  pb_eligible=${w.pb_eligible}${w.review_reasons.length ? "  reasons=" + w.review_reasons.join(",") : ""}${w.possible_duplicate_of ? "  dup_of=" + w.possible_duplicate_of : ""}${w.deleted_at ? "  DELETED" : ""}`);
console.log(`\n個人最佳（current）`);
for (const p of b.personal_bests) console.log(`  ${p.category.padEnd(12)} ${p.environment}/${p.verification_class}  ${p.category === "longest_run" ? km(p.value) : min(p.value)}  ${p.achieved_at.slice(0, 10)}${p.is_baseline ? "  baseline" : ""}`);
console.log(`\n里程碑`);
for (const m of b.milestones) if (m.status !== "locked") console.log(`  ${m.key.padEnd(30)} ${m.status}${m.first ? "  first=" + m.first.source.id.slice(0, 8) + " @" + (m.first.achieved_at || "").slice(0, 10) : ""}${m.pending ? "  pending=" + m.pending.source.id.slice(0, 8) + " (" + m.pending.reason + ")" : ""}`);
console.log(`\n成就（${b.achievements.length}）`);
for (const a of b.achievements) console.log(`  ${a.achievement_id.slice(0, 12)} ${a.kind.padEnd(10)} ${(a.milestone_key || a.category || "").padEnd(28)} ${a.status}${a.asset ? "  asset=" + a.asset : ""}`);
console.log(`\nSKR 訂單（${b.skr.orders.length}）／權限（${b.skr.entitlements.length}）`);
for (const o of b.skr.orders) console.log(`  ${o.order_id.slice(0, 8)} ${o.sku} ${o.network} ${o.status}${o.failure_reason ? " (" + o.failure_reason + ")" : ""}${o.signature ? " sig=" + o.signature.slice(0, 12) + "…" : ""}`);
for (const e of b.skr.entitlements) console.log(`  entitlement ${e.cosmetic_id} ${e.status} (order ${e.order_id.slice(0, 8)})`);
' <<<"$JSON"
