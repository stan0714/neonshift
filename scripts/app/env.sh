#!/usr/bin/env bash
# PG-I-07：把 deploy/<env>.env 轉成 App build-time 參數（EXPO_PUBLIC_*），成組注入。
#   source scripts/app/env.sh dev   → 匯出 EXPO_PUBLIC_*，之後 npx expo start / gradle 皆會帶入
# 只匯出公開資訊；不含任何金鑰。
_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
_ENV="${1:-}"
if [ -z "$_ENV" ] || [ ! -f "$_ROOT/deploy/$_ENV.env" ]; then
  echo "用法：source scripts/app/env.sh <dev|demo|local>" >&2
  return 2 2>/dev/null || exit 2
fi
set -a
# shellcheck disable=SC1090
source "$_ROOT/deploy/$_ENV.env"
set +a
export EXPO_PUBLIC_APP_ENV="$ENV_NAME"
export EXPO_PUBLIC_CLUSTER="$CLUSTER"
export EXPO_PUBLIC_CLUSTER_ID="$CLUSTER_ID"
export EXPO_PUBLIC_RPC_URL="$RPC_URL"
export EXPO_PUBLIC_PROGRAM_ID="$PROGRAM_ID"
export EXPO_PUBLIC_TSKR_MINT="$TSKR_MINT"
export EXPO_PUBLIC_API_URL="${APP_API_URL_OVERRIDE:-$API_URL}"
if [ -z "$PROGRAM_ID" ] || [ -z "$TSKR_MINT" ]; then
  echo "警告：deploy/$_ENV.env 的 PROGRAM_ID／TSKR_MINT 尚未回填；App 會以「本版未啟用鏈上功能」啟動" >&2
fi
echo "EXPO_PUBLIC_APP_ENV=$EXPO_PUBLIC_APP_ENV PROGRAM_ID=${EXPO_PUBLIC_PROGRAM_ID:-<unset>} API_URL=$EXPO_PUBLIC_API_URL"
