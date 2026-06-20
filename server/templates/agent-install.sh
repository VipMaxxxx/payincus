#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="incudal-agent"
CONFIG_DIR="${INCUDAL_CONFIG_DIR:-/etc/incudal-agent}"
CONFIG_FILE="${INCUDAL_CONFIG_FILE:-${CONFIG_DIR}/config.yaml}"
INSTALL_DIR="${INCUDAL_INSTALL_DIR:-/usr/local/bin}"
BIN_PATH="${INCUDAL_AGENT_BIN:-${INSTALL_DIR}/incudal-agent}"
SERVICE_FILE="${INCUDAL_SERVICE_FILE:-/etc/systemd/system/${SERVICE_NAME}.service}"
HEARTBEAT_INTERVAL="${INCUDAL_HEARTBEAT_INTERVAL_SECONDS:-30}"
REQUEST_TIMEOUT="${INCUDAL_REQUEST_TIMEOUT_SECONDS:-10}"
DRY_RUN="${INCUDAL_AGENT_DRY_RUN:-0}"
INSTALL_CONFIG_PATH=""

fail() {
  echo "error: $*" >&2
  exit 1
}

need_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    fail "${name} is required"
  fi
}

detect_os() {
  case "$(uname -s)" in
    Linux) echo "linux" ;;
    *) fail "unsupported OS: $(uname -s)" ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64) echo "amd64" ;;
    aarch64|arm64) echo "arm64" ;;
    *) fail "unsupported architecture: $(uname -m)" ;;
  esac
}

run() {
  if [ "${DRY_RUN}" = "1" ]; then
    printf '+'
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi
  "$@"
}

write_file() {
  local path="$1"
  local mode="$2"
  local owner="$3"
  local tmp

  if [ "${DRY_RUN}" = "1" ]; then
    echo "+ write ${path} mode=${mode} owner=${owner}"
    sed 's/^/| /'
    return 0
  fi

  tmp="$(mktemp)"
  cat > "${tmp}"
  install -d -m 0755 "$(dirname "${path}")"
  install -m "${mode}" -o "${owner%%:*}" -g "${owner##*:}" "${tmp}" "${path}"
  rm -f "${tmp}"
}

download_binary_once() {
  local binary_url="$1"
  local target="$2"
  local expected_sha256="${3:-}"
  local binary_path="${binary_url%%\?*}"
  binary_path="${binary_path%%#*}"

  if [ "${DRY_RUN}" = "1" ]; then
    echo "+ download ${binary_url} -> ${target}"
    if [ -n "${expected_sha256}" ]; then
      echo "+ verify sha256 ${expected_sha256} ${target}.download"
    fi
    return 0
  fi

  install -d -m 0755 "$(dirname "${target}")"
  if [[ "${binary_url}" == file://* ]]; then
    install -m 0644 "${binary_url#file://}" "${target}.download" || return 1
  else
    command -v curl >/dev/null 2>&1 || fail "curl is required"
    curl -fsSL "${binary_url}" -o "${target}.download" || {
      rm -f "${target}.download"
      return 1
    }
  fi

  if [ -n "${expected_sha256}" ]; then
    verify_sha256 "${target}.download" "${expected_sha256}" || {
      rm -f "${target}.download"
      return 1
    }
  fi

  if [[ "${binary_path}" == *.gz ]]; then
    command -v gzip >/dev/null 2>&1 || {
      rm -f "${target}.download"
      return 1
    }
    gzip -dc "${target}.download" > "${target}.tmp" || {
      rm -f "${target}.download" "${target}.tmp"
      return 1
    }
    rm -f "${target}.download"
  else
    mv "${target}.download" "${target}.tmp"
  fi
  install -m 0755 "${target}.tmp" "${target}"
  rm -f "${target}.tmp"
}

download_binary() {
  local binary_url="$1"
  local target="$2"
  local fallback_url="${3:-}"
  local expected_sha256="${4:-}"

  if download_binary_once "${binary_url}" "${target}" "${expected_sha256}"; then
    return 0
  fi

  if [ -n "${fallback_url}" ]; then
    echo "warning: failed to download ${binary_url}, fallback to ${fallback_url}" >&2
    download_binary_once "${fallback_url}" "${target}"
    return $?
  fi

  return 1
}

append_query_param() {
  local url="$1"
  local key="$2"
  local value="$3"

  if [[ "${url}" == *\?* ]]; then
    echo "${url}&${key}=${value}"
  else
    echo "${url}?${key}=${value}"
  fi
}

sha256_file() {
  local path="$1"

  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${path}" | awk '{print $1}'
    return 0
  fi

  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "${path}" | awk '{print $1}'
    return 0
  fi

  fail "sha256sum or shasum is required"
}

verify_sha256() {
  local path="$1"
  local expected="$2"
  local actual

  actual="$(sha256_file "${path}")"
  if [ "${actual}" != "${expected}" ]; then
    echo "warning: sha256 mismatch for ${path}: expected=${expected} actual=${actual}" >&2
    return 1
  fi
}

download_manifest() {
  local manifest_url="$1"
  local target="$2"

  if [ "${DRY_RUN}" = "1" ]; then
    echo "+ download ${manifest_url} -> ${target}"
    return 0
  fi

  command -v curl >/dev/null 2>&1 || fail "curl is required"
  curl -fsSL "${manifest_url}" -o "${target}"
}

manifest_value() {
  local manifest_path="$1"
  local platform="$2"
  local key="$3"

  awk -v platform="\"${platform}\"" -v key="\"${key}\"" '
    $0 ~ platform { in_platform=1; next }
    in_platform && $0 ~ /^[[:space:]]*}/ { exit }
    in_platform && $0 ~ key {
      line=$0
      sub(/^[^:]*:[[:space:]]*/, "", line)
      sub(/[,\r]*$/, "", line)
      gsub(/^"|"$/, "", line)
      print line
      exit
    }
  ' "${manifest_path}"
}

validate_binary_name() {
  local name="$1"
  local os="$2"
  local arch="$3"

  case "${name}" in
    "incudal-agent-${os}-${arch}"|"incudal-agent-${os}-${arch}.gz")
      return 0
      ;;
    *)
      fail "manifest binary name is invalid for ${os}-${arch}: ${name}"
      ;;
  esac
}

