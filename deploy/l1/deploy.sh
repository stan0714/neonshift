#!/usr/bin/env bash
# 從開發機部署後端到 API 主機（預設 l1；DEPLOY_HOST=$NEONSHIFT_L2_SSH 部署 l2）：rsync → npm ci → migration → 重啟 signer／api → /healthz。
#   deploy/l1/deploy.sh            # 部署
#   deploy/l1/deploy.sh bootstrap  # 第一次：先跑 bootstrap.sh（安裝 Node／PG 或外部 DB、建帳號與環境檔）
#   NEONSHIFT_DATABASE_URL=<url> DEPLOY_HOST=$NEONSHIFT_L2_SSH deploy/l1/deploy.sh bootstrap   # 共用外部 DB 的第二台
# attestor 私鑰：~/.config/neonshift/dev/attestor.json → /etc/neonshift/keys/attestor.json（只在遠端不存在時複製）。
set -euo pipefail
[ -f "$HOME/.config/neonshift/hosts.env" ] && . "$HOME/.config/neonshift/hosts.env"  # 主機位址只放本機（見 deploy/README.md）
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOST="${DEPLOY_HOST:-${NEONSHIFT_L1_SSH:?在 ~/.config/neonshift/hosts.env 設定 NEONSHIFT_L1_SSH}}"
SSH="ssh -o BatchMode=yes -o ConnectTimeout=10 $HOST"
ATTESTOR="${ATTESTOR_KEYPAIR:-$HOME/.config/neonshift/dev/attestor.json}"

echo "→ 同步程式碼到 $HOST:/opt/neonshift"
$SSH 'mkdir -p /opt/neonshift; command -v rsync >/dev/null || (apt-get update -qq && apt-get install -y -qq rsync >/dev/null)'
rsync -az --delete \
  --exclude node_modules --exclude '.env' --exclude '.env.*' --exclude 'target' \
  "$ROOT/backend" "$ROOT/deploy" "$HOST:/opt/neonshift/"

if [ "${1:-}" = "bootstrap" ]; then
  echo "→ bootstrap"
  $SSH "NEONSHIFT_DATABASE_URL='${NEONSHIFT_DATABASE_URL:-}' bash /opt/neonshift/deploy/l1/bootstrap.sh"
fi

if [ -f "$ATTESTOR" ]; then
  if ! $SSH 'test -f /etc/neonshift/keys/attestor.json'; then
    echo "→ 放置 attestor 私鑰（signer 專用帳號可讀）"
    scp -q "$ATTESTOR" "$HOST:/etc/neonshift/keys/attestor.json"
    $SSH 'chown root:neonshift-signer /etc/neonshift/keys/attestor.json && chmod 640 /etc/neonshift/keys/attestor.json'
  fi
else
  echo "！找不到 $ATTESTOR，略過金鑰放置（signer 需要它才會啟動）"
fi

echo "→ npm ci、migration、重啟"
$SSH bash -s <<'REMOTE'
set -euo pipefail
chown -R neonshift:neonshift /opt/neonshift
cd /opt/neonshift/backend
runuser -u neonshift -- npm ci --no-audit --no-fund --loglevel=error
DB_URL=$(grep '^DATABASE_URL=' /etc/neonshift/api.env | cut -d= -f2-)
# migration 只套用一次（0001～0003 非冪等）：以 schema_migrations 記錄檔名
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -c "CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
for f in migrations/[0-9]*.sql; do
  name=$(basename "$f")
  if [ "$(psql "$DB_URL" -tAc "SELECT 1 FROM schema_migrations WHERE filename='$name'")" = "1" ]; then continue; fi
  { echo "BEGIN;"; cat "$f"; echo "INSERT INTO schema_migrations(filename) VALUES ('$name');"; echo "COMMIT;"; } \
    | psql "$DB_URL" -v ON_ERROR_STOP=1 -q >/dev/null || { echo "migration 失敗：$f"; exit 1; }
  echo "  套用 $name"
done
systemctl restart neonshift-signer
sleep 1
systemctl restart neonshift-api
for i in $(seq 1 20); do curl -fsS http://127.0.0.1:6080/healthz >/dev/null 2>&1 && break; sleep 1; done
systemctl --no-pager --lines=0 status neonshift-signer neonshift-api | grep -E 'neonshift-|Active'
curl -fsS http://127.0.0.1:6080/healthz; echo
curl -fsS http://127.0.0.1:6080/readyz; echo
REMOTE
echo "→ 完成。外部：https://api.neonshift.cc/healthz（nginx 於另一台主機）"
