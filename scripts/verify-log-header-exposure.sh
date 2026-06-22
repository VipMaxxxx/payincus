#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE="${ENV_FILE:-.env}"
FRONTEND_URL="${FRONTEND_URL:-}"
BACKEND_URL="${BACKEND_URL:-}"
JOURNAL_UNIT="${JOURNAL_UNIT:-incudal-backend}"
JOURNAL_SINCE="${JOURNAL_SINCE:-24 hours ago}"
LOG_SCAN_FILES="${LOG_SCAN_FILES:-/var/log/nginx/access.log /var/log/nginx/error.log}"
SECRET_SCAN_KEYS="${SECRET_SCAN_KEYS:-ADMIN_PASSWORD JWT_SECRET COOKIE_SECRET ENCRYPTION_KEY DATABASE_URL INCUDAL_AGENT_RELEASE_TOKEN}"

log() {
  printf '[verify-log-header] %s\n' "$*"
}

fail() {
  printf '[verify-log-header] ERROR: %s\n' "$*" >&2
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

assert_header() {
  local headers="$1"
  local header="$2"
  local pattern="$3"

  tr -d '\r' < "$headers" | grep -Eiq "^${header}:[[:space:]]*${pattern}" \
    || fail "frontend response missing expected header: ${header}"
}

require_command curl
require_command grep

FRONTEND_URL="$(trim_slash "${FRONTEND_URL:-$(config_value FRONTEND_URL)}")"
BACKEND_URL="$(trim_slash "${BACKEND_URL:-$(config_value BACKEND_URL)}")"
PORT_VALUE="$(config_value PORT)"

[[ -n "$FRONTEND_URL" ]] || fail "FRONTEND_URL is required"
if [[ -z "$BACKEND_URL" ]]; then
  BACKEND_URL="http://127.0.0.1:${PORT_VALUE:-3001}"
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

log "Checking frontend headers: ${FRONTEND_URL}/"
curl -fsS --max-time 15 -D "$tmp_dir/frontend.headers" "$FRONTEND_URL/" -o "$tmp_dir/frontend.html" \
  || fail "frontend header check failed: ${FRONTEND_URL}/"
assert_header "$tmp_dir/frontend.headers" "content-security-policy" ".*default-src 'self'.*frame-ancestors 'none'"
assert_header "$tmp_dir/frontend.headers" "x-content-type-options" "nosniff"
assert_header "$tmp_dir/frontend.headers" "x-frame-options" "DENY"
assert_header "$tmp_dir/frontend.headers" "referrer-policy" "strict-origin-when-cross-origin"

log "Checking backend does not serve frontend HTML: ${BACKEND_URL}/"
backend_status="$(
  curl -sS --max-time 10 -w '%{http_code}' "$BACKEND_URL/" -o "$tmp_dir/backend-root.txt" \
    || true
)"
if [[ "$backend_status" == "200" ]] && grep -Eiq '<div id="?app"?|<!doctype html' "$tmp_dir/backend-root.txt"; then
  fail "backend root served frontend HTML; SERVE_STATIC_CLIENT may be enabled"
fi

log "Scanning logs without printing secret values"
log_bundle="$tmp_dir/log-bundle.txt"
: > "$log_bundle"
if command -v journalctl >/dev/null 2>&1; then
  journalctl -u "$JOURNAL_UNIT" --since "$JOURNAL_SINCE" --no-pager -o cat >> "$log_bundle" 2>/dev/null || true
fi
for file in $LOG_SCAN_FILES; do
  if [[ -r "$file" ]]; then
    cat "$file" >> "$log_bundle" 2>/dev/null || true
  fi
done

for key in $SECRET_SCAN_KEYS; do
  value="$(config_value "$key")"
  if [[ -n "$value" && "${#value}" -ge 8 ]]; then
    if grep -Fq -- "$value" "$log_bundle"; then
      fail "log output contains the current value of ${key}"
    fi
    log "Secret value not found in logs: ${key}"
  else
    log "Secret value skipped because empty or short: ${key}"
  fi
done

if grep -Eiq '(ADMIN_PASSWORD=|JWT_SECRET=|COOKIE_SECRET=|ENCRYPTION_KEY=|DATABASE_URL=postgresql://|refreshToken=|Bearer [A-Za-z0-9_-]{12,}|merchantPrivateKey|merchant_private_key|smtpPassword|botToken|webhookSecret)' "$log_bundle"; then
  fail "log output contains a sensitive-looking token, credential assignment, or secret field"
fi

log "Log/header exposure verification passed"
