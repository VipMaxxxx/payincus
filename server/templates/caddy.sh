#!/usr/bin/env bash
set -euo pipefail

log() { echo -e "\033[1;32m[+] $1\033[0m"; }
warn() { echo -e "\033[1;33m[!] $1\033[0m"; }
error() { echo -e "\033[1;31m[-] $1\033[0m"; }

CADDY_USER=""
CADDY_PASS=""
CADDY_PORT="8444"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --username) CADDY_USER="$2"; shift 2 ;;
    --password) CADDY_PASS="$2"; shift 2 ;;
    --port) CADDY_PORT="$2"; shift 2 ;;
    *) error "Unknown argument: $1"; exit 1 ;;
  esac
done

if [[ "$EUID" -ne 0 ]]; then error "Must run as root"; exit 1; fi
if [[ -z "$CADDY_USER" ]]; then error "Error: --username required"; exit 1; fi
if [[ -z "$CADDY_PASS" ]]; then error "Error: --password required"; exit 1; fi

if [[ -f /etc/os-release ]]; then
    source /etc/os-release
    if [[ "$ID" != "ubuntu" && "$ID" != "debian" ]]; then 
        error "Only Ubuntu/Debian supported"
        exit 1
    fi
else
    error "Cannot detect OS"; exit 1
fi

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

systemctl stop caddy || true

log "Generating password hash..."
PASS_HASH=$(caddy hash-password --plaintext "$CADDY_PASS")

log "Generating self-signed certificate..."
mkdir -p /etc/caddy
openssl req -x509 -newkey rsa:2048 \
    -keyout /etc/caddy/key.pem \
    -out /etc/caddy/cert.pem \
    -days 3650 -nodes \
    -subj "/CN=caddy-admin" \
    2>/dev/null
chmod 644 /etc/caddy/cert.pem /etc/caddy/key.pem

log "Configuring Caddy..."

mkdir -p /var/log/caddy

cat > /etc/caddy/Caddyfile <<EOF
{
    admin localhost:2019
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

chown -R caddy:caddy /etc/caddy
chown -R caddy:caddy /var/log/caddy
sync

log "Configuring systemd for API persistence (--resume)..."
mkdir -p /etc/systemd/system/caddy.service.d

cat > /etc/systemd/system/caddy.service.d/override.conf <<EOF
[Service]
ExecStart=
ExecStart=/usr/bin/caddy run --environ --config /etc/caddy/Caddyfile --resume
EOF

rm -f /var/lib/caddy/.config/caddy/autosave.json

systemctl daemon-reload

log "Starting Caddy service..."
systemctl enable caddy >/dev/null 2>&1 || true
systemctl stop caddy 2>/dev/null || true
sleep 1
systemctl start caddy


sleep 2
if ! ss -tlnp | grep -q ":${CADDY_PORT}"; then
    error "Caddy failed to bind to port ${CADDY_PORT}. Last 10 lines of logs:"
    journalctl -u caddy -n 10 --no-pager
    exit 1
fi

log "Caddy installation complete!"
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