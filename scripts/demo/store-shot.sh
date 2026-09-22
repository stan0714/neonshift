#!/usr/bin/env bash
# PG-D-02 商店截圖：從接上 USB 的 Seeker 直接截圖並輸出 1080×2400（dApp Store 規格）到 docs/store/screenshots/<name>.png。
#   scripts/demo/store-shot.sh 01-landing        # 先在手機上把畫面開到要拍的位置，再執行
# 原始 1200×2670 也留一份在 output/hackathon-flexclip-en/captures/<日期>/store-<name>.png（未修圖）。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
name="${1:-}"; [ -n "$name" ] || { echo "用法：$0 <name>" >&2; exit 2; }
RAW_DIR="$ROOT/output/hackathon-flexclip-en/captures/$(date +%Y-%m-%d)"; mkdir -p "$RAW_DIR"
RAW="$RAW_DIR/store-$name.png"; OUT="$ROOT/docs/store/screenshots/$name.png"
adb get-state >/dev/null 2>&1 || { echo "手機未連線（adb）" >&2; exit 1; }
adb exec-out screencap -p > "$RAW"
# 1200×2670（0.4494）→ 1080×2400（0.45）：等比縮到高 2400 後置中裁寬（差 1 px 內）
sips -Z 2400 "$RAW" --out "$OUT" >/dev/null
W=$(sips -g pixelWidth "$OUT" | awk '/pixelWidth/{print $2}'); H=$(sips -g pixelHeight "$OUT" | awk '/pixelHeight/{print $2}')
if [ "$W" -ne 1080 ] || [ "$H" -ne 2400 ]; then sips -c 2400 1080 "$OUT" >/dev/null; fi
echo "$OUT ($(sips -g pixelWidth -g pixelHeight "$OUT" | awk '/pixel/{printf "%s ", $2}')) raw=$RAW"
