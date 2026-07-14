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

# 不是 Git 工作区并不代表不能在线更新：OTA 的 artifact 模式（下载 release 包 + 校验 sha256 +
# 原子发布）全程不需要 Git。Git 只是拿不到 artifact 时「在机器上从源码构建」的回退路径。
# 这里不再硬性拦截，由 start-system-update-task.js 做权威判断（它能真正查到目标版本有没有
# 本机可用的 artifact），避免把用 release 包部署的机器错误地挡在门外。
if [[ ! -d .git ]] || ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "提示：当前目录不是 Git 工作区，将走 OTA release 包（artifact）模式更新；若目标版本没有本机可用的 artifact，更新会被拒绝。" >&2
fi

corepack enable
corepack prepare pnpm@9.14.2 --activate

INCUDAL_APP_DIR="$APP_DIR" \
NODE_ENV="${NODE_ENV:-production}" \
node "$APP_DIR/server/dist/scripts/start-system-update-task.js" "$TARGET_VERSION"
