#!/usr/bin/env bash
# 執行目前可在本機驗證的全部測試。
#
# 不需要 Node.js、Anchor 或 Solana CLI 的部分會直接跑；
# 需要而尚未安裝的會標示為 SKIP，不算失敗。
set -uo pipefail
cd "$(dirname "$0")/.."

# 非互動 shell 不讀 ~/.zshrc；統一由 scripts/env.sh 補上 Node 24、JDK 17、
# Android SDK、Solana 與 Anchor 路徑，CI 與本機用同一份設定。
# shellcheck disable=SC1091
source scripts/env.sh
[ -d "$HOME/.cargo/bin" ] && export PATH="$HOME/.cargo/bin:$PATH"

fail=0
pass=0

section() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }
ok()      { printf '  \033[32mPASS\033[0m %s\n' "$1"; pass=$((pass+1)); }
bad()     { printf '  \033[31mFAIL\033[0m %s\n' "$1"; fail=$((fail+1)); }
skip()    { printf '  \033[33mSKIP\033[0m %s\n' "$1"; }

section "attestation-core（Rust）"
if command -v cargo >/dev/null; then
  if (cd programs/attestation-core && cargo test --offline --quiet) >/tmp/ns-cargo.log 2>&1; then
    ok "cargo test"
  else
    bad "cargo test"; tail -20 /tmp/ns-cargo.log
  fi
else
  skip "cargo 未安裝"
fi

section "跨語言測試向量"
if command -v cargo >/dev/null && command -v python3 >/dev/null; then
  (cd programs/attestation-core && cargo run --offline --quiet --bin gen_vectors) \
    > /tmp/ns-vectors.json 2>/dev/null
  if python3 scripts/verify-vectors.py /tmp/ns-vectors.json >/tmp/ns-vec.log 2>&1; then
    ok "$(cat /tmp/ns-vec.log)"
  else
    bad "向量交叉驗證"; cat /tmp/ns-vec.log
  fi
  # 產生的向量必須與 repo 內已提交的一致，否則有人改了格式卻沒更新向量檔。
  if diff -q /tmp/ns-vectors.json backend/src/lib/attestation-vectors.json >/dev/null; then
    ok "已提交的向量檔為最新"
  else
    bad "向量檔過期，請執行 cargo run --bin gen_vectors > backend/src/lib/attestation-vectors.json"
  fi
else
  skip "需要 cargo 與 python3"
fi

section "資料庫 schema"
if docker info >/dev/null 2>&1; then
  C=neonshift-schema-test
  docker rm -f "$C" >/dev/null 2>&1
  docker run -d --name "$C" -p 127.0.0.1::5432 -e POSTGRES_PASSWORD=test -e POSTGRES_DB=neonshift \
    postgres:16-alpine >/dev/null 2>&1
  for _ in $(seq 1 40); do
    docker exec "$C" pg_isready -U postgres >/dev/null 2>&1 && break
    sleep 1
  done
  mig_ok=1
  for f in backend/migrations/[0-9]*.sql; do
    docker exec -i "$C" psql -U postgres -d neonshift -v ON_ERROR_STOP=1 -q < "$f" >/dev/null 2>&1 || { mig_ok=0; echo "  失敗：$f"; break; }
  done
  if [ "$mig_ok" = 1 ]; then
    ok "migration 套用（$(ls backend/migrations/[0-9]*.sql | wc -l | tr -d ' ') 個）"
    n=$(docker exec -i "$C" psql -U postgres -d neonshift -v ON_ERROR_STOP=1 -q \
          < backend/migrations/test_constraints.sql 2>&1 | grep -c "PASS")
    if docker exec -i "$C" psql -U postgres -d neonshift -v ON_ERROR_STOP=1 -q \
         < backend/migrations/test_constraints.sql 2>&1 | grep -q "FAIL"; then
      bad "約束測試"
    else
      ok "約束測試（$n 項）"
    fi
    # 後端整合測試（PostgresStore）沿用同一容器；先重套 migration 得到乾淨 schema
    PORT=$(docker port "$C" 5432/tcp | head -1 | awk -F: '{print $NF}')
    export TEST_DATABASE_URL="postgres://postgres:test@localhost:$PORT/neonshift"
  else
    bad "migration 套用"
  fi
else
  skip "Docker daemon 未執行"
fi

section "後端（TypeScript）"
if command -v npm >/dev/null && [ -d backend/node_modules ]; then
  if (cd backend && npm test --silent) >/tmp/ns-npm.log 2>&1; then
    ok "npm test$( [ -n "${TEST_DATABASE_URL:-}" ] && echo '（含 PostgresStore 整合）' )"
  else
    bad "npm test"; tail -20 /tmp/ns-npm.log
  fi
else
  skip "Node.js 未安裝或尚未 npm install"
fi
[ -n "${C:-}" ] && docker rm -f "$C" >/dev/null 2>&1

section "App（React Native）"
if command -v npm >/dev/null && [ -d app/node_modules ]; then
  if (cd app && npx tsc --noEmit) >/tmp/ns-app-tsc.log 2>&1; then
    ok "tsc --noEmit"
  else
    bad "tsc --noEmit"; tail -20 /tmp/ns-app-tsc.log
  fi
  if (cd app && npx jest --silent) >/tmp/ns-app-jest.log 2>&1; then
    ok "jest"
  else
    bad "jest"; tail -20 /tmp/ns-app-jest.log
  fi
else
  skip "Node.js 未安裝或 app/ 尚未 npm install"
fi

section "鏈上程式（Anchor + LiteSVM）"
if ! command -v anchor >/dev/null; then
  skip "Anchor 未安裝"
elif [ ! -f programs/Anchor.toml ]; then
  skip "尚未建立 Anchor workspace（programs/Anchor.toml 不存在）"
else
  # --arch v0：Anchor 預設 v3 的 ELF 無法被 LiteSVM 載入，見 programs/Anchor.toml
  if (cd programs && anchor build --arch v0) >/tmp/ns-anchor-build.log 2>&1; then
    ok "anchor build --arch v0"
    if (cd programs && cargo test -p neonshift-core --quiet) >/tmp/ns-anchor.log 2>&1; then
      ok "cargo test -p neonshift-core（LiteSVM）"
    else
      bad "cargo test -p neonshift-core"; tail -20 /tmp/ns-anchor.log
    fi
  else
    bad "anchor build"; tail -20 /tmp/ns-anchor-build.log
  fi
fi

printf '\n\033[1m總計：%d 通過，%d 失敗\033[0m\n' "$pass" "$fail"
exit $((fail > 0 ? 1 : 0))
