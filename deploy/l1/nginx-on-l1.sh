#!/usr/bin/env bash
# 在 l1 本機安裝 nginx 反代 https://api.neonshift.cc → 127.0.0.1:6080（deploy/l1/nginx-api.neonshift.cc.conf 的「同機」版本）。
#   ssh root@l1.neonshift.cc 'bash -s' < deploy/l1/nginx-on-l1.sh
# TLS：Cloudflare 代理（橘雲）到源站；源站用自簽憑證（SSL 模式 Full 可接受；Full (strict) 需改用 Cloudflare Origin CA 憑證放到同路徑）。
# 同時開 :80（Cloudflare Flexible 模式或 certbot HTTP-01 時可用）。Cloudflare 端需：DNS A api → 104.105.136.214（橘雲）。
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
command -v nginx >/dev/null || (apt-get update -qq && apt-get install -y -qq nginx openssl >/dev/null)
mkdir -p /etc/nginx/certs
if [ ! -f /etc/nginx/certs/api.neonshift.cc.crt ]; then
  openssl req -x509 -nodes -newkey rsa:2048 -days 3650 -subj "/CN=api.neonshift.cc" \
    -keyout /etc/nginx/certs/api.neonshift.cc.key -out /etc/nginx/certs/api.neonshift.cc.crt >/dev/null 2>&1
  chmod 600 /etc/nginx/certs/api.neonshift.cc.key
fi
cat > /etc/nginx/sites-available/api.neonshift.cc <<'CONF'
upstream neonshift_api {
    server 127.0.0.1:6080 max_fails=3 fail_timeout=10s;
    keepalive 16;
}
map $http_cf_connecting_ip $client_ip { default $remote_addr; ~. $http_cf_connecting_ip; }

server {
    listen 80;
    listen 443 ssl;
    http2 on;
    server_name api.neonshift.cc;

    ssl_certificate     /etc/nginx/certs/api.neonshift.cc.crt;
    ssl_certificate_key /etc/nginx/certs/api.neonshift.cc.key;

    client_max_body_size 64k;

    location = /healthz {
        proxy_pass http://neonshift_api/healthz;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        access_log off;
    }

    location / {
        proxy_pass http://neonshift_api;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $client_ip;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 30s;
    }
}
CONF
ln -sf /etc/nginx/sites-available/api.neonshift.cc /etc/nginx/sites-enabled/api.neonshift.cc
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx >/dev/null
systemctl reload nginx
echo "local http:  $(curl -s -m3 -o /dev/null -w '%{http_code}' -H 'Host: api.neonshift.cc' http://127.0.0.1/healthz)"
echo "local https: $(curl -sk -m3 -o /dev/null -w '%{http_code}' -H 'Host: api.neonshift.cc' https://127.0.0.1/healthz)"
