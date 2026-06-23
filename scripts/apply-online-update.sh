#!/usr/bin/env bash
set -Eeuo pipefail

TARGET_VERSION="${1:-}"
INSTALL_DIR="${INSTALL_DIR:-/opt/incudal}"

if [[ -z "$TARGET_VERSION" ]]; then
  echo "用法: bash scripts/apply-online-update.sh v1.2.3" >&2
  exit 1
fi

if [[ ! "$TARGET_VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$ ]]; then
  echo "目标版本必须是 release tag，例如 v1.2.3" >&2
  exit 1
fi

APP_DIR="$INSTALL_DIR"
if [[ -L "$INSTALL_DIR/current" ]]; then
  APP_DIR="$INSTALL_DIR/current"
fi

cd "$INSTALL_DIR"

if [[ ! -d .git ]] || ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "当前目录不是 Git 工作区，在线更新需要 /opt/incudal 是包含 release tag 的 Git checkout。" >&2
  echo "如果当前机器仍使用 release tar 包部署，请先继续使用手动部署包，或把生产目录迁移为 Git checkout 后再执行在线更新。" >&2
  exit 1
fi

corepack enable
corepack prepare pnpm@9.14.2 --activate

INCUDAL_APP_DIR="$APP_DIR" \
NODE_ENV="${NODE_ENV:-production}" \
node "$APP_DIR/server/dist/scripts/start-system-update-task.js" "$TARGET_VERSION"
