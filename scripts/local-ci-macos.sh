#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

print_step() {
  printf '\n\033[33m[%s/6] %s\033[0m\n' "$1" "$2"
}

print_ok() {
  printf '\033[32mOK\033[0m\n'
}

ensure_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    PNPM_CMD=(pnpm)
    return
  fi

  if command -v corepack >/dev/null 2>&1; then
    LOCAL_CI_HOME="${TMPDIR:-/tmp}/incudal-local-ci"
    export COREPACK_HOME="$LOCAL_CI_HOME/corepack"
    mkdir -p "$COREPACK_HOME"
    mkdir -p "$LOCAL_CI_HOME/bin"
    cat > "$LOCAL_CI_HOME/bin/pnpm" <<'SH'
#!/usr/bin/env bash
exec corepack pnpm "$@"
SH
    chmod +x "$LOCAL_CI_HOME/bin/pnpm"
    export PATH="$LOCAL_CI_HOME/bin:$PATH"
    PNPM_CMD=(corepack pnpm)
    return
  fi

  printf '\033[31mFAILED: pnpm is not installed and corepack is unavailable\033[0m\n' >&2
  exit 1
}

printf '\033[36m========================================\033[0m\n'
printf '\033[36m  Local CI Test (macOS)\033[0m\n'
printf '\033[36m========================================\033[0m\n'

ensure_pnpm

print_step 1 "Installing dependencies..."
"${PNPM_CMD[@]}" install --frozen-lockfile --ignore-scripts
print_ok

print_step 2 "Generating Prisma Client..."
export DATABASE_URL="postgresql://user:pass@localhost:5432/db"
"${PNPM_CMD[@]}" --filter server exec prisma generate
print_ok

print_step 3 "Running lint..."
"${PNPM_CMD[@]}" lint
print_ok

print_step 4 "Type checking client..."
"${PNPM_CMD[@]}" --filter client type-check
print_ok

print_step 5 "Type checking server..."
"${PNPM_CMD[@]}" --filter server type-check
print_ok

print_step 6 "Building..."
"${PNPM_CMD[@]}" build
print_ok

printf '\n\033[32m========================================\033[0m\n'
printf '\033[32m  All CI checks passed!\033[0m\n'
printf '\033[32m========================================\033[0m\n'
