#!/usr/bin/env bash
# PG-SEASON-06 年度營運工具：節日活動設定的驗證與線上對帳。
#
# 每年加下一屆的流程：改 backend/seasonal/campaigns.json → 跑這支確認換算回活動時區的
# 日期真的是要紀念的那幾天 → 部署 → 跑 --remote 確認線上服務出來的屆次與 repo 一致。
#
#   scripts/ops/seasonal.sh                          # 驗證設定並印出所有屆次
#   scripts/ops/seasonal.sh --now 2027-03-16T06:00:00Z
#   scripts/ops/seasonal.sh --remote                 # 再跟線上 /v1/seasonal 對帳
#
# 不需要 OPS_TOKEN（/v1/seasonal 是公開目錄），也不連資料庫。
set -euo pipefail
cd "$(dirname "$0")/../.."
# shellcheck disable=SC1091
. scripts/env.sh >/dev/null 2>&1 || true
API="${API:-http://l2.neonshift.cc:6080}"

REMOTE=0
ARGS=()
for a in "$@"; do
  if [ "$a" = "--remote" ]; then REMOTE=1; else ARGS+=("$a"); fi
done

(cd backend && npm run -s seasonal:check -- ${ARGS[@]+"${ARGS[@]}"})

[ "$REMOTE" = "1" ] || exit 0

echo
echo "== 線上對帳（$API/v1/seasonal）=="
LOCAL_JSON="$(cd backend && npm run -s seasonal:check -- --json ${ARGS[@]+"${ARGS[@]}"})"
REMOTE_JSON="$(curl -fsS -m 20 "$API/v1/seasonal")"
LOCAL_JSON="$LOCAL_JSON" REMOTE_JSON="$REMOTE_JSON" node -e '
const local = JSON.parse(process.env.LOCAL_JSON);
const remote = JSON.parse(process.env.REMOTE_JSON);
// 線上目錄只列已啟用的屆次，所以拿 enabled 的那些來比
const wanted = local.campaigns.filter((c) => c.enabled);
const got = remote.items ?? [];
const ids = (xs) => xs.map((x) => x.campaign_id).sort();
let bad = 0;
const fail = (m) => { console.error("不一致：" + m); bad++; };
if (ids(wanted).join(",") !== ids(got).join(",")) fail(`已啟用屆次 repo=[${ids(wanted)}] 線上=[${ids(got)}]`);
for (const w of wanted) {
  const g = got.find((x) => x.campaign_id === w.campaign_id);
  if (!g) continue;
  if (g.window.starts_at !== w.starts_at || g.window.ends_at !== w.ends_at) fail(`${w.campaign_id} 窗口 repo=${w.starts_at}…${w.ends_at} 線上=${g.window.starts_at}…${g.window.ends_at}`);
  if (g.window.display_timezone !== w.display_timezone) fail(`${w.campaign_id} 時區 repo=${w.display_timezone} 線上=${g.window.display_timezone}`);
  if (g.rules.min_moving_minutes !== w.min_moving_minutes) fail(`${w.campaign_id} 門檻 repo=${w.min_moving_minutes} 線上=${g.rules.min_moving_minutes}`);
  if (g.rules.grace_days !== w.grace_days) fail(`${w.campaign_id} 寬限 repo=${w.grace_days} 線上=${g.rules.grace_days}`);
  if (g.source.checked_on !== w.source_checked_on) fail(`${w.campaign_id} 來源核對日 repo=${w.source_checked_on} 線上=${g.source.checked_on}`);
  // 尚未開放鑄造：線上如果自己變成 true，那是不該發生的事
  if (g.mint_enabled !== false) fail(`${w.campaign_id} 線上 mint_enabled=${g.mint_enabled}（PG-SEASON-04 尚未完成）`);
}
if (bad) { console.error(`\n${bad} 項不一致：線上跑的設定與 repo 不同，先確認部署的是哪一版`); process.exit(1); }
console.log(`線上 ${got.length} 屆與 repo 的已啟用屆次一致，mint_enabled 全為 false`);
'
