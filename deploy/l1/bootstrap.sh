#!/usr/bin/env bash
# 在 l1（Debian／Ubuntu，root）執行一次：Node 24、PostgreSQL、系統帳號、目錄、環境檔與隨機 secret。
# 可重複執行；已存在的 secret 不會被覆寫。attestor 私鑰由 deploy.sh 另行放到 /etc/neonshift/keys/attestor.json。
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" != "24" ]; then
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg rsync >/dev/null
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
if ! command -v psql >/dev/null; then
  apt-get update -qq
  apt-get install -y -qq postgresql postgresql-contrib rsync >/dev/null
fi
systemctl enable --now postgresql >/dev/null

for u in neonshift neonshift-signer; do
  id "$u" >/dev/null 2>&1 || useradd --system --home /opt/neonshift --shell /usr/sbin/nologin "$u"
done
mkdir -p /opt/neonshift /etc/neonshift/keys
chown neonshift:neonshift /opt/neonshift
chmod 755 /etc/neonshift   # 檔案各自 0640 限制群組；目錄需可穿越
chown root:neonshift-signer /etc/neonshift/keys
chmod 750 /etc/neonshift/keys

# DB：帳號／資料庫（密碼寫入 api.env）
DB_PASS_FILE=/etc/neonshift/.dbpass
if [ ! -f "$DB_PASS_FILE" ]; then
  openssl rand -hex 24 > "$DB_PASS_FILE"; chmod 600 "$DB_PASS_FILE"
fi
DB_PASS=$(cat "$DB_PASS_FILE")
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -tAc "SELECT 1 FROM pg_roles WHERE rolname='neonshift'" | grep -q 1 \
  || runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c "CREATE ROLE neonshift LOGIN PASSWORD '$DB_PASS'"
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c "ALTER ROLE neonshift PASSWORD '$DB_PASS'" >/dev/null
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -tAc "SELECT 1 FROM pg_database WHERE datname='neonshift'" | grep -q 1 \
  || runuser -u postgres -- createdb -O neonshift neonshift

# 環境檔：第一次由 example 產生並填入隨機 secret；之後只更新 DB 密碼
if [ ! -f /etc/neonshift/api.env ]; then
  cp /opt/neonshift/deploy/l1/api.env.example /etc/neonshift/api.env
  SIGNER_TOKEN=$(openssl rand -hex 32)
  sed -i \
    -e "s#^JWT_SECRET=.*#JWT_SECRET=$(openssl rand -hex 32)#" \
    -e "s#^SIGNER_TOKEN=.*#SIGNER_TOKEN=$SIGNER_TOKEN#" \
    -e "s#^METRICS_TOKEN=.*#METRICS_TOKEN=$(openssl rand -hex 16)#" \
    -e "s#^OPS_TOKEN=.*#OPS_TOKEN=$(openssl rand -hex 16)#" \
    /etc/neonshift/api.env
  cp /opt/neonshift/deploy/l1/signer.env.example /etc/neonshift/signer.env
  sed -i -e "s#^SIGNER_TOKEN=.*#SIGNER_TOKEN=$SIGNER_TOKEN#" /etc/neonshift/signer.env
fi
sed -i -e "s#^DATABASE_URL=.*#DATABASE_URL=postgres://neonshift:$DB_PASS@127.0.0.1:5432/neonshift#" /etc/neonshift/api.env
chown root:neonshift /etc/neonshift/api.env; chmod 640 /etc/neonshift/api.env
chown root:neonshift-signer /etc/neonshift/signer.env; chmod 640 /etc/neonshift/signer.env

cp /opt/neonshift/deploy/l1/neonshift-api.service /etc/systemd/system/
cp /opt/neonshift/deploy/l1/neonshift-signer.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable neonshift-signer neonshift-api >/dev/null
echo "bootstrap 完成：node $(node -v)，psql $(psql --version | awk '{print $3}')"
