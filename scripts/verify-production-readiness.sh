#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE="${ENV_FILE:-.env}"
RUN_LIVE_CHECKS="${RUN_LIVE_CHECKS:-1}"
RUN_DB_CHECKS="${RUN_DB_CHECKS:-$RUN_LIVE_CHECKS}"
ALLOW_MISSING_AGENT_RELEASE="${ALLOW_MISSING_AGENT_RELEASE:-false}"

log() {
  printf '[verify-production] %s\n' "$*"
}

warn() {
  printf '[verify-production] WARN: %s\n' "$*" >&2
}

fail() {
  printf '[verify-production] ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing command: $1"
}

trim_slash() {
  local value="$1"
  printf '%s' "${value%/}"
}

env_file_value() {
  local key="$1"
  local line value

  if [[ ! -f "$ENV_FILE" ]]; then
    return 0
  fi

  line="$(
    grep -E "^[[:space:]]*(export[[:space:]]+)?${key}=" "$ENV_FILE" 2>/dev/null \
      | tail -n 1 \
      || true
  )"
  [[ -n "$line" ]] || return 0

  line="${line#"${line%%[![:space:]]*}"}"
  line="${line#export }"
  value="${line#*=}"
  value="${value%%#*}"
  value="${value%"${value##*[![:space:]]}"}"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  printf '%s' "$value"
}

config_value() {
  local key="$1"
  local env_value="${!key:-}"
  if [[ -n "$env_value" ]]; then
    printf '%s' "$env_value"
    return 0
  fi
  env_file_value "$key"
}

require_value() {
  local key="$1"
  local value="$2"
  [[ -n "$value" ]] || fail "${key} is required"
}

require_equals() {
  local key="$1"
  local actual="$2"
  local expected="$3"
  [[ "$actual" == "$expected" ]] || fail "${key} must be ${expected}, got ${actual:-<empty>}"
}

require_sha256() {
  local key="$1"
  local value="$2"
  [[ "$value" =~ ^[A-Fa-f0-9]{64}$ ]] || fail "${key} must be a 64-character hex sha256"
}

validate_http_url() {
  local key="$1"
  local value="$2"
  node - "$key" "$value" <<'NODE'
const [key, value] = process.argv.slice(2)
let url
try {
  url = new URL(value)
} catch {
  console.error(`${key} must be a valid URL`)
  process.exit(1)
}
if (url.protocol !== 'http:' && url.protocol !== 'https:') {
  console.error(`${key} must use HTTP(S)`)
  process.exit(1)
}
NODE
}

validate_https_public_url() {
  local key="$1"
  local value="$2"
  node - "$key" "$value" <<'NODE'
const net = require('node:net')
const [key, value] = process.argv.slice(2)
let url
try {
  url = new URL(value)
} catch {
  console.error(`${key} must be a valid URL`)
  process.exit(1)
}
if (url.protocol !== 'https:') {
  console.error(`${key} must use HTTPS in production`)
  process.exit(1)
}
const host = url.hostname.toLowerCase()
if (!host || host === 'localhost' || host.endsWith('.localhost') || !host.includes('.')) {
  console.error(`${key} must use a browser-accessible public hostname`)
  process.exit(1)
}
const ipVersion = net.isIP(host)
if (ipVersion === 4) {
  const parts = host.split('.').map(Number)
  const privateIp = parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  if (privateIp) {
    console.error(`${key} must not use a private or loopback IP in production`)
    process.exit(1)
  }
}
if (ipVersion === 6) {
  const normalized = host.replace(/^\[/, '').replace(/\]$/, '')
  if (normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:')) {
    console.error(`${key} must not use a private or loopback IPv6 address in production`)
    process.exit(1)
  }
}
NODE
}

