#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/incudal}"
SERVICE_NAME="${SERVICE_NAME:-incudal-backend}"
RUN_USER="${RUN_USER:-incudal}"
GITHUB_REPO="${GITHUB_REPO:-VipMaxxxx/payincus}"

log() {
  printf '[migrate-ota-atomic] %s\n' "$*"
}

fail() {
  printf '[migrate-ota-atomic] ERROR: %s\n' "$*" >&2
  exit 1
}

require_root() {
  [[ "$(id -u)" -eq 0 ]] || fail "must run as root"
}

copy_current_install_to_release() {
  local release_dir="$1"
  mkdir -p "$release_dir"

  shopt -s dotglob nullglob
  for path in "$INSTALL_DIR"/*; do
    local name
    name="$(basename "$path")"
    case "$name" in
      current|releases|update-logs|.git|.gitconfig|.npm|.cache|.local|agent-release)
        continue
        ;;
    esac
    cp -a "$path" "$release_dir/"
  done
  shopt -u dotglob nullglob

  mkdir -p "$release_dir/server/certs"
  if [[ -d "$INSTALL_DIR/server/certs" ]]; then
    cp -a "$INSTALL_DIR/server/certs/." "$release_dir/server/certs/" 2>/dev/null || true
  fi
  if [[ -f "$INSTALL_DIR/.env" ]]; then
    cp -a "$INSTALL_DIR/.env" "$release_dir/.env"
  fi
}

write_systemd_units() {
  local app_dir="$INSTALL_DIR/current"
  local env_file="$INSTALL_DIR/.env"
  local systemctl_bin
  systemctl_bin="$(command -v systemctl)"

  cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Incudal backend API
Documentation=https://github.com/${GITHUB_REPO}
After=network.target postgresql.service redis-server.service
Wants=network.target

[Service]
Type=simple
User=${RUN_USER}
Group=${RUN_USER}
WorkingDirectory=${app_dir}
EnvironmentFile=${env_file}
Environment=HOME=${INSTALL_DIR}
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=NPM_CONFIG_CACHE=${INSTALL_DIR}/.npm
Environment=XDG_CACHE_HOME=${INSTALL_DIR}/.cache

ExecStartPre=/usr/bin/bash -lc 'cd ${app_dir}/server && pnpm exec prisma migrate deploy'
ExecStart=/usr/bin/node ${app_dir}/server/dist/app.js

Restart=on-failure
RestartSec=10
KillMode=mixed
KillSignal=SIGTERM
TimeoutStopSec=30
LimitNOFILE=65536

NoNewPrivileges=false
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${INSTALL_DIR} ${INSTALL_DIR}/current ${INSTALL_DIR}/releases ${INSTALL_DIR}/server/certs ${INSTALL_DIR}/.npm ${INSTALL_DIR}/.cache ${INSTALL_DIR}/.git ${INSTALL_DIR}/update-logs
PrivateTmp=true

StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

[Install]
WantedBy=multi-user.target
EOF

  cat > /etc/systemd/system/incudal-online-update@.service <<EOF
[Unit]
Description=PayIncus online update task %i
Documentation=https://github.com/${GITHUB_REPO}
After=network.target postgresql.service redis-server.service
Requires=postgresql.service redis-server.service

[Service]
Type=oneshot
User=root
Group=root
WorkingDirectory=${app_dir}
EnvironmentFile=${env_file}
Environment=HOME=${INSTALL_DIR}
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=NPM_CONFIG_CACHE=${INSTALL_DIR}/.npm
Environment=XDG_CACHE_HOME=${INSTALL_DIR}/.cache
Environment=INCUDAL_APP_DIR=${app_dir}
Environment=INSTALL_DIR=${INSTALL_DIR}
Environment=SERVICE_NAME=${SERVICE_NAME}
ExecStart=/usr/bin/node ${app_dir}/server/dist/scripts/run-system-update-task.js %i
TimeoutStartSec=1800
StandardOutput=journal
StandardError=journal
SyslogIdentifier=incudal-online-update
EOF

  cat > /etc/systemd/system/incudal-online-rollback@.service <<EOF
[Unit]
Description=PayIncus online update rollback task %i
Documentation=https://github.com/${GITHUB_REPO}
After=network.target postgresql.service redis-server.service
Requires=postgresql.service redis-server.service

[Service]
Type=oneshot
User=root
Group=root
WorkingDirectory=${app_dir}
EnvironmentFile=${env_file}
Environment=HOME=${INSTALL_DIR}
Environment=NPM_CONFIG_CACHE=${INSTALL_DIR}/.npm
Environment=XDG_CACHE_HOME=${INSTALL_DIR}/.cache
Environment=INCUDAL_APP_DIR=${app_dir}
Environment=INSTALL_DIR=${INSTALL_DIR}
Environment=SERVICE_NAME=${SERVICE_NAME}
ExecStart=/usr/bin/node ${app_dir}/server/dist/scripts/rollback-system-update-task.js %i
TimeoutStartSec=900
StandardOutput=journal
StandardError=journal
SyslogIdentifier=incudal-online-rollback
EOF

  cat > /etc/sudoers.d/incudal-online-update <<EOF
Defaults:${RUN_USER} !requiretty
${RUN_USER} ALL=(root) NOPASSWD: ${systemctl_bin} start --no-block incudal-online-update@*.service, ${systemctl_bin} start --no-block incudal-online-rollback@*.service
EOF
  chmod 440 /etc/sudoers.d/incudal-online-update
  visudo -cf /etc/sudoers.d/incudal-online-update >/dev/null
}

main() {
  require_root
  [[ -d "$INSTALL_DIR" ]] || fail "install dir does not exist: $INSTALL_DIR"

  local version timestamp releases_dir release_dir current_link
  version="$(node -e "try { console.log(require('${INSTALL_DIR}/version.json').version || 'local') } catch { console.log('local') }" 2>/dev/null || echo local)"
  timestamp="$(date +%Y%m%d%H%M%S)"
  releases_dir="$INSTALL_DIR/releases"
  release_dir="$releases_dir/${version}-${timestamp}"
  current_link="$INSTALL_DIR/current"

  if [[ -L "$current_link" ]]; then
    log "atomic layout already exists: $current_link -> $(readlink "$current_link")"
  else
    log "creating initial release: $release_dir"
    mkdir -p "$releases_dir"
    copy_current_install_to_release "$release_dir"
    local next_link
    next_link="$releases_dir/.next-current-$timestamp"
    rm -f "$next_link"
    ln -s "$release_dir" "$next_link"
    mv -Tf "$next_link" "$current_link"
  fi

  mkdir -p "$INSTALL_DIR/update-logs" "$INSTALL_DIR/.npm" "$INSTALL_DIR/.cache"
  if id "$RUN_USER" >/dev/null 2>&1; then
    chown -R "$RUN_USER:$RUN_USER" "$INSTALL_DIR"
  fi

  write_systemd_units
  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME" >/dev/null 2>&1
  systemctl restart "$SERVICE_NAME"

  FRONTEND_URL="${FRONTEND_URL:-https://pay.payincus.com}" \
  ADMIN_FRONTEND_URL="${ADMIN_FRONTEND_URL:-https://admin.payincus.com}" \
  BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:3001}" \
    bash "$current_link/scripts/verify-split-host.sh"

  log "atomic OTA layout migration completed"
}

main "$@"
