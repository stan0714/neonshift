#!/usr/bin/env bash
# PG-I-07：以指定環境建置 Android APK。
#   scripts/app/build.sh dev debug        # 開發用 debug APK（arm64，可裝 Seeker）
#   scripts/app/build.sh demo release     # 已簽名 release APK（需先完成 Runbook 8.1 keystore）
# 環境參數（EXPO_PUBLIC_*）在建置時由 scripts/app/env.sh 注入並被 Metro 內嵌，不可事後改動（SD 8）。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_NAME="${1:-}"; VARIANT="${2:-debug}"
[ -n "$ENV_NAME" ] || { echo "用法：$0 <dev|demo|local> [debug|release]" >&2; exit 2; }
# shellcheck disable=SC1091
source "$ROOT/scripts/env.sh"
# shellcheck disable=SC1091
source "$ROOT/scripts/app/env.sh" "$ENV_NAME"
cd "$ROOT/app"
[ -d node_modules ] || npm ci
case "$VARIANT" in
  debug)
    (cd android && ./gradlew :app:assembleDebug -q -PreactNativeArchitectures=arm64-v8a)
    OUT="android/app/build/outputs/apk/debug/app-debug.apk" ;;
  release)
    [ -f android/app/neonshift-release.keystore ] || [ -f android/keystore.properties ] || { echo "缺少 release keystore（Runbook 8.1）" >&2; exit 2; }
    (cd android && ./gradlew :app:assembleRelease -q)
    OUT="android/app/build/outputs/apk/release/app-release.apk" ;;
  *) echo "未知 variant $VARIANT" >&2; exit 2 ;;
esac
echo "APK: app/$OUT"
{
  echo "env: $ENV_NAME ($VARIANT)"
  echo "版本: $(grep -m1 versionName android/app/build.gradle | tr -d ' ')"
  echo "Git: $(git -C "$ROOT" rev-parse --short HEAD)"
  echo "Program Id: ${EXPO_PUBLIC_PROGRAM_ID:-<unset>}"
  echo "tSKR Mint: ${EXPO_PUBLIC_TSKR_MINT:-<unset>}"
  echo "後端: $EXPO_PUBLIC_API_URL"
  echo "網路: $EXPO_PUBLIC_CLUSTER"
} | tee "android/app/build/outputs/apk/$VARIANT/release-notes.txt"
