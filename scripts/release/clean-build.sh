#!/usr/bin/env bash
# COMP-07／R01：在乾淨目錄從 Git HEAD 重建 release APK，證明提交版本可由 repo 內容重建（不含工作樹未提交檔案）。
#   scripts/release/clean-build.sh [env] [--keep]      # 預設 env=demo；--keep 保留 clone 目錄
#   APP_ARCHS=arm64-v8a scripts/release/clean-build.sh dev
# 流程：git clone <本 repo> → 複製 keystore.properties（gitignore，指向 ~/.config/neonshift/... 的絕對路徑）→ npm ci → build.sh <env> release
#      → 記錄 SHA-256、與工作樹既有 APK 比對 → docs/evidence/<日期>-clean-build-<env>.md。
# 注意：Gradle／R8 產物不保證 bit-for-bit 一致（簽章時間戳、資源順序），本檔比對只作參考；主要證據是「乾淨 clone 能成功建出同 commit 的 APK」。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_NAME="${1:-demo}"; KEEP=0; [ "${2:-}" = "--keep" ] && KEEP=1
WORK="${CLEAN_BUILD_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/neonshift-clean.XXXXXX")}"
CLONE="$WORK/neonshift"
HEAD_SHA="$(git -C "$ROOT" rev-parse HEAD)"
DIRTY="$(git -C "$ROOT" status --porcelain -- . ':!output' ':!docs' | wc -l | tr -d ' ')"
KS_PROPS="$ROOT/app/android/keystore.properties"
[ -f "$KS_PROPS" ] || { echo "缺少 $KS_PROPS（Runbook 8.1）" >&2; exit 2; }
grep -q '^storeFile=/' "$KS_PROPS" || { echo "keystore.properties 的 storeFile 必須是絕對路徑（clone 目錄不同）" >&2; exit 2; }

echo "→ clone $HEAD_SHA → $CLONE"
git clone -q --no-hardlinks "$ROOT" "$CLONE"
git -C "$CLONE" checkout -q "$HEAD_SHA"
[ "$(git -C "$CLONE" status --porcelain | wc -l | tr -d ' ')" = 0 ] || { echo "clone 不乾淨" >&2; exit 1; }
# 只帶入簽章設定（不在 repo）；不複製任何 .env／私鑰
cp "$KS_PROPS" "$CLONE/app/android/keystore.properties"

START="$(date -u +%Y-%m-%dT%H:%M:%SZ)"; T0=$(date +%s)
echo "→ 建置（$ENV_NAME release）"
( cd "$CLONE" && bash -lc "source scripts/env.sh >/dev/null; APP_ARCHS='${APP_ARCHS:-}' scripts/app/build.sh $ENV_NAME release" ) 2>&1 | tee "$WORK/build.log" | tail -25
T1=$(date +%s)
APK="$CLONE/app/android/app/build/outputs/apk/release/app-release.apk"
[ -f "$APK" ] || { echo "建置失敗：找不到 $APK（見 $WORK/build.log）" >&2; exit 1; }
SHA="$(shasum -a 256 "$APK" | cut -d' ' -f1)"
SIZE="$(stat -f %z "$APK" 2>/dev/null || stat -c %s "$APK")"
WT_APK="$ROOT/app/android/app/build/outputs/apk/release/app-release.apk"
WT_SHA=""; [ -f "$WT_APK" ] && WT_SHA="$(shasum -a 256 "$WT_APK" | cut -d' ' -f1)"
WT_NOTE=""; [ -f "$(dirname "$WT_APK")/release-notes.txt" ] && WT_NOTE="$(grep -m1 '^Git:' "$(dirname "$WT_APK")/release-notes.txt" | cut -d' ' -f2-)"
# 未簽章內容比對：apksigner 簽章區塊以外的 zip entry 逐一比對（可判斷差異只在簽章／時間戳還是程式內容）
DIFF_ENTRIES=""
if [ -n "$WT_SHA" ] && command -v unzip >/dev/null; then
  DIFF_ENTRIES="$(diff <(unzip -lv "$APK" | awk 'NR>3 && $1 ~ /^[0-9]+$/ {print $8, $1, $7}' | grep -v '^META-INF/' | sort) \
                       <(unzip -lv "$WT_APK" | awk 'NR>3 && $1 ~ /^[0-9]+$/ {print $8, $1, $7}' | grep -v '^META-INF/' | sort) | grep -c '^[<>]' || true)"
fi
mkdir -p "$ROOT/docs/evidence"
OUT="$ROOT/docs/evidence/$(date +%Y-%m-%d)-clean-build-$ENV_NAME.md"
{
  echo "# 乾淨環境重建紀錄（$(date +%Y-%m-%d)）"
  echo
  echo "由 \`scripts/release/clean-build.sh $ENV_NAME\` 產生：從 Git HEAD 重新 clone 到暫存目錄、\`npm ci\`、\`scripts/app/build.sh $ENV_NAME release\`。只帶入簽章設定（不在 repo），未複製任何未提交檔案。"
  echo
  echo "| 項目 | 值 |"; echo "|---|---|"
  echo "| commit | \`$HEAD_SHA\`$( [ "$DIRTY" != 0 ] && echo "（工作樹另有 $DIRTY 個未提交變更，未納入）" ) |"
  echo "| env | $ENV_NAME（ABI: ${APP_ARCHS:-armeabi-v7a,arm64-v8a,x86,x86_64}） |"
  echo "| 開始／耗時 | $START · $((T1-T0)) s |"
  echo "| 工具鏈 | $(bash -lc "source \"$ROOT/scripts/env.sh\" >/dev/null 2>&1; echo node \$(node -v) · npm \$(npm -v) · java \$(java -version 2>&1 | head -1 | sed 's/.*\"\\(.*\\)\".*/\\1/')") · $(uname -sm) |"
  echo "| 重建 APK SHA-256 | \`$SHA\`（$SIZE bytes） |"
  if [ -n "$WT_SHA" ]; then
    echo "| 工作樹 APK SHA-256 | \`$WT_SHA\`（${WT_NOTE:-commit 未知}） |"
    echo "| 結果 | $( [ "$SHA" = "$WT_SHA" ] && echo "SHA-256 一致" || echo "SHA-256 不同；簽章區塊以外的 zip entry（名稱／大小／CRC）差異數：${DIFF_ENTRIES:-?}（0 = 內容相同，只差簽章／時間戳）" ) |"
  fi
  grep -E '^(版本|Program Id|tSKR Mint|後端|網路|展示覆寫)' "$CLONE/app/android/app/build/outputs/apk/release/release-notes.txt" | sed 's/^\([^:]*\): */| \1 | /; s/$/ |/'
  echo
  echo "建置 log：\`$WORK/build.log\`（暫存，未納入 repo）。"
} > "$OUT"
cat "$OUT"
if [ "$KEEP" = 1 ]; then echo "→ 保留 $WORK"; else rm -rf "$WORK"; fi
