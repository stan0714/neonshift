#!/usr/bin/env bash
# 開發：以指定環境參數啟動 Metro（dev client）。debug APK 內嵌的 EXPO_PUBLIC_* 由 Metro 端決定。
#   scripts/app/start.sh dev            # API 用 deploy/dev.env 的 API_URL
#   APP_API_URL_OVERRIDE=http://localhost:3000/v1 scripts/app/start.sh dev   # Seeker 走 adb reverse 連本機後端
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/scripts/env.sh"
# shellcheck disable=SC1091
source "$ROOT/scripts/app/env.sh" "${1:-local}"
cd "$ROOT/app"
if command -v adb >/dev/null; then
  adb reverse tcp:8081 tcp:8081 >/dev/null 2>&1 || true
  adb reverse tcp:3000 tcp:3000 >/dev/null 2>&1 || true
fi
exec npx expo start --dev-client --clear "${@:2}"
