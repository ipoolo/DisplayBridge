#!/bin/bash
set -e
cd "$(dirname "$0")"
echo "屏间 · Mac 构建与启动"
if ! command -v node >/dev/null 2>&1; then
  echo "请先安装 ARM64 版 Node.js 22 或更新的 LTS 版本：https://nodejs.org/"
  read -r -p "按回车结束…"
  exit 1
fi
if ! xcode-select -p >/dev/null 2>&1; then
  echo "请先执行 xcode-select --install 安装 Apple Command Line Tools，然后重新运行本脚本。"
  read -r -p "按回车结束…"
  exit 1
fi
npm ci --no-audit --no-fund
npm run dist:mac
APP="release/mac-arm64/DisplayBridge.app"
if [ ! -d "$APP" ]; then
  echo "未找到构建的 App，请检查上面的输出。"
  exit 1
fi
open "$APP"
echo "已打开屏间。你可以将 release/mac-arm64/DisplayBridge.app 拖入应用程序文件夹。"
