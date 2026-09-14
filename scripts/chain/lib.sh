#!/usr/bin/env bash
# 共用：載入 deploy/<env>.env、工具鏈路徑、PDA 推導
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/scripts/env.sh"

load_env() {
  local env="${1:-}"
  [ -n "$env" ] || { echo "用法：$0 <dev|demo|local> [...]" >&2; exit 2; }
  local f="$ROOT/deploy/$env.env"
  [ -f "$f" ] || { echo "找不到 $f" >&2; exit 2; }
  set -a
  # shellcheck disable=SC1090
  source "$f"
  set +a
  KEY_DIR="$(eval echo "$KEY_DIR")"
  ADMIN_KEYPAIR="$(eval echo "$ADMIN_KEYPAIR")"
  PROGRAM_KEYPAIR="$(eval echo "$PROGRAM_KEYPAIR")"
  ATTESTOR_KEYPAIR="$(eval echo "$ATTESTOR_KEYPAIR")"
  export KEY_DIR ADMIN_KEYPAIR PROGRAM_KEYPAIR ATTESTOR_KEYPAIR
}

need() { command -v "$1" >/dev/null || { echo "缺少 $1（見 docs/build-and-test.md 1.2）" >&2; exit 2; }; }

pubkey_of() { solana-keygen pubkey "$1"; }

# Config PDA：seeds ["config"]
config_pda() { solana find-program-derived-address "$1" string:config | awk '{print $1}'; }

# 回填 KEY=VALUE 到 deploy/<env>.env
set_env_value() {
  local env="$1" key="$2" value="$3" f="$ROOT/deploy/$env.env"
  if grep -q "^$key=" "$f"; then
    sed -i '' "s|^$key=.*|$key=$value|" "$f"
  else
    echo "$key=$value" >> "$f"
  fi
}

confirm() {
  read -r -p "$1 [y/N] " ans
  [ "$ans" = "y" ] || { echo "已取消"; exit 1; }
}
