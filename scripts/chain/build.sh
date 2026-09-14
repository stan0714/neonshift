#!/usr/bin/env bash
# PG-I-07：以指定環境的 program id 建置 neonshift_core（anchor build --arch v0，見 programs/Anchor.toml）。
# 會把該環境的 program keypair 放到 target/deploy 並用 `anchor keys sync` 改寫 declare_id!／Anchor.toml。
source "$(dirname "$0")/lib.sh"
load_env "$1"
need anchor
[ -f "$PROGRAM_KEYPAIR" ] || { echo "先執行 scripts/chain/keys.sh $1" >&2; exit 2; }
cd "$ROOT/programs"
mkdir -p target/deploy
cp "$PROGRAM_KEYPAIR" target/deploy/neonshift_core-keypair.json
anchor keys sync
anchor build --arch v0
echo "PROGRAM_ID=$(pubkey_of "$PROGRAM_KEYPAIR")"
cp target/idl/neonshift_core.json idl/neonshift_core.json
cp target/idl/neonshift_core.json "$ROOT/app/src/chain/idl/neonshift_core.json"
echo "IDL: programs/idl/neonshift_core.json（已更新，供 tools/chain-admin、backend、app 共用）"
echo "注意：declare_id! 已改為 $1 環境的 id；提交前確認是否要保留（localnet 測試對 id 無感）。"
