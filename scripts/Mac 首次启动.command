#!/bin/bash
set -e
cd "$(dirname "$0")"
APP="$PWD/DisplayBridge.app"
echo "屏间 · Apple Silicon 首次启动"
if [ ! -d "$APP" ]; then
  echo "请把本脚本和 DisplayBridge.app 放在同一个文件夹。"
  read -r -p "按回车结束…"
  exit 1
fi
if ! xcode-select -p >/dev/null 2>&1; then
  echo "首次运行需要 Apple Command Line Tools，用于在本机编译显示器控制组件。"
  echo "请执行 xcode-select --install，安装后再次运行本脚本。"
  read -r -p "按回车结束…"
  exit 1
fi
echo "为本地开发版本创建临时签名（不使用开发者证书、不上传任何内容）…"
/usr/bin/codesign --force --deep --sign - "$APP"
echo "打开屏间，首次读取时会自动编译本机 DDC 组件。"
open "$APP"