install_binary_atomically() {
  local source="$1"
  local target="$2"
  local next="${target}.new"

  if [ "${DRY_RUN}" = "1" ]; then
    echo "+ install ${source} -> ${target} (atomic replace)"
    return 0
  fi

  install -d -m 0755 "$(dirname "${target}")"
  install -m 0755 "${source}" "${next}"
  mv -f "${next}" "${target}"
}

fetch_agent_install_config() {
  local install_token="${INCUDAL_AGENT_INSTALL_TOKEN:-}"
  if [ -z "${install_token}" ]; then
    return 0
  fi

  local config_url="${PANEL_BASE_URL}/api/agent/install-config/${install_token}"
  if [ "${DRY_RUN}" = "1" ]; then
    echo "+ fetch ${config_url}"
    INCUDAL_AGENT_ID="${INCUDAL_AGENT_ID:-agt_from_install_token}"
    INCUDAL_AGENT_SECRET="${INCUDAL_AGENT_SECRET:-ias_from_install_token}"
    return 0
  fi

  command -v curl >/dev/null 2>&1 || fail "curl is required"
  INSTALL_CONFIG_PATH="$(mktemp)"
  curl -fsSL "${config_url}" -o "${INSTALL_CONFIG_PATH}"
  # shellcheck disable=SC1090
  . "${INSTALL_CONFIG_PATH}"
  rm -f "${INSTALL_CONFIG_PATH}"
  INSTALL_CONFIG_PATH=""
}

need_env INCUDAL_PANEL_URL

PANEL_BASE_URL="${INCUDAL_PANEL_URL%/}"
OS="$(detect_os)"
ARCH="$(detect_arch)"
DEFAULT_BINARY_BASE_URL="${PANEL_BASE_URL}/api/agent/binary"
BINARY_BASE_URL="${INCUDAL_AGENT_BINARY_BASE_URL:-${DEFAULT_BINARY_BASE_URL}}"
BINARY_NAME="incudal-agent-${OS}-${ARCH}"
BINARY_URL="${INCUDAL_AGENT_BINARY_URL:-}"
BINARY_EXPECTED_SHA256="${INCUDAL_AGENT_BINARY_SHA256:-}"
BINARY_FALLBACK_URL=""
MANIFEST_PATH=""
MANIFEST_URL="${INCUDAL_AGENT_MANIFEST_URL:-${PANEL_BASE_URL}/api/agent/manifest.json}"
STAGED_BIN="${BIN_PATH}.download.$$"

