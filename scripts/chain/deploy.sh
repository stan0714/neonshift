#!/usr/bin/env bash
# PG-I-07：部署到指定環境（devnet）。upgrade authority = admin keypair（SD 8：MVP 不撤銷）。
source "$(dirname "$0")/lib.sh"
load_env "$1"
need anchor
[ "$CLUSTER" = "devnet" ] || { echo "只支援 devnet 部署；local 請用 LiteSVM 測試" >&2; exit 2; }
cd "$ROOT/programs"
[ -f target/deploy/neonshift_core.so ] || { echo "先執行 scripts/chain/build.sh $1" >&2; exit 2; }
[ "$(pubkey_of target/deploy/neonshift_core-keypair.json)" = "$(pubkey_of "$PROGRAM_KEYPAIR")" ] || { echo "target/deploy 的 keypair 不是 $1 環境的，請重新 build.sh" >&2; exit 2; }
anchor deploy --provider.cluster "$RPC_URL" --provider.wallet "$ADMIN_KEYPAIR" --program-name neonshift_core --program-keypair "$PROGRAM_KEYPAIR"
echo "已部署 PROGRAM_ID=$(pubkey_of "$PROGRAM_KEYPAIR")（upgrade authority: $(pubkey_of "$ADMIN_KEYPAIR")）"
