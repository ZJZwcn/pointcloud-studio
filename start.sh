#!/usr/bin/env bash
# 点云实验室 · POINT CLOUD STUDIO —— 一键启动（dist 已构建好，不需要 npm install）
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "需要 Node.js 18 或更高版本：https://nodejs.org/"
  exit 1
fi

URL="http://127.0.0.1:5183/"
echo
echo "  点云实验室 · POINT CLOUD STUDIO"
echo "  Node $(node -v)"
echo "  正在启动 $URL   （Ctrl+C 停止）"
echo

# 等服务起来再开浏览器
(
  sleep 2
  if command -v open >/dev/null 2>&1; then open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"
  fi
) >/dev/null 2>&1 &

exec node server/index.mjs