cleanup() {
  rm -f "${STAGED_BIN}" "${STAGED_BIN}.download" "${STAGED_BIN}.tmp" "${BIN_PATH}.new"
  if [ -n "${INSTALL_CONFIG_PATH:-}" ]; then
    rm -f "${INSTALL_CONFIG_PATH}"
  fi
  if [ -n "${MANIFEST_PATH:-}" ]; then
    rm -f "${MANIFEST_PATH}"
  fi
}
trap cleanup EXIT

fetch_agent_install_config
need_env INCUDAL_AGENT_ID
need_env INCUDAL_AGENT_SECRET

if [ -z "${INCUDAL_AGENT_BINARY_URL:-}" ]; then
  # Cloudflare 等边缘缓存可能缓存旧二进制；默认面板下载强制按安装批次换 URL。
  BINARY_CACHE_BUSTER="${INCUDAL_AGENT_BINARY_CACHE_BUSTER:-$(date +%s)}"
  MANIFEST_URL="$(append_query_param "${MANIFEST_URL}" "v" "${BINARY_CACHE_BUSTER}")"
  MANIFEST_PATH="${BIN_PATH}.manifest.$$"
  download_manifest "${MANIFEST_URL}" "${MANIFEST_PATH}"

  if [ "${DRY_RUN}" != "1" ]; then
    BINARY_NAME="$(manifest_value "${MANIFEST_PATH}" "${OS}-${ARCH}" "name")"
    BINARY_EXPECTED_SHA256="$(manifest_value "${MANIFEST_PATH}" "${OS}-${ARCH}" "sha256")"
    if [ -z "${BINARY_NAME}" ] || [ -z "${BINARY_EXPECTED_SHA256}" ]; then
      fail "agent manifest does not contain ${OS}-${ARCH} binary metadata"
    fi
    validate_binary_name "${BINARY_NAME}" "${OS}" "${ARCH}"
  else
    BINARY_NAME="${BINARY_NAME}.gz"
  fi

  BINARY_URL="${BINARY_BASE_URL}/${BINARY_NAME}"
  BINARY_URL="$(append_query_param "${BINARY_URL}" "v" "${BINARY_CACHE_BUSTER}")"
elif [ -z "${BINARY_EXPECTED_SHA256}" ]; then
  echo "warning: INCUDAL_AGENT_BINARY_URL is set without INCUDAL_AGENT_BINARY_SHA256, skip binary checksum verification" >&2
fi

echo "Installing Incudal Agent"
echo "  panel: ${INCUDAL_PANEL_URL}"
echo "  agent: ${INCUDAL_AGENT_ID}"
echo "  binary: ${BINARY_URL}"
if [ -n "${BINARY_EXPECTED_SHA256}" ]; then
  echo "  sha256: ${BINARY_EXPECTED_SHA256}"
fi

if [ "${DRY_RUN}" != "1" ]; then
  install -d -m 0755 "$(dirname "${STAGED_BIN}")"
fi

# 先下载到临时路径，再原子替换，避免覆盖正在运行的二进制时报 Text file busy。
download_binary "${BINARY_URL}" "${STAGED_BIN}" "${BINARY_FALLBACK_URL}" "${BINARY_EXPECTED_SHA256}"
install_binary_atomically "${STAGED_BIN}" "${BIN_PATH}"

write_file "${CONFIG_FILE}" 0600 root:root <<EOF_CONFIG
panel_url: "${INCUDAL_PANEL_URL}"
agent_id: "${INCUDAL_AGENT_ID}"
agent_secret: "${INCUDAL_AGENT_SECRET}"
heartbeat_interval_seconds: ${HEARTBEAT_INTERVAL}
request_timeout_seconds: ${REQUEST_TIMEOUT}
EOF_CONFIG

write_file "${SERVICE_FILE}" 0644 root:root <<EOF_SERVICE
[Unit]
Description=Incudal Host Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${BIN_PATH} -config ${CONFIG_FILE}
Restart=always
RestartSec=5
User=root
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF_SERVICE

if [ "${DRY_RUN}" = "1" ]; then
  echo "Dry run completed."
  exit 0
fi

systemctl daemon-reload
"${BIN_PATH}" -config "${CONFIG_FILE}" -once
systemctl enable "${SERVICE_NAME}"
# 已安装场景下 enable --now 不会重启旧进程；restart 确保升级后立即使用最新二进制和配置。
systemctl restart "${SERVICE_NAME}"
systemctl status "${SERVICE_NAME}" --no-pager --lines=20

echo "Incudal Agent installed or upgraded and started."
