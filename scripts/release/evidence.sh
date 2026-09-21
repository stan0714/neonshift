#!/usr/bin/env bash
# 參賽證據包（docs/store/competition-development-plan.md §6、COMP-04／05／R01）：
# 把「哪一顆 APK、哪個 commit、哪台裝置／錢包」固定成一份可交叉比對的紀錄，只寫公開資訊（不含私鑰、健康資料、證件）。
# 用法：scripts/release/evidence.sh [apk 路徑]   # 預設 app/android/app/build/outputs/apk/release/app-release.apk
# 輸出：docs/evidence/<日期>-release-candidate.md（同日重跑會覆蓋；驗收結果請直接在檔內填「實際／證據／測試者」）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APK="${1:-$ROOT/app/android/app/build/outputs/apk/release/app-release.apk}"
[ -f "$APK" ] || { echo "找不到 APK：$APK（先跑 scripts/app/build.sh <env> release）" >&2; exit 2; }
NOTES="$(dirname "$APK")/release-notes.txt"
DAY="$(date +%Y-%m-%d)"
OUT="$ROOT/docs/evidence/$DAY-release-candidate.md"
SHA="$(shasum -a 256 "$APK" | cut -d' ' -f1)"
AAPT="$(ls "${ANDROID_HOME:-$HOME/Library/Android/sdk}"/build-tools/*/aapt2 2>/dev/null | sort -V | tail -1 || true)"
PKG=""; if [ -n "$AAPT" ]; then PKG="$("$AAPT" dump badging "$APK" 2>/dev/null | grep -m1 '^package:' || true)"; fi
DEV=""
if command -v adb >/dev/null && adb get-state >/dev/null 2>&1; then
  model="$(adb shell getprop ro.product.model | tr -d '\r')"; rel="$(adb shell getprop ro.build.version.release | tr -d '\r')"; sec="$(adb shell getprop ro.build.version.security_patch | tr -d '\r')"
  wallets=""
  for p in com.solanamobile.wallet app.phantom ag.jup.jupiter.android com.solanamobile.seedvaultimpl com.google.android.apps.healthdata; do
    v="$(adb shell dumpsys package "$p" 2>/dev/null | grep -m1 versionName | tr -d ' \r' | cut -d= -f2 || true)"
    [ -n "$v" ] && wallets="$wallets\n| $p | $v |"
  done
  DEV="| 項目 | 值 |\n|---|---|\n| 裝置 | $model · Android $rel · 安全性更新 $sec |\n| 已安裝錢包／Health Connect | 見下表 |\n\n| 套件 | 版本 |\n|---|---|$wallets"
fi
{
  echo "# 提交候選版證據（$DAY）"
  echo
  echo "依 [參賽開發計畫 §6](../store/competition-development-plan.md) 產生；只有實測才標 PASS。本檔由 \`scripts/release/evidence.sh\` 生成骨架，驗收欄位手動填寫。"
  echo
  echo "## 建置"
  echo
  echo "| 項目 | 值 |"; echo "|---|---|"
  echo "| APK | \`$(basename "$APK")\` |"
  echo "| SHA-256 | \`$SHA\` |"
  [ -n "$PKG" ] && echo "| badging | \`$PKG\` |"
  if [ -f "$NOTES" ]; then while IFS= read -r line; do echo "| ${line%%:*} | ${line#*: } |"; done < "$NOTES"; fi
  echo "| 建置指令 | \`APP_ARCHS=<abi> scripts/app/build.sh <env> release\`（乾淨環境重建步驟：docs/build-and-test.md） |"
  echo
  echo "## 裝置"
  echo
  if [ -n "$DEV" ]; then printf "%b\n" "$DEV"; else echo "（未接 adb 裝置；請手動填：機型、Android 版本、錢包與 Health Connect 版本）"; fi
  echo
  echo "## 驗收矩陣（預期／實際／證據／測試者／日期）"
  echo
  echo "| 類別 | 案例 | 預期 | 實際 | 證據 | 測試者 | 日期 | 結果 |"
  echo "|---|---|---|---|---|---|---|---|"
  for c in "錢包|未安裝相容錢包|顯示 No compatible wallet，不崩潰" "錢包|取消授權|顯示已取消，未寫入 session" "錢包|連點連接|只開一次錢包" "錢包|背景返回|回前景後狀態一致" "錢包|已核准但錢包未回覆|WALLET_NO_REPLY 指引改用 Seeker Wallet" "錢包|session 過期|重新授權後同帳號繼續" "錢包|切換帳戶|舊帳戶資料不混入" "錢包|無 SOL|交易前提示，不送出" "錢包|重開 App／斷線|session 與待送項恢復" \
           "運動|GPS 權限拒絕／無訊號|不可開始或標示缺口" "運動|暫停／恢復|時間與距離正確" "運動|離線保存|本機保存，稍後同步" "運動|三筆離線依序同步|舊到新，不跳過" "運動|待審 vs 正式資格|UI 區分，任務不誤判" "運動|UTC 換日|任務日與步數重置" \
           "NFT|未達標|不可領取並說明" "NFT|待 registry|顯示等待，不假造" "NFT|取消簽章|無交易" "NFT|成功領取|Explorer 可查 asset" "NFT|重複領取|receipt 擋下（6009／已領）" "NFT|回覆遺失|查 receipt 後正確顯示" \
           "UI|冷啟動|直接進 Home（有 session）" "UI|窄螢幕／字體放大|無截斷" "UI|中英切換|兩語完整" "UI|Reduce Motion|直接顯示結果" "UI|返回鍵|不卡死" "UI|舊路線背景固定|不隨偏好改變" \
           "發布|release 無 debug 簽章／demoLevel=0|release-notes 記錄" "發布|API／RPC 可達|healthz 200、rules version" "發布|APK／影片／GitHub／簡報同版|commit 一致" "發布|無私鑰／健康資料／證件洩漏|repo 與素材檢查"; do
    IFS='|' read -r cat name exp <<<"$c"; echo "| $cat | $name | $exp |  |  |  |  | TODO |"
  done
  echo
  echo "## 鏈上／交易證據"
  echo
  echo "| 項目 | 值 |"; echo "|---|---|"
  echo "| cluster | devnet |"
  echo "| program | $(grep -m1 'Program Id' "$NOTES" 2>/dev/null | cut -d: -f2- | tr -d ' ' || echo '') |"
  echo "| tSKR mint（測試代幣，非官方 SKR） | $(grep -m1 'tSKR Mint' "$NOTES" 2>/dev/null | cut -d: -f2- | tr -d ' ' || echo '') |"
  echo "| 打卡交易 signature | （實測後填） |"
  echo "| 成就 NFT asset | （實測後填） |"
  echo
  echo "## 素材"
  echo
  echo "| 項目 | 值 |"; echo "|---|---|"
  echo "| 影片網址／實測長度 | （≤ 3:00；填實際秒數） |"
  echo "| GitHub | （公開可讀；release tag） |"
  echo "| 簡報 | （網址／版本） |"
  echo "| APK 下載 | （網址；SHA-256 同上） |"
} > "$OUT"
echo "$OUT"
