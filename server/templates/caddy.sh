#!/usr/bin/env bash
set -euo pipefail

log() { echo -e "\033[1;32m[+] $1\033[0m"; }
warn() { echo -e "\033[1;33m[!] $1\033[0m"; }
error() { echo -e "\033[1;31m[-] $1\033[0m"; }

# ======== 面板动态注入区（密码只随脚本 stdin 传输，不进入进程参数） ========
INJECT_CADDY_PASSWORD_B64=""
# ============================================================================

readonly CADDY_CONFIG_DIR="/etc/caddy"
readonly CADDYFILE="/etc/caddy/Caddyfile"
readonly CADDY_CERT_FILE="/etc/caddy/cert.pem"
readonly CADDY_KEY_FILE="/etc/caddy/key.pem"
readonly CADDY_OVERRIDE_DIR="/etc/systemd/system/caddy.service.d"
readonly CADDY_OVERRIDE_FILE="/etc/systemd/system/caddy.service.d/override.conf"

CADDY_USER=""
CADDY_PASS=""
CADDY_PORT="8444"

is_valid_port() {
    local value="${1:-}"
    [[ "$value" =~ ^[0-9]+$ ]] || return 1
    (( ${#value} <= 5 )) || return 1
    local port=$((10#$value))
    (( port >= 1 && port <= 65535 ))
}

cert_matches_key() {
    local cert_digest=""
    local key_digest=""
    cert_digest=$(openssl x509 -in "$CADDY_CERT_FILE" -pubkey -noout 2>/dev/null \
        | openssl pkey -pubin -outform DER 2>/dev/null \
        | openssl dgst -sha256 2>/dev/null) || return 1
    key_digest=$(openssl pkey -in "$CADDY_KEY_FILE" -pubout -outform DER 2>/dev/null \
        | openssl dgst -sha256 2>/dev/null) || return 1
    [[ -n "$cert_digest" && "$cert_digest" == "$key_digest" ]]
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --username)
      if [[ $# -lt 2 ]]; then error "--username requires a value"; exit 1; fi
      CADDY_USER="$2"; shift 2 ;;
    --port)
      if [[ $# -lt 2 ]]; then error "--port requires a value"; exit 1; fi
      CADDY_PORT="$2"; shift 2 ;;
    *) error "Unknown argument: $1"; exit 1 ;;
  esac
done

# 所有入参必须在 apt、systemctl 或配置文件改动之前完成校验。
if [[ "$EUID" -ne 0 ]]; then error "Must run as root"; exit 1; fi
if [[ -z "$CADDY_USER" ]]; then error "Error: --username required"; exit 1; fi
if [[ ${#CADDY_USER} -gt 128 || ! "$CADDY_USER" =~ ^[A-Za-z0-9._@-]+$ ]]; then
    error "Username may only contain letters, digits, '.', '_', '@', and '-' (max 128 chars)"
    exit 1
fi
if ! is_valid_port "$CADDY_PORT"; then error "Port must be an integer from 1 to 65535"; exit 1; fi
if ! command -v systemctl >/dev/null 2>&1; then error "systemctl is required"; exit 1; fi

if [[ -n "${INJECT_CADDY_PASSWORD_B64:-}" ]]; then
    if ! CADDY_PASS=$(printf '%s' "$INJECT_CADDY_PASSWORD_B64" | base64 -d 2>/dev/null); then
        error "Injected Caddy password is invalid"
        exit 1
    fi
else
    if [[ ! -r /dev/tty ]]; then
        error "Password was not injected and no controlling terminal is available"
        exit 1
    fi
    echo -ne "Caddy admin password: " >/dev/tty
    IFS= read -r -s CADDY_PASS </dev/tty
    echo "" >/dev/tty
fi
if [[ -z "$CADDY_PASS" ]]; then error "Caddy admin password must not be empty"; exit 1; fi

if [[ -f /etc/os-release ]]; then
    source /etc/os-release
    if [[ "${ID:-}" != "ubuntu" && "${ID:-}" != "debian" ]]; then
        error "Only Ubuntu/Debian supported"
        exit 1
    fi
else
    error "Cannot detect OS"; exit 1
fi

OLD_SERVICE_ACTIVE=false
OLD_SERVICE_ENABLED=false
systemctl is-active --quiet caddy 2>/dev/null && OLD_SERVICE_ACTIVE=true
systemctl is-enabled --quiet caddy 2>/dev/null && OLD_SERVICE_ENABLED=true
CERT_TMP=""
KEY_TMP=""
CADDYFILE_NEW=""
OVERRIDE_NEW=""
CADDY_INSTALL_COMPLETE=false
ROLLBACK_HANDLED=false

cleanup_caddy_install() {
    local exit_status=$?
    rm -f "${CERT_TMP:-}" "${KEY_TMP:-}" "${CADDYFILE_NEW:-}" "${OVERRIDE_NEW:-}" 2>/dev/null || true
    if [[ "$exit_status" -ne 0 && "$CADDY_INSTALL_COMPLETE" != "true" && "$ROLLBACK_HANDLED" != "true" ]]; then
        set +e
        if [[ "$OLD_SERVICE_ENABLED" == "true" ]]; then
            systemctl enable caddy >/dev/null 2>&1
        else
            systemctl disable caddy >/dev/null 2>&1
        fi
        if [[ "$OLD_SERVICE_ACTIVE" == "true" ]]; then
            systemctl is-active --quiet caddy 2>/dev/null || systemctl start caddy >/dev/null 2>&1
        else
            systemctl stop caddy >/dev/null 2>&1
        fi
    fi
}
trap cleanup_caddy_install EXIT

log "Installing Caddy Web Server & Dependencies..."

export DEBIAN_FRONTEND=noninteractive

apt-get update -qq
apt-get install -y -qq curl debian-keyring debian-archive-keyring apt-transport-https openssl >/dev/null

if ! command -v caddy &> /dev/null; then
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
    apt-get update -qq
    apt-get install -y -qq caddy >/dev/null
    log "Caddy installed successfully"
else
    log "Caddy already installed, updating..."
    apt-get install -y -qq caddy >/dev/null
fi

log "Generating password hash..."
PASS_HASH=$(printf '%s' "$CADDY_PASS" | caddy hash-password)
unset CADDY_PASS INJECT_CADDY_PASSWORD_B64

install -d -o root -g caddy -m 0750 "$CADDY_CONFIG_DIR"
install -d -o caddy -g caddy -m 0750 /var/log/caddy

if [[ -e "$CADDY_CERT_FILE" || -e "$CADDY_KEY_FILE" ]]; then
    if [[ ! -f "$CADDY_CERT_FILE" || ! -f "$CADDY_KEY_FILE" ]]; then
        error "Only one of cert.pem/key.pem exists; refusing implicit certificate rotation"
        exit 1
    fi
    if ! openssl x509 -in "$CADDY_CERT_FILE" -noout -checkend 0 >/dev/null 2>&1 || \
       ! openssl pkey -in "$CADDY_KEY_FILE" -noout >/dev/null 2>&1 || \
       ! cert_matches_key; then
        error "Existing Caddy certificate/key is invalid or mismatched; explicit rotation is required"
        exit 1
    fi
    log "Existing valid Caddy certificate and key will be reused"
else
    log "Generating initial self-signed certificate..."
    CERT_TMP=$(mktemp "$CADDY_CONFIG_DIR/.cert.pem.XXXXXX")
    KEY_TMP=$(mktemp "$CADDY_CONFIG_DIR/.key.pem.XXXXXX")
    openssl req -x509 -newkey rsa:2048 \
        -keyout "$KEY_TMP" \
        -out "$CERT_TMP" \
        -days 3650 -nodes \
        -subj "/CN=caddy-admin" \
        2>/dev/null
    install -o root -g caddy -m 0640 "$CERT_TMP" "$CADDY_CERT_FILE"
    install -o root -g caddy -m 0640 "$KEY_TMP" "$CADDY_KEY_FILE"
    rm -f "$CERT_TMP" "$KEY_TMP"
fi
chown root:caddy "$CADDY_CERT_FILE" "$CADDY_KEY_FILE"
chmod 0640 "$CADDY_CERT_FILE" "$CADDY_KEY_FILE"
chmod 0750 "$CADDY_CONFIG_DIR"

log "Preparing and validating Caddy configuration..."
CADDYFILE_NEW=$(mktemp "$CADDY_CONFIG_DIR/.Caddyfile.new.XXXXXX")
install -d -o root -g root -m 0755 "$CADDY_OVERRIDE_DIR"
OVERRIDE_NEW=$(mktemp "$CADDY_OVERRIDE_DIR/.override.conf.new.XXXXXX")

cat > "$CADDYFILE_NEW" <<EOF
{
    admin localhost:2019
    auto_https disable_redirects
}

:${CADDY_PORT} {
    tls /etc/caddy/cert.pem /etc/caddy/key.pem

    basicauth {
        ${CADDY_USER} ${PASS_HASH}
    }

    reverse_proxy localhost:2019 {
        header_up Host localhost:2019
    }

    log {
        output file /var/log/caddy/admin-access.log {
            roll_size 10mb
            roll_keep 5
        }
    }
}
EOF

cat > "$OVERRIDE_NEW" <<'EOF'
[Service]
ExecStart=
ExecStart=/usr/bin/caddy run --environ --config /etc/caddy/Caddyfile --resume
EOF

chown root:caddy "$CADDYFILE_NEW"
chmod 0640 "$CADDYFILE_NEW"
chown root:root "$OVERRIDE_NEW"
chmod 0644 "$OVERRIDE_NEW"

if ! caddy validate --config "$CADDYFILE_NEW" --adapter caddyfile; then
    error "New Caddy configuration is invalid; existing service was not changed"
    exit 1
fi

HAD_OLD_CADDYFILE=false
HAD_OLD_OVERRIDE=false
CADDYFILE_BACKUP=""
OVERRIDE_BACKUP=""
BACKUP_TS=$(date +%Y%m%d%H%M%S)
if [[ -e "$CADDYFILE" ]]; then
    HAD_OLD_CADDYFILE=true
    CADDYFILE_BACKUP="${CADDYFILE}.before-incudal.${BACKUP_TS}"
    cp -a "$CADDYFILE" "$CADDYFILE_BACKUP"
fi
if [[ -e "$CADDY_OVERRIDE_FILE" ]]; then
    HAD_OLD_OVERRIDE=true
    OVERRIDE_BACKUP="${CADDY_OVERRIDE_FILE}.before-incudal.${BACKUP_TS}"
    cp -a "$CADDY_OVERRIDE_FILE" "$OVERRIDE_BACKUP"
fi

SWITCH_OK=true
mv -f "$CADDYFILE_NEW" "$CADDYFILE" || SWITCH_OK=false
if [[ "$SWITCH_OK" == "true" ]]; then
    mv -f "$OVERRIDE_NEW" "$CADDY_OVERRIDE_FILE" || SWITCH_OK=false
fi
if [[ "$SWITCH_OK" == "true" ]] && ! systemctl daemon-reload; then SWITCH_OK=false; fi
if [[ "$SWITCH_OK" == "true" ]] && ! systemctl enable caddy >/dev/null 2>&1; then SWITCH_OK=false; fi
if [[ "$SWITCH_OK" == "true" ]] && ! systemctl restart caddy; then SWITCH_OK=false; fi

MAIN_PID=""
LISTENER=""
if [[ "$SWITCH_OK" == "true" ]]; then
    sleep 2
    MAIN_PID=$(systemctl show -p MainPID --value caddy 2>/dev/null || true)
    LISTENER=$(ss -H -ltnp 2>/dev/null | awk -v port="$CADDY_PORT" '$4 ~ (":" port "$") { print }' || true)
    CADDY_UID=$(id -u caddy 2>/dev/null || true)
    if ! systemctl is-enabled --quiet caddy 2>/dev/null || \
       ! systemctl is-active --quiet caddy 2>/dev/null || \
       [[ ! "$MAIN_PID" =~ ^[1-9][0-9]*$ ]] || \
       [[ -z "$CADDY_UID" || ! -d "/proc/${MAIN_PID}" ]] || \
       [[ "$(stat -c %u "/proc/${MAIN_PID}" 2>/dev/null || true)" != "$CADDY_UID" ]] || \
       [[ -z "$LISTENER" ]] || ! grep -Fq "pid=${MAIN_PID}," <<<"$LISTENER"; then
        SWITCH_OK=false
    fi
fi

if [[ "$SWITCH_OK" != "true" ]]; then
    error "Caddy failed enabled/active/listener/owner validation; restoring previous configuration"
    systemctl stop caddy >/dev/null 2>&1 || true
    RESTORE_OK=true
    if [[ "$HAD_OLD_CADDYFILE" == "true" && -e "$CADDYFILE_BACKUP" ]]; then
        mv -f "$CADDYFILE_BACKUP" "$CADDYFILE" || RESTORE_OK=false
    else
        rm -f "$CADDYFILE" || RESTORE_OK=false
    fi
    if [[ "$HAD_OLD_OVERRIDE" == "true" && -e "$OVERRIDE_BACKUP" ]]; then
        mv -f "$OVERRIDE_BACKUP" "$CADDY_OVERRIDE_FILE" || RESTORE_OK=false
    else
        rm -f "$CADDY_OVERRIDE_FILE" || RESTORE_OK=false
    fi
    systemctl daemon-reload >/dev/null 2>&1 || RESTORE_OK=false
    if [[ "$OLD_SERVICE_ENABLED" == "true" ]]; then
        systemctl enable caddy >/dev/null 2>&1 || RESTORE_OK=false
    else
        systemctl disable caddy >/dev/null 2>&1 || true
    fi
    if [[ "$OLD_SERVICE_ACTIVE" == "true" ]]; then
        systemctl restart caddy >/dev/null 2>&1 || RESTORE_OK=false
        systemctl is-active --quiet caddy 2>/dev/null || RESTORE_OK=false
    else
        systemctl stop caddy >/dev/null 2>&1 || true
    fi
    if [[ "$RESTORE_OK" == "true" ]]; then
        error "New Caddy configuration failed; previous configuration and service state were restored"
    else
        error "Automatic rollback was incomplete; preserved backup paths must be inspected immediately"
    fi
    ROLLBACK_HANDLED=true
    exit 1
fi

CADDY_INSTALL_COMPLETE=true
log "Caddy installation complete!"
if [[ -n "$CADDYFILE_BACKUP" ]]; then
    warn "Previous Caddyfile backup preserved at: ${CADDYFILE_BACKUP}"
fi
echo ""
echo -e "\033[1;36m========================================\033[0m"
echo -e "\033[1;36m  Caddy Reverse Proxy Ready\033[0m"
echo -e "\033[1;36m========================================\033[0m"
echo -e "\033[1;33m  API Port:     ${CADDY_PORT}\033[0m"
echo -e "\033[1;33m  Username:     ${CADDY_USER}\033[0m"
echo -e "\033[1;33m  Auth:         Basic Auth + HTTPS\033[0m"
echo -e "\033[1;33m  Persistence:  API (--resume mode)\033[0m"
echo -e "\033[1;36m========================================\033[0m"
echo ""
echo -e "\033[1;32mPlease return to the panel and confirm the installation.\033[0m"
