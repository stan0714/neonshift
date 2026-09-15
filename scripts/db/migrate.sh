#!/usr/bin/env bash
# 對指定資料庫套用 backend/migrations（與 deploy/l1/deploy.sh 同邏輯：schema_migrations 記錄檔名、每檔一個交易、只套一次）。
# 用法：scripts/db/migrate.sh [env 檔，預設 ~/.config/neonshift/db.env]   # 檔內 DATABASE_URL=postgres://user:pass@host:port/db
#       DATABASE_URL=... scripts/db/migrate.sh                            # 或直接以環境變數
# 需要本機 psql；不會建立資料庫／角色（先以 postgres 建好：CREATE ROLE … LOGIN；CREATE DATABASE … OWNER …）。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${1:-$HOME/.config/neonshift/db.env}"
if [ -z "${DATABASE_URL:-}" ]; then
  [ -f "$ENV_FILE" ] || { echo "找不到 $ENV_FILE，請建立並填入 DATABASE_URL" >&2; exit 2; }
  DATABASE_URL=$(grep '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' | tr -d "'")
fi
[ -n "$DATABASE_URL" ] || { echo "DATABASE_URL 為空（$ENV_FILE）" >&2; exit 2; }
command -v psql >/dev/null || { echo "需要 psql（brew install libpq && brew link --force libpq）" >&2; exit 2; }
SAFE_URL=$(printf '%s' "$DATABASE_URL" | sed -E 's#(://[^:]+:)[^@]*@#\1***@#')
echo "→ 目標：$SAFE_URL"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tAc "SELECT current_database() || ' as ' || current_user || ' · ' || version()" | sed 's/^/  /'
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
cd "$ROOT/backend"
applied=0
for f in migrations/[0-9]*.sql; do
  name=$(basename "$f")
  if [ "$(psql "$DATABASE_URL" -tAc "SELECT 1 FROM schema_migrations WHERE filename='$name'")" = "1" ]; then echo "  略過（已套用）$name"; continue; fi
  { echo "BEGIN;"; cat "$f"; echo "INSERT INTO schema_migrations(filename) VALUES ('$name');"; echo "COMMIT;"; } \
    | psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q >/dev/null || { echo "migration 失敗：$f" >&2; exit 1; }
  echo "  套用 $name"; applied=$((applied + 1))
done
echo "→ 完成：新套用 $applied 個；資料表："
psql "$DATABASE_URL" -tAc "SELECT string_agg(tablename, ', ' ORDER BY tablename) FROM pg_tables WHERE schemaname='public'" | fold -s -w 110 | sed 's/^/  /'
