#!/usr/bin/env bash
# PG-I-08：tSKR 經典 SPL Token（6 decimals）。
#   token.sh <env>        建立 mint、reward vault（owner = Config PDA）、treasury vault，回填 env
#   token.sh <env> fund   鑄造固定供給至 admin，撥款 TSKR_REWARD_FUND 至 reward vault，撤銷 mint authority（BR-22，不可逆）
source "$(dirname "$0")/lib.sh"
load_env "$1"
need spl-token
ACTION="${2:-create}"
PROGRAM_ID="${PROGRAM_ID:-$(pubkey_of "$PROGRAM_KEYPAIR")}"
CONFIG_PDA="$(config_pda "$PROGRAM_ID")"
ADMIN="$(pubkey_of "$ADMIN_KEYPAIR")"
common=(--url "$RPC_URL" --fee-payer "$ADMIN_KEYPAIR")
ata_of() { spl-token address --token "$1" --owner "$2" --verbose --url "$RPC_URL" --output json | python3 -c 'import sys,json;print(json.load(sys.stdin)["associatedTokenAddress"])'; }

case "$ACTION" in
  create)
    [ -z "${TSKR_MINT:-}" ] || { echo "TSKR_MINT 已存在（$TSKR_MINT），不重複建立" >&2; exit 1; }
    # mint authority = admin（鑄造固定供給後撤銷）；freeze authority 不設
    MINT="${TSKR_MINT_EXISTING:-}"
    [ -n "$MINT" ] || MINT=$(spl-token create-token --decimals 6 --mint-authority "$ADMIN_KEYPAIR" "${common[@]}" --output json | python3 -c 'import sys,json;print(json.load(sys.stdin)["commandOutput"]["address"])')
    echo "TSKR_MINT=$MINT"
    # reward vault：owner 為 Config PDA，之後由程式以 PDA 簽章轉出（BR-22：管理員不得直接提款）
    # spl-token 5.x 的 create-account JSON 只回 signature；位址改以 ATA 推導（已存在時略過建立）
    spl-token create-account "$MINT" --owner "$CONFIG_PDA" "${common[@]}" --output json >/dev/null 2>&1 || true
    REWARD=$(ata_of "$MINT" "$CONFIG_PDA")
    echo "REWARD_VAULT=$REWARD（owner=$CONFIG_PDA）"
    # treasury vault：owner 為 admin（多簽），mint 相符即可（initialize_config 約束）
    spl-token create-account "$MINT" --owner "$ADMIN" "${common[@]}" --output json >/dev/null 2>&1 || true
    TREASURY=$(ata_of "$MINT" "$ADMIN")
    echo "TREASURY_VAULT=$TREASURY（owner=$ADMIN）"
    set_env_value "$1" TSKR_MINT "$MINT"
    set_env_value "$1" REWARD_VAULT "$REWARD"
    set_env_value "$1" TREASURY_VAULT "$TREASURY"
    set_env_value "$1" PROGRAM_ID "$PROGRAM_ID"
    echo "已回填 deploy/$1.env；下一步：initialize_config（tools/chain-admin），再 token.sh $1 fund"
    ;;
  fund)
    [ -n "${TSKR_MINT:-}" ] && [ -n "${REWARD_VAULT:-}" ] || { echo "先執行 token.sh $1（建立 mint／vault）" >&2; exit 2; }
    echo "將鑄造 $TSKR_TOTAL_SUPPLY tSKR 至 admin，撥款 $TSKR_REWARD_FUND 至 $REWARD_VAULT，然後撤銷 mint authority（不可逆）。"
    confirm "確定？"
    spl-token create-account "$TSKR_MINT" --owner "$ADMIN" "${common[@]}" --output json >/dev/null 2>&1 || true
    ADMIN_ATA=$(ata_of "$TSKR_MINT" "$ADMIN")
    spl-token mint "$TSKR_MINT" "$TSKR_TOTAL_SUPPLY" "$ADMIN_ATA" --mint-authority "$ADMIN_KEYPAIR" "${common[@]}"
    spl-token transfer "$TSKR_MINT" "$TSKR_REWARD_FUND" "$REWARD_VAULT" --owner "$ADMIN_KEYPAIR" "${common[@]}"
    spl-token authorize "$TSKR_MINT" mint --disable --authority "$ADMIN_KEYPAIR" "${common[@]}"
    echo "--- BR-22 驗收證據（mint authority 應為空）---"
    spl-token display "$TSKR_MINT" --url "$RPC_URL"
    spl-token balance --address "$REWARD_VAULT" --url "$RPC_URL"
    ;;
  *) echo "未知動作 $ACTION" >&2; exit 2 ;;
esac
