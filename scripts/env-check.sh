#!/usr/bin/env bash
# 檢查開發工具鏈版本是否符合 SD 2.2 與 Runbook 1.4。
# 用法：source scripts/env.sh && scripts/env-check.sh
set -u
fail=0
ok()   { printf '  \033[32m✔\033[0m %-12s %s\n' "$1" "$2"; }
bad()  { printf '  \033[31m✘\033[0m %-12s %s\n' "$1" "$2"; fail=1; }
warn() { printf '  \033[33m!\033[0m %-12s %s\n' "$1" "$2"; }

echo "NeonShift 環境檢查（$(uname -m)）"

v=$(node -v 2>/dev/null || echo none)
case "$v" in v24.*) ok node "$v" ;; *) bad node "$v（需要 24 LTS；Node 20 已 EOL）" ;; esac

v=$(java -version 2>&1 | head -1 | sed -E 's/.*"([^"]+)".*/\1/')
case "$v" in 17.*) ok java "$v" ;; *) bad java "${v:-none}（需要 JDK 17）" ;; esac
[ -n "${JAVA_HOME:-}" ] && ok JAVA_HOME "$JAVA_HOME" || warn JAVA_HOME "未設定，Gradle 可能抓到其他 JDK"

if [ -d "${ANDROID_HOME:-}" ]; then
  ok ANDROID_HOME "$ANDROID_HOME"
  for api in 34 35; do
    [ -d "$ANDROID_HOME/platforms/android-$api" ] && ok "platform" "android-$api" || bad "platform" "android-$api 未安裝"
  done
  [ -d "$ANDROID_HOME/platform-tools" ] && ok platform-tools "$(adb version 2>/dev/null | head -1)" || bad platform-tools "缺少"
  ls "$ANDROID_HOME/build-tools" 2>/dev/null | grep -q '^35\.' && ok build-tools "35.x" || bad build-tools "35.x 未安裝"
else
  bad ANDROID_HOME "未設定或目錄不存在"
fi

v=$(solana --version 2>/dev/null | awk '{print $2}'); [ -n "$v" ] && ok solana "$v" || warn solana "未安裝（鏈上開發才需要）"
v=$(anchor --version 2>/dev/null | awk '{print $2}'); [ -n "$v" ] && ok anchor "$v" || warn anchor "未安裝（鏈上開發才需要，見 Runbook 1.2）"
v=$(cargo --version 2>/dev/null | awk '{print $2}'); [ -n "$v" ] && ok cargo "$v" || warn cargo "未安裝（attestation-core 測試需要）"
command -v docker >/dev/null && ok docker "$(docker --version | awk '{print $3}' | tr -d ,)" || warn docker "未安裝（後端 PostgreSQL 需要）"

[ $fail -eq 0 ] && echo "必要項目全部通過" || { echo "有必要項目未通過，依 docs/build-and-test.md 1.2 補齊"; exit 1; }
