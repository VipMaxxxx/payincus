#!/usr/bin/env bash
set -Eeuo pipefail

FRONTEND_URL="${FRONTEND_URL:-http://127.0.0.1}"
BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:3001}"

trim_slash() {
  local value="$1"
  printf '%s' "${value%/}"
}

log() {
  printf '[verify-split-host] %s\n' "$*"
}

fail() {
  printf '[verify-split-host] ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing command: $1"
}

fetch_url() {
  local name="$1"
  local url="$2"
  local output="$3"

  log "Checking $name: $url"
  curl -fsS --max-time 10 "$url" -o "$output" || fail "$name check failed: $url"
}

fetch_url_with_headers() {
  local name="$1"
  local url="$2"
  local output="$3"
  local headers="$4"

  log "Checking $name: $url"
  curl -fsS --max-time 10 -D "$headers" "$url" -o "$output" || fail "$name check failed: $url"
}

fetch_static_asset() {
  local asset_path="$1"
  local output="$2"

  if [[ "$asset_path" != /* ]]; then
    return 0
  fi

  case "$asset_path" in
    *.js|*.css)
      fetch_url "frontend static asset" "${FRONTEND_URL}${asset_path}" "$output"
      ;;
    *)
      return 0
      ;;
  esac
}

fetch_websocket_probe() {
  local name="$1"
  local url="$2"
  local output="$3"
  local error_output="$4"
  local status

  log "Checking $name: $url"
  set +e
  curl --http1.1 -sS -i -N --max-time 10 \
    -H "Connection: Upgrade" \
    -H "Upgrade: websocket" \
    -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
    -H "Sec-WebSocket-Version: 13" \
    -H "Origin: ${FRONTEND_URL}" \
    "$url" > "$output" 2> "$error_output"
  status=$?
  set -e

  if [[ "$status" -ne 0 && "$status" -ne 28 ]]; then
    fail "$name WebSocket probe failed: $(tr '\n' ' ' < "$error_output")"
  fi
}

assert_header() {
  local headers="$1"
  local header="$2"
  local pattern="$3"

  tr -d '\r' < "$headers" | grep -Eiq "^${header}:[[:space:]]*${pattern}" \
    || fail "frontend index missing expected header: ${header}"
}

assert_no_frontend_backend_origin_leaks() {
  local file="$1"
  local name="$2"

  if grep -Eq 'https?://(localhost|127\.0\.0\.1):(3001|8888|43173)\b|VITE_API_BASE_URL' "$file"; then
    fail "${name} contains a hardcoded backend/dev API origin"
  fi
}

require_command curl

FRONTEND_URL="$(trim_slash "$FRONTEND_URL")"
BACKEND_URL="$(trim_slash "$BACKEND_URL")"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

fetch_url "frontend health" "$FRONTEND_URL/healthz" "$tmp_dir/frontend-health.txt"
grep -q '^ok' "$tmp_dir/frontend-health.txt" || fail "frontend /healthz did not return ok"

fetch_url_with_headers "frontend index" "$FRONTEND_URL/" "$tmp_dir/frontend.html" "$tmp_dir/frontend.headers"
grep -Eq '<div id="?app"?' "$tmp_dir/frontend.html" || fail "frontend index does not look like the Vue app"
assert_no_frontend_backend_origin_leaks "$tmp_dir/frontend.html" "frontend index"
assert_header "$tmp_dir/frontend.headers" "content-security-policy" ".*default-src 'self'.*frame-ancestors 'none'"
assert_header "$tmp_dir/frontend.headers" "x-content-type-options" "nosniff"
assert_header "$tmp_dir/frontend.headers" "x-frame-options" "DENY"
assert_header "$tmp_dir/frontend.headers" "referrer-policy" "strict-origin-when-cross-origin"

grep -Eo '(src|href)="[^"]+"' "$tmp_dir/frontend.html" \
  | sed -E 's/^(src|href)="([^"]+)"/\2/' \
  | sort -u > "$tmp_dir/frontend-assets.txt"

asset_index=0
while IFS= read -r asset_path; do
  asset_index=$((asset_index + 1))
  asset_output="$tmp_dir/frontend-asset-${asset_index}.txt"
  fetch_static_asset "$asset_path" "$asset_output"
  if [[ -s "$asset_output" ]]; then
    assert_no_frontend_backend_origin_leaks "$asset_output" "frontend asset ${asset_path}"
  fi
done < "$tmp_dir/frontend-assets.txt"

fetch_url "frontend proxied API" "$FRONTEND_URL/api/health" "$tmp_dir/frontend-api.json"
grep -q '"status":"ok"' "$tmp_dir/frontend-api.json" || fail "frontend proxied /api/health did not return ok"

fetch_websocket_probe "frontend proxied WebSocket" "$FRONTEND_URL/api/ws/instances/1/terminal?ticket=invalid" "$tmp_dir/frontend-ws.txt" "$tmp_dir/frontend-ws.err"
grep -Eq '^HTTP/[0-9.]+ 101 ' "$tmp_dir/frontend-ws.txt" || fail "frontend /api/ws did not upgrade to WebSocket"
grep -Eiq '^upgrade:[[:space:]]*websocket' "$tmp_dir/frontend-ws.txt" || fail "frontend /api/ws response missing WebSocket upgrade header"

fetch_url "backend direct API" "$BACKEND_URL/api/health" "$tmp_dir/backend-api.json"
grep -q '"status":"ok"' "$tmp_dir/backend-api.json" || fail "backend direct /api/health did not return ok"

log "Host-process split deployment verification passed"
