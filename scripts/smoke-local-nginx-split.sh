#!/usr/bin/env bash
set -Eeuo pipefail

NGINX_BIN="${NGINX_BIN:-nginx}"
LOCAL_NGINX_PORT="${LOCAL_NGINX_PORT:-3100}"
BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:3001}"
CLIENT_DIST="${CLIENT_DIST:-$(pwd)/client/dist}"

fail() {
  printf '[smoke-local-nginx-split] ERROR: %s\n' "$*" >&2
  exit 1
}

trim_slash() {
  local value="$1"
  printf '%s' "${value%/}"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing command: $1"
}

require_command "$NGINX_BIN"
require_command curl
if [[ "${RUN_SPLIT_AUTH_SMOKE:-true}" == "true" ]]; then
  require_command pnpm
fi
if [[ "${RUN_RECHARGE_CALLBACK_SMOKE:-true}" == "true" ]]; then
  require_command pnpm
fi
if [[ "${RUN_AGENT_HEARTBEAT_SMOKE:-true}" == "true" ]]; then
  require_command pnpm
fi

BACKEND_URL="$(trim_slash "$BACKEND_URL")"
FRONTEND_URL="http://127.0.0.1:${LOCAL_NGINX_PORT}"

[[ -d "$CLIENT_DIST" ]] || fail "Missing client dist directory: $CLIENT_DIST. Run pnpm build first."
curl -fsS --max-time 5 "${BACKEND_URL}/api/health" >/dev/null \
  || fail "Backend is not reachable at ${BACKEND_URL}/api/health"

tmp_dir="$(mktemp -d)"
config_file="${tmp_dir}/nginx.conf"
trap '"$NGINX_BIN" -s quit -c "$config_file" -p "$tmp_dir" >/dev/null 2>&1 || true; rm -rf "$tmp_dir"' EXIT

mime_include=''
for candidate in \
  "${NGINX_MIME_TYPES:-}" \
  "/opt/homebrew/etc/nginx/mime.types" \
  "/usr/local/etc/nginx/mime.types" \
  "/etc/nginx/mime.types"; do
  if [[ -n "$candidate" && -f "$candidate" ]]; then
    mime_include="include ${candidate};"
    break
  fi
done

cat > "$config_file" <<NGINX
worker_processes 1;
pid ${tmp_dir}/nginx.pid;
error_log ${tmp_dir}/error.log info;

events {
  worker_connections 128;
}

http {
  ${mime_include}
  default_type application/octet-stream;
  access_log ${tmp_dir}/access.log;

  map \$http_x_forwarded_proto \$incudal_forwarded_proto {
    default \$http_x_forwarded_proto;
    "" \$scheme;
  }

  map \$http_x_forwarded_host \$incudal_forwarded_host {
    default \$http_x_forwarded_host;
    "" \$host;
  }

  server {
    listen 127.0.0.1:${LOCAL_NGINX_PORT};
    server_name 127.0.0.1 localhost;

    root ${CLIENT_DIST};
    index index.html;
    client_max_body_size 100m;

    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: http: https: https://kkksr.com https://api.dicebear.com https://dicebear.incudal.com https://*.githubusercontent.com https://avatars.githubusercontent.com https://lh3.googleusercontent.com; connect-src 'self' ws: wss: https://challenges.cloudflare.com https://cloudflareinsights.com https://api.dicebear.com https://dicebear.incudal.com; frame-src 'self' https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;

    location = /healthz {
      add_header Content-Type text/plain;
      return 200 "ok\n";
    }

    location /api/ws/ {
      proxy_pass ${BACKEND_URL}/api/ws/;
      proxy_http_version 1.1;
      proxy_set_header Upgrade \$http_upgrade;
      proxy_set_header Connection "upgrade";
      proxy_set_header Host \$host;
      proxy_set_header X-Forwarded-Host \$incudal_forwarded_host;
      proxy_set_header X-Real-IP \$remote_addr;
      proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto \$incudal_forwarded_proto;
      proxy_read_timeout 3600s;
      proxy_send_timeout 3600s;
      proxy_buffering off;
    }

    location /api/ {
      proxy_pass ${BACKEND_URL}/api/;
      proxy_http_version 1.1;
      proxy_set_header Host \$host;
      proxy_set_header X-Forwarded-Host \$incudal_forwarded_host;
      proxy_set_header X-Real-IP \$remote_addr;
      proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto \$incudal_forwarded_proto;
      proxy_read_timeout 300s;
      proxy_send_timeout 300s;
    }

    location / {
      try_files \$uri \$uri/ /index.html;
    }
  }
}
NGINX

"$NGINX_BIN" -t -c "$config_file" -p "$tmp_dir" >/dev/null
"$NGINX_BIN" -c "$config_file" -p "$tmp_dir"

for _ in $(seq 1 50); do
  if curl -fsS --max-time 1 "${FRONTEND_URL}/healthz" >/dev/null 2>&1; then
    FRONTEND_URL="$FRONTEND_URL" BACKEND_URL="$BACKEND_URL" bash scripts/verify-split-host.sh
    if [[ "${RUN_SPLIT_AUTH_SMOKE:-true}" == "true" ]]; then
      SMOKE_FRONTEND_URL="$FRONTEND_URL" \
        SMOKE_API_BASE_URL="$FRONTEND_URL" \
        SMOKE_BACKEND_URL="$BACKEND_URL" \
        pnpm --filter server smoke:split:auth
    fi
    if [[ "${RUN_RECHARGE_CALLBACK_SMOKE:-true}" == "true" ]]; then
      SMOKE_API_BASE_URL="$FRONTEND_URL" \
        BACKEND_URL="$BACKEND_URL" \
        pnpm --filter server smoke:recharge-callback
    fi
    if [[ "${RUN_AGENT_HEARTBEAT_SMOKE:-true}" == "true" ]]; then
      SMOKE_API_BASE_URL="$FRONTEND_URL" \
        BACKEND_URL="$BACKEND_URL" \
        pnpm --filter server smoke:agent-heartbeat
    fi
    if [[ "${RUN_AGENT_RELEASE_SMOKE:-true}" == "true" ]]; then
      SMOKE_API_BASE_URL="$FRONTEND_URL" \
        BACKEND_URL="$BACKEND_URL" \
        pnpm --filter server smoke:agent-release
    fi
    exit 0
  fi
  sleep 0.1
done

fail "Temporary nginx did not become ready on ${FRONTEND_URL}"
