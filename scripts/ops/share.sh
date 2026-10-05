#!/usr/bin/env bash
# PG-SHARE-05：分享落地頁彙總（只有計數，沒有錢包、IP 或 referrer）。OPS_TOKEN 由 ssh 於執行時讀取，不落地。
#   scripts/ops/share.sh                       # 近 30 天
#   scripts/ops/share.sh 2026-09-25            # 指定 since
#   scripts/ops/share.sh 2026-09-25 csv        # 匯出 CSV
set -euo pipefail
[ -f "$HOME/.config/neonshift/hosts.env" ] && . "$HOME/.config/neonshift/hosts.env"  # 主機位址只放本機（見 deploy/README.md）
HOST="${OPS_HOST:-${NEONSHIFT_L2_SSH:?在 ~/.config/neonshift/hosts.env 設定 NEONSHIFT_L2_SSH}}"; API="${API:-${NEONSHIFT_L2_API:?在 ~/.config/neonshift/hosts.env 設定 NEONSHIFT_L2_API}}"
SINCE="${1:-}"; FMT="${2:-json}"
TOKEN="$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" "grep '^OPS_TOKEN=' /etc/neonshift/api.env | cut -d= -f2-")"
[ -n "$TOKEN" ] || { echo "取不到 OPS_TOKEN" >&2; exit 1; }
URL="$API/v1/ops/metrics/share?format=$FMT${SINCE:+&since=$SINCE}"
if [ "$FMT" = "csv" ]; then
  curl -fsS -m 30 -H "Authorization: Bearer $TOKEN" "$URL"
  exit 0
fi
curl -fsS -m 30 -H "Authorization: Bearer $TOKEN" "$URL" | node -e '
const b = JSON.parse(require("fs").readFileSync(0, "utf8"));
const EVENTS = ["landing_view", "store_click", "app_open", "connect_complete"];
console.log(`區間 ${b.since} → ${b.until}（as of ${b.as_of}）`);
const table = (title, obj) => {
  console.log(title);
  const keys = Object.keys(obj).sort();
  if (!keys.length) return console.log("  （區間內沒有事件）");
  console.log("  " + "".padEnd(14) + EVENTS.map((e) => e.padStart(16)).join(""));
  for (const k of keys) console.log("  " + k.padEnd(14) + EVENTS.map((e) => String(obj[k][e] ?? 0).padStart(16)).join(""));
};
table("依分享類型", b.by_kind);
table("依來源", b.by_source);
console.log("註：" + b.notes.join("；"));
'