validate_ip_whitelist() {
  local value="$1"
  node - "$value" <<'NODE'
const net = require('node:net')
const value = process.argv[2] || ''
const ips = value.split(',').map(ip => ip.trim()).filter(Boolean)
for (const ip of ips) {
  const normalized = ip.startsWith('::ffff:') ? ip.slice(7) : ip
  if (net.isIP(normalized) === 0) {
    console.error(`PAYMENT_CALLBACK_IP_WHITELIST contains an invalid IP: ${ip}`)
    process.exit(1)
  }
}
NODE
}

require_command node
require_command curl

NODE_ENV_VALUE="$(config_value NODE_ENV)"
PORT_VALUE="$(config_value PORT)"
SERVE_STATIC_CLIENT_VALUE="$(config_value SERVE_STATIC_CLIENT)"
VITE_API_BASE_URL_VALUE="$(config_value VITE_API_BASE_URL)"
TRUST_PROXY_VALUE="$(config_value TRUST_PROXY)"
FRONTEND_URL_VALUE="$(trim_slash "$(config_value FRONTEND_URL)")"
SITE_URL_VALUE="$(trim_slash "$(config_value SITE_URL)")"
PAYMENT_CALLBACK_BASE_URL_VALUE="$(trim_slash "$(config_value PAYMENT_CALLBACK_BASE_URL)")"
PAYMENT_CALLBACK_IP_WHITELIST_VALUE="$(config_value PAYMENT_CALLBACK_IP_WHITELIST)"
PAYMENT_CALLBACK_SKIP_IP_WHITELIST_VALUE="$(config_value PAYMENT_CALLBACK_SKIP_IP_WHITELIST)"
BACKEND_URL_VALUE="$(trim_slash "${BACKEND_URL:-$(config_value BACKEND_URL)}")"
AGENT_RELEASE_REPOSITORY_VALUE="$(config_value INCUDAL_AGENT_RELEASE_REPOSITORY)"
AGENT_RELEASE_DIR_VALUE="$(config_value INCUDAL_AGENT_RELEASE_DIR)"
AGENT_BINARY_URL_VALUE="$(config_value INCUDAL_AGENT_BINARY_URL)"
AGENT_BINARY_SHA256_VALUE="$(config_value INCUDAL_AGENT_BINARY_SHA256)"

require_equals NODE_ENV "$NODE_ENV_VALUE" production
require_equals PORT "$PORT_VALUE" 3001
require_equals SERVE_STATIC_CLIENT "$SERVE_STATIC_CLIENT_VALUE" false
require_equals VITE_API_BASE_URL "$VITE_API_BASE_URL_VALUE" /api
require_equals TRUST_PROXY "$TRUST_PROXY_VALUE" true

require_value FRONTEND_URL "$FRONTEND_URL_VALUE"
require_value SITE_URL "$SITE_URL_VALUE"
require_value PAYMENT_CALLBACK_BASE_URL "$PAYMENT_CALLBACK_BASE_URL_VALUE"
validate_https_public_url FRONTEND_URL "$FRONTEND_URL_VALUE"
validate_https_public_url SITE_URL "$SITE_URL_VALUE"
validate_https_public_url PAYMENT_CALLBACK_BASE_URL "$PAYMENT_CALLBACK_BASE_URL_VALUE"

if [[ "$SITE_URL_VALUE" != "$FRONTEND_URL_VALUE" ]]; then
  warn "SITE_URL differs from FRONTEND_URL; verify OAuth and public links intentionally use ${SITE_URL_VALUE}"
fi
if [[ "$PAYMENT_CALLBACK_BASE_URL_VALUE" != "$FRONTEND_URL_VALUE" ]]; then
  warn "PAYMENT_CALLBACK_BASE_URL differs from FRONTEND_URL; verify the payment provider can reach ${PAYMENT_CALLBACK_BASE_URL_VALUE}"
fi
require_equals PAYMENT_CALLBACK_SKIP_IP_WHITELIST "$PAYMENT_CALLBACK_SKIP_IP_WHITELIST_VALUE" false
if [[ -n "$PAYMENT_CALLBACK_IP_WHITELIST_VALUE" ]]; then
  validate_ip_whitelist "$PAYMENT_CALLBACK_IP_WHITELIST_VALUE"
