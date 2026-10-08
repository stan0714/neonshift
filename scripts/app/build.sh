#!/usr/bin/env bash
# PG-I-07：以指定環境建置 Android APK。
#   scripts/app/build.sh dev debug        # 開發用 debug APK（arm64，可裝 Seeker）
#   scripts/app/build.sh demo release     # 已簽名 release APK（需先完成 Runbook 8.1 keystore）
#   APP_ARCHS=arm64-v8a APP_API_URL_OVERRIDE=$NEONSHIFT_L1_API/v1 scripts/app/build.sh dev release   # Seeker 實機測試包（單 ABI、直連 dev 後端）
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
    [ -f android/keystore.properties ] || { echo "缺少 android/keystore.properties（Runbook 8.1／8.2）；release 不得以 debug 金鑰簽章" >&2; exit 2; }
    # 參賽計畫 P0（docs/store/competition-development-plan.md）：提交版本（demo 環境）不得帶展示覆寫或開發捷徑；dev 環境仍允許負責人 Seeker 展示包
    if [ "$ENV_NAME" = demo ]; then
      [ "${EXPO_PUBLIC_DEMO_LEVEL:-0}" = 0 ] || { echo "demo（提交）環境不得設定 EXPO_PUBLIC_DEMO_LEVEL=${EXPO_PUBLIC_DEMO_LEVEL}（展示覆寫僅限 dev 測試包）" >&2; exit 4; }
      [ -z "${EXPO_PUBLIC_DEV_ROUTE:-}" ] || { echo "demo（提交）環境不得設定 EXPO_PUBLIC_DEV_ROUTE" >&2; exit 4; }
      case "$EXPO_PUBLIC_API_URL" in https://*) ;; *) echo "demo（提交）環境後端必須是 https://（目前 $EXPO_PUBLIC_API_URL）" >&2; exit 4 ;; esac
    fi
    # 後端只有 http://（dev 直連 l1:6080）時才開啟明文流量；https 一律關（Runbook 8.5）
    CLEARTEXT=false; case "$EXPO_PUBLIC_API_URL" in http://*) CLEARTEXT=true ;; esac
    # EXPO_PUBLIC_* 不是 Gradle 的 task input：換環境變數（如 EXPO_PUBLIC_DEMO_LEVEL）不會觸發重新打包 JS，故每次 release 先清掉上次的 bundle
    rm -rf android/app/build/generated/assets/react android/app/build/generated/res/createBundleReleaseJsAndAssets android/app/build/generated/sourcemaps
    (cd android && ./gradlew :app:assembleRelease -q -PcleartextTraffic="$CLEARTEXT" -PreactNativeArchitectures="${APP_ARCHS:-armeabi-v7a,arm64-v8a,x86,x86_64}")
    OUT="android/app/build/outputs/apk/release/app-release.apk"
    # 8.4：驗證簽章不是 debug 金鑰
    APKSIGNER="$(command -v apksigner || ls "${ANDROID_HOME:-$HOME/Library/Android/sdk}"/build-tools/*/apksigner 2>/dev/null | sort -V | tail -1)"
    if [ -n "$APKSIGNER" ]; then
      "$APKSIGNER" verify --print-certs "$OUT" | grep -q "androiddebugkey" && { echo "release APK 仍為 debug 簽章" >&2; exit 3; }
      "$APKSIGNER" verify --print-certs "$OUT" | grep -E "Signer #1 certificate (DN|SHA-256)" || true
    else
      echo "警告：找不到 apksigner，未驗證簽章" >&2
    fi ;;
  *) echo "未知 variant $VARIANT" >&2; exit 2 ;;
esac
echo "APK: app/$OUT"
{
  echo "env: $ENV_NAME ($VARIANT)"
  echo "版本: $(grep -m1 versionName android/app/build.gradle | tr -d ' ') / $(grep -m1 versionCode android/app/build.gradle | tr -d ' ')"
  echo "Git: $(git -C "$ROOT" rev-parse --short HEAD)$(git -C "$ROOT" diff --quiet HEAD -- . ':!output' ':!docs' 2>/dev/null || echo ' (dirty)')"
  echo "建置時間: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "SHA-256: $(shasum -a 256 "$OUT" | cut -d' ' -f1)"
  echo "ABI: ${APP_ARCHS:-armeabi-v7a,arm64-v8a,x86,x86_64}"
  echo "展示覆寫 demoLevel: ${EXPO_PUBLIC_DEMO_LEVEL:-0}$( [ "${EXPO_PUBLIC_DEMO_LEVEL:-0}" != 0 ] && echo '（DEMO DATA 展示包，不得提交／散布）' )"
  echo "Program Id: ${EXPO_PUBLIC_PROGRAM_ID:-<unset>}"
  echo "tSKR Mint: ${EXPO_PUBLIC_TSKR_MINT:-<unset>}"
  echo "後端: $EXPO_PUBLIC_API_URL"
  echo "網路: $EXPO_PUBLIC_CLUSTER"
  if [ "${CLEARTEXT:-}" = true ]; then echo "注意: 已允許明文 HTTP（僅供 dev 直連後端），不得對外散布"; fi
} | tee "android/app/build/outputs/apk/$VARIANT/release-notes.txt"
