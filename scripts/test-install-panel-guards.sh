#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=install-panel.sh
source "$REPO_ROOT/scripts/install-panel.sh"

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

mkdir -p "$WORK_DIR/payload"
printf 'payincus installer guard\n' > "$WORK_DIR/payload/version.txt"

SAFE_ARCHIVE="$WORK_DIR/incudal-v0.0.0-linux-amd64.tar.gz"
tar -czf "$SAFE_ARCHIVE" -C "$WORK_DIR/payload" .
sha256sum "$SAFE_ARCHIVE" > "${SAFE_ARCHIVE}.sha256"

verify_release_checksum "$SAFE_ARCHIVE"
validate_release_archive "$SAFE_ARCHIVE"

printf '%064d  %s\n' 0 "$(basename "$SAFE_ARCHIVE")" > "${SAFE_ARCHIVE}.sha256"
if verify_release_checksum "$SAFE_ARCHIVE"; then
    echo "checksum guard accepted a mismatched archive" >&2
    exit 1
fi

UNSAFE_ARCHIVE="$WORK_DIR/unsafe.tar.gz"
tar -czf "$UNSAFE_ARCHIVE" --transform='s#^#../#' -C "$WORK_DIR/payload" .
if validate_release_archive "$UNSAFE_ARCHIVE"; then
    echo "archive guard accepted a parent traversal path" >&2
    exit 1
fi

grep -Fq -- '-f "${INSTALL_DIR}/current/server/dist/app.js"' "$REPO_ROOT/scripts/install-panel.sh"
grep -Fq '检测到原子 OTA 布局' "$REPO_ROOT/scripts/install-panel.sh"
grep -Fq 'ExecStart=/usr/local/libexec/incudal/incudal-online-task update %i' "$REPO_ROOT/scripts/install-panel.sh"
grep -Fq 'ExecStart=/usr/local/libexec/incudal/incudal-online-task rollback %i' "$REPO_ROOT/scripts/install-panel.sh"
grep -Fq 'chown "root:${RUN_USER}" "$ENV_FILE"' "$REPO_ROOT/scripts/install-panel.sh"
grep -Fq 'Defaults:${RUN_USER} secure_path=/usr/local/libexec/incudal:' "$REPO_ROOT/scripts/install-panel.sh"

for helper in \
    incudal-online-task.sh.example \
    incudal-systemctl-wrapper.sh.example \
    incudal-ota-chown-wrapper.sh.example; do
    bash -n "$REPO_ROOT/deploy/$helper"
done

if grep -Fq 'ExecStart=/usr/bin/node /opt/incudal/current/server/dist/scripts/' \
    "$REPO_ROOT/deploy/incudal-online-update@.service.example" \
    "$REPO_ROOT/deploy/incudal-online-rollback@.service.example"; then
    echo "root unit still executes a worker from current directly" >&2
    exit 1
fi

echo "install-panel guards passed"
