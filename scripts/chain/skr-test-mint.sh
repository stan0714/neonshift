#!/usr/bin/env bash
# SKR-01／07 devnet 試跑用「TEST SKR」mint（不是官方 SKR；官方 mint 只在主網）。
#   skr-test-mint.sh dev create            以 dev admin 金鑰在 devnet 建立 6 decimals 測試 mint，並建立收款人（admin）ATA
#   skr-test-mint.sh dev fund <wallet> <n> 鑄造 n 個 TEST SKR 到指定錢包（供實機試付；devnet，無價值）
# 之後在後端設定：SKR_ENABLED=true SKR_NETWORK=devnet SKR_MINT=<此 mint> SKR_RECIPIENT=<admin 公鑰> SKR_GENESIS_FRAME_PRICE=<最小單位>
# App 會把此網路標示為 TEST SKR · DEVNET；正式提交前必須改回 mainnet-beta＋官方 mint（config.ts 守門）。
source "$(dirname "$0")/lib.sh"
load_env "$1"
need spl-token
ACTION="${2:-create}"
ADMIN="$(pubkey_of "$ADMIN_KEYPAIR")"
common=(--url "$RPC_URL" --fee-payer "$ADMIN_KEYPAIR")
case "$ACTION" in
  create)
    [ "$CLUSTER" = devnet ] || { echo "只允許 devnet（目前 $CLUSTER）" >&2; exit 2; }
    MINT=$(spl-token create-token --decimals 6 --mint-authority "$ADMIN_KEYPAIR" "${common[@]}" --output json | python3 -c 'import sys,json;print(json.load(sys.stdin)["commandOutput"]["address"])')
    spl-token create-account "$MINT" --owner "$ADMIN" "${common[@]}" --output json >/dev/null 2>&1 || true
    echo "SKR_NETWORK=devnet"
    echo "SKR_MINT=$MINT"
    echo "SKR_RECIPIENT=$ADMIN"
    echo "（收款 ATA 已建立；後端 SKR_GENESIS_FRAME_PRICE 以最小單位設定，例如 2.5 TEST SKR = 2500000）" ;;
  fund)
    MINT="${SKR_MINT:?請以環境變數 SKR_MINT 指定測試 mint}"; TO="${3:?wallet}"; N="${4:?amount}"
    spl-token create-account "$MINT" --owner "$TO" "${common[@]}" --output json >/dev/null 2>&1 || true
    spl-token mint "$MINT" "$N" --recipient-owner "$TO" --mint-authority "$ADMIN_KEYPAIR" "${common[@]}"
    echo "已鑄造 $N TEST SKR → $TO" ;;
  *) sed -n 2,6p "$0"; exit 2 ;;
esac
