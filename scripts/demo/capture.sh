#!/usr/bin/env bash
# Demo 素材擷取（USB／adb）：截圖與錄影直接存到 output/hackathon-flexclip-en/captures/<日期>/。
# 用法：
#   scripts/demo/capture.sh shot <name>            # 截圖 → <name>.png（1200×2670）
#   scripts/demo/capture.sh rec  <name> [seconds]  # 錄影 → <name>.mp4（預設 30 s，上限 180；無聲音）
#   scripts/demo/capture.sh touches on|off         # 顯示觸控點（錄操作時開）
# 限制：錢包（Seed Vault／MWA）授權視窗為 secure surface，抓下來是黑畫面，請用相機側拍；手機須解鎖。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/output/hackathon-flexclip-en/captures/$(date +%Y-%m-%d)"
mkdir -p "$OUT"
cmd="${1:-}"; name="${2:-}"
case "$cmd" in
  shot)
    [ -n "$name" ] || { echo "用法：capture.sh shot <name>" >&2; exit 2; }
    adb exec-out screencap -p > "$OUT/$name.png"
    echo "$OUT/$name.png"
    ;;
  rec)
    [ -n "$name" ] || { echo "用法：capture.sh rec <name> [seconds]" >&2; exit 2; }
    secs="${3:-30}"
    adb shell screenrecord --time-limit "$secs" --bit-rate 8000000 "/sdcard/$name.mp4"
    adb pull "/sdcard/$name.mp4" "$OUT/$name.mp4" >/dev/null
    adb shell rm "/sdcard/$name.mp4"
    echo "$OUT/$name.mp4"
    ;;
  touches)
    v=0; [ "${name:-off}" = "on" ] && v=1
    adb shell settings put system show_touches "$v"
    echo "show_touches=$v"
    ;;
  *) sed -n 2,7p "$0"; exit 2 ;;
esac