else
  warn "PAYMENT_CALLBACK_IP_WHITELIST is empty; provider-specific defaults apply only where the backend implements them"
fi

if [[ -n "$AGENT_BINARY_URL_VALUE" || -n "$AGENT_BINARY_SHA256_VALUE" ]]; then
  require_value INCUDAL_AGENT_BINARY_URL "$AGENT_BINARY_URL_VALUE"
  require_value INCUDAL_AGENT_BINARY_SHA256 "$AGENT_BINARY_SHA256_VALUE"
  validate_http_url INCUDAL_AGENT_BINARY_URL "$AGENT_BINARY_URL_VALUE"
  require_sha256 INCUDAL_AGENT_BINARY_SHA256 "$AGENT_BINARY_SHA256_VALUE"
elif [[ -n "$AGENT_RELEASE_DIR_VALUE" ]]; then
  [[ "$AGENT_RELEASE_DIR_VALUE" == /* ]] || fail "INCUDAL_AGENT_RELEASE_DIR must be an absolute path"
elif [[ -z "$AGENT_RELEASE_REPOSITORY_VALUE" ]]; then
  fail "INCUDAL_AGENT_RELEASE_REPOSITORY or INCUDAL_AGENT_RELEASE_DIR is required unless INCUDAL_AGENT_BINARY_URL and INCUDAL_AGENT_BINARY_SHA256 are configured"
fi

log "Static production environment checks passed"

if [[ "$RUN_DB_CHECKS" == "1" ]]; then
  log "Running production database readiness checks"
  ENV_FILE="$ENV_FILE" pnpm --filter server verify:production-db
else
  log "Database checks skipped because RUN_DB_CHECKS=${RUN_DB_CHECKS}"
fi

if [[ "$RUN_LIVE_CHECKS" != "1" ]]; then
  log "Live checks skipped because RUN_LIVE_CHECKS=${RUN_LIVE_CHECKS}"
  exit 0
fi

if [[ -z "$BACKEND_URL_VALUE" ]]; then
  BACKEND_URL_VALUE="http://127.0.0.1:${PORT_VALUE}"
fi

FRONTEND_URL="$FRONTEND_URL_VALUE" BACKEND_URL="$BACKEND_URL_VALUE" bash scripts/verify-split-host.sh

if [[ -z "$AGENT_BINARY_URL_VALUE" ]]; then
  manifest_body="$(mktemp)"
  manifest_headers="$(mktemp)"
  trap 'rm -f "$manifest_body" "$manifest_headers"' EXIT
  manifest_status="$(
    curl -sS --max-time 15 \
      -H 'Accept: application/json' \
      -D "$manifest_headers" \
      -o "$manifest_body" \
      -w '%{http_code}' \
      "${FRONTEND_URL_VALUE}/api/agent/manifest.json" \
      || true
  )"

  if [[ "$manifest_status" == "404" && "$ALLOW_MISSING_AGENT_RELEASE" == "true" ]]; then
    warn "Agent manifest returned 404, allowed by ALLOW_MISSING_AGENT_RELEASE=true"
  elif [[ "$manifest_status" != "200" ]]; then
    fail "Agent manifest must return 200 before production Agent install, got HTTP ${manifest_status}"
  else
    node - "$manifest_body" <<'NODE'
const fs = require('node:fs')
const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const sha256Pattern = /^[a-f0-9]{64}$/i
if (!manifest.version || !manifest.files) {
  console.error('Agent manifest must include version and files')
  process.exit(1)
}
for (const platform of ['linux-amd64', 'linux-arm64']) {
  const file = manifest.files[platform]
  if (!file || !file.name || !sha256Pattern.test(file.sha256 || '')) {
    console.error(`Agent manifest must include ${platform} name and sha256`)
    process.exit(1)
  }
}
NODE
    log "Agent manifest check passed"
  fi
else
  log "Agent manifest check skipped because INCUDAL_AGENT_BINARY_URL is configured"
fi

log "Production readiness verification passed"
