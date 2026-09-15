#!/usr/bin/env bash
# 在 l1 的 PostgreSQL 上跑 backend PostgresStore 整合測試（本機 Docker 不可用時的替代）。
# 會（重）建 neonshift_test 資料庫、套用 migrations 與約束測試，然後經 SSH tunnel 執行 vitest。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${DEPLOY_HOST:-root@l1.neonshift.cc}"
LOCAL_PORT="${LOCAL_PORT:-15432}"
SSH="ssh -o BatchMode=yes -o ConnectTimeout=10 $HOST"

# migrations 以本機工作樹為準（不用 /opt/neonshift/backend 已部署的舊版），rsync 到獨立目錄再套用
echo "→ 同步本機 migrations → $HOST:/opt/neonshift/test-migrations"
rsync -a --delete -e "ssh -o BatchMode=yes" "$ROOT/backend/migrations/" "$HOST:/opt/neonshift/test-migrations/"

echo "→ 重建 neonshift_test 並套用 migrations（$HOST）"
$SSH bash -s <<'REMOTE'
set -euo pipefail
runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_database WHERE datname='neonshift_test'" | grep -q 1 && runuser -u postgres -- dropdb neonshift_test
runuser -u postgres -- createdb -O neonshift neonshift_test
PW=$(cat /etc/neonshift/.dbpass)
URL="postgres://neonshift:$PW@127.0.0.1:5432/neonshift_test"
cd /opt/neonshift/test-migrations
for f in [0-9]*.sql; do psql "$URL" -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null 2>&1 || { echo "migration 失敗：$f"; exit 1; }; done
out=$(psql "$URL" -v ON_ERROR_STOP=1 -q -f test_constraints.sql 2>&1)
echo "  約束測試 PASS $(echo "$out" | grep -c PASS) 項$(echo "$out" | grep -q FAIL && echo '，有 FAIL！')"
REMOTE
PW=$($SSH 'cat /etc/neonshift/.dbpass')

echo "→ SSH tunnel 127.0.0.1:$LOCAL_PORT → l1:5432"
ssh -o BatchMode=yes -f -N -L "$LOCAL_PORT:127.0.0.1:5432" "$HOST"
trap 'pkill -f "$LOCAL_PORT:127.0.0.1:5432" >/dev/null 2>&1 || true' EXIT
cd "$ROOT/backend"
TEST_DATABASE_URL="postgres://neonshift:$PW@127.0.0.1:$LOCAL_PORT/neonshift_test" npx vitest run "$@"
