#!/usr/bin/env bash
# PG-I-07：產生或檢查環境金鑰（admin／program／attestor）。金鑰放在 ~/.config/neonshift/<env>/，不進 repo。
source "$(dirname "$0")/lib.sh"
load_env "$1"
need solana-keygen
mkdir -p "$KEY_DIR"
chmod 700 "$KEY_DIR"
for k in "$ADMIN_KEYPAIR" "$PROGRAM_KEYPAIR" "$ATTESTOR_KEYPAIR"; do
  if [ -f "$k" ]; then
    echo "已存在 $k → $(pubkey_of "$k")"
  else
    solana-keygen new --no-bip39-passphrase --silent -o "$k"
    chmod 600 "$k"
    echo "已建立 $k → $(pubkey_of "$k")"
  fi
done
set_env_value "$1" PROGRAM_ID "$(pubkey_of "$PROGRAM_KEYPAIR")"
echo
echo "admin:    $(pubkey_of "$ADMIN_KEYPAIR")"
echo "program:  $(pubkey_of "$PROGRAM_KEYPAIR")"
echo "attestor: $(pubkey_of "$ATTESTOR_KEYPAIR")   （後端 signer；dev 以外請移入 KMS）"
echo "config PDA: $(config_pda "$(pubkey_of "$PROGRAM_KEYPAIR")")"
if [ "$CLUSTER" = "devnet" ]; then
  echo
  echo "admin 餘額：$(solana balance "$(pubkey_of "$ADMIN_KEYPAIR")" --url "$RPC_URL" 2>/dev/null || echo 查詢失敗)"
  echo "不足時：solana airdrop 2 $(pubkey_of "$ADMIN_KEYPAIR") --url $RPC_URL（有速率限制，或用 faucet.solana.com）"
fi
