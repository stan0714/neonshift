#!/usr/bin/env bash
# NeonShift 開發環境變數。用法：source scripts/env.sh
# 對應 docs/build-and-test.md 1.3；不寫入 ~/.zshrc，只影響目前 shell。
# 版本要求來自 SD 2.2：Node.js 24 LTS、JDK 17、Android SDK（API 34/35）。

BREW_PREFIX="$(brew --prefix 2>/dev/null || echo /opt/homebrew)"

# Node.js 24：優先 nvm，其次 Homebrew node。
#
# 找 node 不能只看一個 BREW_PREFIX：同一台 Mac 上 /opt/homebrew 與 /usr/local 可能都有
# Homebrew，而 node 只裝在其中一邊（這台就是 openjdk 在 /opt/homebrew、node 在 /usr/local）。
# 而且 nvm 是 shell function，非互動、非登入 shell（scripts/test-all.sh、scripts/ops/*.sh）
# 讀不到它——兩件事湊起來的結果是「測試默默用系統上的舊版 node 跑」，而舊版 node 的
# jest 沙箱沒有 crypto.getRandomValues，會讓用到 Keypair.generate() 的套件失敗。
# 所以這裡逐一試已知位置，挑第一個真的存在的。
if command -v nvm >/dev/null 2>&1 && nvm ls 24 >/dev/null 2>&1; then
  nvm use 24 >/dev/null
else
  # nvm 安裝目錄（非互動 shell 讀不到 nvm function 時直接用）排第一；
  # 2026-10 macOS 升級後沒有 Rosetta，/usr/local 的 x86 Homebrew node 已無法執行。
  nvm_node24="$(ls -d "$HOME"/.nvm/versions/node/v24.*/bin 2>/dev/null | sort -V | tail -1)"
  for node_bin in "$nvm_node24" "$BREW_PREFIX/opt/node/bin" /opt/homebrew/opt/node/bin /usr/local/opt/node/bin; do
    if [ -n "$node_bin" ] && [ -x "$node_bin/node" ] && "$node_bin/node" -v >/dev/null 2>&1; then
      export PATH="$node_bin:$PATH"
      break
    fi
  done
fi

# JDK 17：同樣逐一試已知位置，挑第一個真的能執行的
# （2026-10 macOS 升級後沒有 Rosetta，/usr/local 的 x86 openjdk@17 目錄還在但 java 跑不起來）
for jdk in "$BREW_PREFIX/opt/openjdk@17" /opt/homebrew/opt/openjdk@17 /usr/local/opt/openjdk@17; do
  if [ -x "$jdk/bin/java" ] && "$jdk/bin/java" -version >/dev/null 2>&1; then
    export JAVA_HOME="$jdk"
    export PATH="$JAVA_HOME/bin:$PATH"
    break
  fi
done

# Android SDK
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin"

# Solana / Anchor
[ -d "$HOME/.local/share/solana/install/active_release/bin" ] && \
  export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
[ -d "$HOME/.avm/bin" ] && export PATH="$HOME/.avm/bin:$PATH"
