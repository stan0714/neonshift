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
  for node_bin in "$BREW_PREFIX/opt/node/bin" /opt/homebrew/opt/node/bin /usr/local/opt/node/bin; do
    if [ -x "$node_bin/node" ]; then
      export PATH="$node_bin:$PATH"
      break
    fi
  done
fi

# JDK 17
if [ -d "$BREW_PREFIX/opt/openjdk@17" ]; then
  export JAVA_HOME="$BREW_PREFIX/opt/openjdk@17"
  export PATH="$JAVA_HOME/bin:$PATH"
fi

# Android SDK
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin"

# Solana / Anchor
[ -d "$HOME/.local/share/solana/install/active_release/bin" ] && \
  export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
[ -d "$HOME/.avm/bin" ] && export PATH="$HOME/.avm/bin:$PATH"
