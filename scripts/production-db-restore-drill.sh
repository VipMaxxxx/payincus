#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE="${ENV_FILE:-/opt/incudal/.env}"
DRILL_PREFIX="${DRILL_PREFIX:-incudal_restore_drill}"
KEEP_RESTORE_DRILL_ARTIFACTS="${KEEP_RESTORE_DRILL_ARTIFACTS:-0}"
RESTORE_DRILL_MAINTENANCE_DB="${RESTORE_DRILL_MAINTENANCE_DB:-postgres}"

log() {
  printf '[restore-drill] %s\n' "$*"
}

fail() {
  printf '[restore-drill] ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing command: $1"
}

[[ -f "$ENV_FILE" ]] || fail "ENV_FILE not found: $ENV_FILE"

require_command node
require_command pg_dump
require_command pg_restore
require_command psql
require_command createdb
require_command dropdb
require_command wc

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

[[ -n "${DATABASE_URL:-}" ]] || fail "DATABASE_URL is required in ENV_FILE"

eval "$(
  node --input-type=module <<'NODE'
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error("DATABASE_URL is required")
  process.exit(1)
}

const url = new URL(databaseUrl)
const singleQuote = String.fromCharCode(39)
const quote = value => singleQuote + String(value).replaceAll(singleQuote, singleQuote + "\\\\" + singleQuote + singleQuote) + singleQuote
const database = decodeURIComponent(url.pathname.replace(/^\//, ""))
const username = decodeURIComponent(url.username)
const password = decodeURIComponent(url.password)
const sslmode = url.searchParams.get("sslmode") || ""

if (!database || !username) {
  console.error("DATABASE_URL must include database and username")
  process.exit(1)
}

console.log("PGHOST=" + quote(url.hostname))
console.log("PGPORT=" + quote(url.port || "5432"))
console.log("PGUSER=" + quote(username))
console.log("PGPASSWORD=" + quote(password))
console.log("PGDATABASE=" + quote(database))
if (sslmode) {
  console.log("PGSSLMODE=" + quote(sslmode))
}
NODE
)"

export PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE
if [[ -n "${PGSSLMODE:-}" ]]; then
  export PGSSLMODE
fi

SOURCE_DB="$PGDATABASE"
DRILL_ID="$(date -u +%Y%m%d%H%M%S)-$$"
TEMP_DB_NAME="${DRILL_PREFIX}_${DRILL_ID//[^A-Za-z0-9_]/_}"
WORKDIR="${RESTORE_DRILL_WORKDIR:-/tmp/${TEMP_DB_NAME}}"
DUMP_FILE="$WORKDIR/production.dump"
RESTORE_LOG="$WORKDIR/restore.log"
TEMP_DB_CREATED=0

create_temp_database() {
  if PGDATABASE="$RESTORE_DRILL_MAINTENANCE_DB" createdb "$TEMP_DB_NAME"; then
    return 0
  fi

  log "createdb via $RESTORE_DRILL_MAINTENANCE_DB failed; retrying via source database connection"
  if PGDATABASE="$SOURCE_DB" createdb "$TEMP_DB_NAME"; then
    return 0
  fi

  if [[ "$(id -u)" == "0" ]] && command -v runuser >/dev/null 2>&1 && id postgres >/dev/null 2>&1; then
    log "createdb via application user failed; retrying as local postgres system user"
    env -u PGHOST -u PGPORT -u PGUSER -u PGPASSWORD -u PGDATABASE -u PGSSLMODE \
      runuser -u postgres -- createdb -O "$PGUSER" "$TEMP_DB_NAME"
    return 0
  fi

  return 1
}

drop_temp_database() {
  PGDATABASE="$RESTORE_DRILL_MAINTENANCE_DB" dropdb --if-exists "$TEMP_DB_NAME" >/dev/null 2>&1 \
    || PGDATABASE="$SOURCE_DB" dropdb --if-exists "$TEMP_DB_NAME" >/dev/null 2>&1 \
    || {
      if [[ "$(id -u)" == "0" ]] && command -v runuser >/dev/null 2>&1 && id postgres >/dev/null 2>&1; then
        env -u PGHOST -u PGPORT -u PGUSER -u PGPASSWORD -u PGDATABASE -u PGSSLMODE \
          runuser -u postgres -- dropdb --if-exists "$TEMP_DB_NAME" >/dev/null 2>&1
      fi
    } \
    || true
}

cleanup() {
  local status=$?
  if [[ "$TEMP_DB_CREATED" == "1" ]]; then
    drop_temp_database
  fi
  if [[ "$KEEP_RESTORE_DRILL_ARTIFACTS" != "1" ]]; then
    rm -rf "$WORKDIR"
  else
    log "Keeping drill artifacts in $WORKDIR"
  fi
  exit "$status"
}
trap cleanup EXIT

mkdir -p "$WORKDIR"
chmod 700 "$WORKDIR"

log "Starting production database backup/restore drill"
log "Source database name: $SOURCE_DB"
log "Temporary restore database: $TEMP_DB_NAME"
log "Temporary workdir: $WORKDIR"

PGDATABASE="$SOURCE_DB" pg_dump --format=custom --no-owner --no-privileges --file "$DUMP_FILE"
dump_bytes="$(wc -c < "$DUMP_FILE" | tr -d '[:space:]')"
[[ "$dump_bytes" =~ ^[0-9]+$ && "$dump_bytes" -gt 0 ]] || fail "pg_dump produced an empty dump"
log "pg_dump completed; dump size bytes: $dump_bytes"

pg_restore --list "$DUMP_FILE" >/dev/null
log "pg_restore --list validated the dump catalog"

create_temp_database
TEMP_DB_CREATED=1
log "Temporary restore database created"

PGDATABASE="$TEMP_DB_NAME" pg_restore --dbname "$TEMP_DB_NAME" --no-owner --no-privileges --exit-on-error "$DUMP_FILE" > "$RESTORE_LOG" 2>&1
log "pg_restore completed into temporary database"

PGDATABASE="$TEMP_DB_NAME" psql -v ON_ERROR_STOP=1 -At <<'SQL'
SELECT 'public_tables=' || count(*) FROM information_schema.tables WHERE table_schema = 'public';
SELECT 'prisma_migrations=' || count(*) FROM "_prisma_migrations";
SELECT 'users=' || count(*) FROM users;
SELECT 'instances=' || count(*) FROM instances;
SELECT 'system_update_tasks=' || count(*) FROM system_update_tasks;
SQL

log "Temporary restore validation queries completed"
log "Dropping temporary restore database and removing temporary dump"
