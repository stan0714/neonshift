#!/usr/bin/env bash
# NeonShift 開發環境變數。用法：source scripts/env.sh
# 對應 docs/build-and-test.md 1.3；不寫入 ~/.zshrc，只影響目前 shell。
# 版本要求來自 SD 2.2：Node.js 24 LTS、JDK 17、Android SDK（API 34/35）。

BREW_PREFIX="$(brew --prefix 2>/dev/null || echo /opt/homebrew)"

# Node.js 24：優先 nvm，其次 Homebrew node
if command -v nvm >/dev/null 2>&1 && nvm ls 24 >/dev/null 2>&1; then
  nvm use 24 >/dev/null
elif [ -x "$BREW_PREFIX/opt/node/bin/node" ]; then
  export PATH="$BREW_PREFIX/opt/node/bin:$PATH"
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
