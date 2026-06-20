#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${DIST_DIR:-${ROOT_DIR}/dist}"
VERSION_FILE="${VERSION_FILE:-${ROOT_DIR}/VERSION}"
VERSION_PATTERN='^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'

default_version() {
  if [ ! -f "${VERSION_FILE}" ]; then
    echo "Agent version file not found: ${VERSION_FILE}" >&2
    exit 1
  fi

  tr -d '[:space:]' < "${VERSION_FILE}"
}

VERSION="${VERSION:-$(default_version)}"
if [[ ! "${VERSION}" =~ ${VERSION_PATTERN} ]]; then
  echo "Invalid Agent version: ${VERSION}" >&2
  echo "Expected format: vMAJOR.MINOR.PATCH or vMAJOR.MINOR.PATCH-suffix" >&2
  exit 1
fi

mkdir -p "${DIST_DIR}"

build_one() {
  local goarch="$1"
  local output="${DIST_DIR}/incudal-agent-linux-${goarch}"

  echo "Building ${output} (version=${VERSION})"
  (
    cd "${ROOT_DIR}"
    CGO_ENABLED=0 GOOS=linux GOARCH="${goarch}" \
      go build \
        -trimpath \
        -buildvcs=false \
        -gcflags "all=-l" \
        -ldflags "-s -w -X main.version=${VERSION}" \
        -o "${output}" \
        ./cmd/incudal-agent
  )
  chmod +x "${output}"
  gzip -9 -c "${output}" > "${output}.gz"
}

build_one amd64
build_one arm64

sha256_file() {
  sha256sum "$1" | awk '{print $1}'
}

size_file() {
  wc -c < "$1" | tr -d ' '
}

GENERATED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
AMD64_GZ="${DIST_DIR}/incudal-agent-linux-amd64.gz"
ARM64_GZ="${DIST_DIR}/incudal-agent-linux-arm64.gz"
cat > "${DIST_DIR}/manifest.json" <<EOF_MANIFEST
{
  "version": "${VERSION}",
  "generatedAt": "${GENERATED_AT}",
  "files": {
    "linux-amd64": {
      "name": "incudal-agent-linux-amd64.gz",
      "sha256": "$(sha256_file "${AMD64_GZ}")",
      "size": $(size_file "${AMD64_GZ}"),
      "gzip": true
    },
    "linux-arm64": {
      "name": "incudal-agent-linux-arm64.gz",
      "sha256": "$(sha256_file "${ARM64_GZ}")",
      "size": $(size_file "${ARM64_GZ}"),
      "gzip": true
    }
  }
}
EOF_MANIFEST

ls -lh "${DIST_DIR}"/incudal-agent-linux-* "${DIST_DIR}/manifest.json"
