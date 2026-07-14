#!/bin/zsh
set -e

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${STORYBOARD_PORT:-3001}"
HOST="${STORYBOARD_HOST:-127.0.0.1}"
URL="http://${HOST}:${PORT}/"
NODE_BIN="/Users/tttt/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"

cd "$APP_DIR"

if curl -sS --max-time 2 -I "$URL" >/dev/null 2>&1; then
  echo "分镜小程序已经在运行：$URL"
  open "$URL"
  exit 0
fi

if [ ! -x "$NODE_BIN" ]; then
  NODE_BIN="$(command -v node || true)"
fi

if [ -z "$NODE_BIN" ]; then
  echo "没有找到 Node.js，无法启动小程序。"
  echo "请先安装 Node.js，或在 Codex 环境中启动。"
  read "?按回车退出..."
  exit 1
fi

echo "正在启动分镜小程序..."
echo "打开地址：$URL"
echo ""
echo "保持这个窗口打开，小程序才能继续运行。"
echo "要关闭小程序，请回到这个窗口按 Ctrl + C。"
echo ""

open "$URL" >/dev/null 2>&1 &
exec "$NODE_BIN" node_modules/next/dist/bin/next dev -H "$HOST" -p "$PORT"
