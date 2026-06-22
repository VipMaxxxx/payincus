#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE="${ENV_FILE:-.env}"
FINAL_ACCEPTANCE_MODE="${FINAL_ACCEPTANCE_MODE:-0}"
RUN_PRODUCTION_PREFLIGHT="${RUN_PRODUCTION_PREFLIGHT:-1}"
RUN_SPLIT_AUTH_SMOKE="${RUN_SPLIT_AUTH_SMOKE:-0}"
RUN_RECHARGE_CALLBACK_SMOKE="${RUN_RECHARGE_CALLBACK_SMOKE:-0}"
RUN_AGENT_HEARTBEAT_SMOKE="${RUN_AGENT_HEARTBEAT_SMOKE:-0}"
RUN_AGENT_RELEASE_SMOKE="${RUN_AGENT_RELEASE_SMOKE:-1}"
RUN_LOG_HEADER_CHECK="${RUN_LOG_HEADER_CHECK:-0}"
PRINT_MANUAL_CHECKLIST="${PRINT_MANUAL_CHECKLIST:-1}"
LIVE_ACCEPTANCE_REPORT="${LIVE_ACCEPTANCE_REPORT:-}"
REQUIRE_LIVE_PROOF_REFS="${REQUIRE_LIVE_PROOF_REFS:-0}"
ACCEPTED_WARNINGS_NOTE="${ACCEPTED_WARNINGS_NOTE:-}"
ACCEPTED_WARNINGS_OWNER="${ACCEPTED_WARNINGS_OWNER:-}"
ACCEPTED_WARNINGS_DATE="${ACCEPTED_WARNINGS_DATE:-}"
LIVE_PAYMENT_PROOF_REF="${LIVE_PAYMENT_PROOF_REF:-}"
LIVE_INCUS_PROOF_REF="${LIVE_INCUS_PROOF_REF:-}"
LIVE_AGENT_PROOF_REF="${LIVE_AGENT_PROOF_REF:-}"
LIVE_MAIL_PROOF_REF="${LIVE_MAIL_PROOF_REF:-}"
LIVE_LOG_HEADER_PROOF_REF="${LIVE_LOG_HEADER_PROOF_REF:-}"
LIVE_PROOF_MISSING=0
REPORT_INITIALIZED=0
REPORT_COMPLETED=0

log() {
  printf '[verify-live-acceptance] %s\n' "$*"
}

warn() {
  printf '[verify-live-acceptance] WARN: %s\n' "$*" >&2
}

fail() {
  printf '[verify-live-acceptance] ERROR: %s\n' "$*" >&2
  exit 1
}

append_report() {
  if [[ -n "$LIVE_ACCEPTANCE_REPORT" ]]; then
    printf '%s\n' "$*" >> "$LIVE_ACCEPTANCE_REPORT"
  fi
}

is_live_proof_placeholder() {
  case "$1" in
    'provider order/callback evidence URL or ticket' | \
    'Incus lifecycle evidence URL or ticket' | \
    'Agent install/report evidence URL or ticket' | \
    'SMTP/Lsky/notification evidence URL or ticket' | \
    'header/log exposure evidence URL or ticket')
      return 0
      ;;
  esac
  return 1
}

append_live_proof_ref() {
  local key="$1"
  local value="$2"

  if [[ -z "$value" ]]; then
    append_report "- ${key}: missing"
    LIVE_PROOF_MISSING=1
  elif is_live_proof_placeholder "$value"; then
    append_report "- ${key}: placeholder"
    LIVE_PROOF_MISSING=1
  else
    append_report "- ${key}: ${value}"
  fi
}

finalize_report_on_exit() {
  local exit_code=$?
  if [[ -n "$LIVE_ACCEPTANCE_REPORT" && "$REPORT_INITIALIZED" == "1" && "$REPORT_COMPLETED" != "1" ]]; then
    append_report ''
    append_report "status: failed_or_interrupted"
    append_report "exit_code: ${exit_code}"
  fi
}

trap finalize_report_on_exit EXIT

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

require_command pnpm

FRONTEND_URL_VALUE="$(trim_slash "$(config_value FRONTEND_URL)")"
BACKEND_URL_VALUE="$(trim_slash "${BACKEND_URL:-$(config_value BACKEND_URL)}")"
PORT_VALUE="$(config_value PORT)"
ADMIN_PASSWORD_VALUE="$(config_value ADMIN_PASSWORD)"

if [[ -z "$BACKEND_URL_VALUE" ]]; then
  BACKEND_URL_VALUE="http://127.0.0.1:${PORT_VALUE:-3001}"
fi

REPORT_FRONTEND_URL="${FRONTEND_URL_VALUE:-<missing>}"

if [[ -n "$LIVE_ACCEPTANCE_REPORT" ]]; then
  mkdir -p "$(dirname "$LIVE_ACCEPTANCE_REPORT")"
  cat > "$LIVE_ACCEPTANCE_REPORT" <<REPORT
# Incudal Live Acceptance Report

- generated_at: $(date -u '+%Y-%m-%dT%H:%M:%SZ')
- frontend_url: ${REPORT_FRONTEND_URL}
- backend_url: ${BACKEND_URL_VALUE}
- env_file: ${ENV_FILE}

## Run Configuration

- FINAL_ACCEPTANCE_MODE: ${FINAL_ACCEPTANCE_MODE}
- RUN_PRODUCTION_PREFLIGHT: ${RUN_PRODUCTION_PREFLIGHT}
- RUN_SPLIT_AUTH_SMOKE: ${RUN_SPLIT_AUTH_SMOKE}
- RUN_RECHARGE_CALLBACK_SMOKE: ${RUN_RECHARGE_CALLBACK_SMOKE}
- RUN_AGENT_HEARTBEAT_SMOKE: ${RUN_AGENT_HEARTBEAT_SMOKE}
- RUN_AGENT_RELEASE_SMOKE: ${RUN_AGENT_RELEASE_SMOKE}
- RUN_LOG_HEADER_CHECK: ${RUN_LOG_HEADER_CHECK}
- PRINT_MANUAL_CHECKLIST: ${PRINT_MANUAL_CHECKLIST}
- REQUIRE_LIVE_PROOF_REFS: ${REQUIRE_LIVE_PROOF_REFS}

## Automated Checks

REPORT
  REPORT_INITIALIZED=1
  log "Writing acceptance report: ${LIVE_ACCEPTANCE_REPORT}"
fi

if [[ -z "$FRONTEND_URL_VALUE" ]]; then
  fail "FRONTEND_URL is required"
fi

log "Using frontend: ${FRONTEND_URL_VALUE}"
log "Using backend: ${BACKEND_URL_VALUE}"
log "Using env file: ${ENV_FILE}"

if [[ "$FINAL_ACCEPTANCE_MODE" == "1" ]]; then
  [[ "$RUN_PRODUCTION_PREFLIGHT" == "1" ]] || fail "RUN_PRODUCTION_PREFLIGHT must be 1 when FINAL_ACCEPTANCE_MODE=1"
  [[ "$RUN_SPLIT_AUTH_SMOKE" == "1" ]] || fail "RUN_SPLIT_AUTH_SMOKE must be 1 when FINAL_ACCEPTANCE_MODE=1"
  [[ "$RUN_AGENT_RELEASE_SMOKE" == "1" ]] || fail "RUN_AGENT_RELEASE_SMOKE must be 1 when FINAL_ACCEPTANCE_MODE=1"
  [[ "$RUN_LOG_HEADER_CHECK" == "1" ]] || fail "RUN_LOG_HEADER_CHECK must be 1 when FINAL_ACCEPTANCE_MODE=1"
  [[ "$REQUIRE_LIVE_PROOF_REFS" == "1" ]] || fail "REQUIRE_LIVE_PROOF_REFS must be 1 when FINAL_ACCEPTANCE_MODE=1"
fi

if [[ "$REQUIRE_LIVE_PROOF_REFS" == "1" && -z "$LIVE_ACCEPTANCE_REPORT" ]]; then
  fail "LIVE_ACCEPTANCE_REPORT is required when REQUIRE_LIVE_PROOF_REFS=1"
fi

if [[ -n "$ACCEPTED_WARNINGS_NOTE" ]]; then
  [[ -n "$ACCEPTED_WARNINGS_OWNER" ]] || fail "ACCEPTED_WARNINGS_OWNER is required when ACCEPTED_WARNINGS_NOTE is set"
  [[ -n "$ACCEPTED_WARNINGS_DATE" ]] || fail "ACCEPTED_WARNINGS_DATE is required when ACCEPTED_WARNINGS_NOTE is set"
  [[ "$ACCEPTED_WARNINGS_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || fail "ACCEPTED_WARNINGS_DATE must use YYYY-MM-DD"
elif [[ -n "$ACCEPTED_WARNINGS_OWNER" || -n "$ACCEPTED_WARNINGS_DATE" ]]; then
  fail "ACCEPTED_WARNINGS_NOTE is required when accepted warning owner/date is set"
fi

if [[ "$RUN_PRODUCTION_PREFLIGHT" == "1" ]]; then
  log "Running production preflight"
  ENV_FILE="$ENV_FILE" \
    FRONTEND_URL="$FRONTEND_URL_VALUE" \
    BACKEND_URL="$BACKEND_URL_VALUE" \
    pnpm verify:production
  append_report "- production_preflight: passed"
else
  warn "Production preflight skipped because RUN_PRODUCTION_PREFLIGHT=${RUN_PRODUCTION_PREFLIGHT}"
  append_report "- production_preflight: skipped (${RUN_PRODUCTION_PREFLIGHT})"
fi

if [[ "$RUN_SPLIT_AUTH_SMOKE" == "1" ]]; then
  if [[ -z "${SMOKE_ADMIN_PASSWORD:-}" && -z "$ADMIN_PASSWORD_VALUE" ]]; then
    fail "SMOKE_ADMIN_PASSWORD or ADMIN_PASSWORD is required when RUN_SPLIT_AUTH_SMOKE=1"
  fi
  log "Running split auth smoke through the production frontend"
  ENV_FILE="$ENV_FILE" \
    SMOKE_FRONTEND_URL="$FRONTEND_URL_VALUE" \
    SMOKE_API_BASE_URL="$FRONTEND_URL_VALUE" \
    SMOKE_BACKEND_URL="$BACKEND_URL_VALUE" \
    pnpm smoke:split:auth
  append_report "- split_auth_smoke: passed"
else
  warn "Split auth smoke skipped. Set RUN_SPLIT_AUTH_SMOKE=1 with SMOKE_ADMIN_PASSWORD to run it."
  append_report "- split_auth_smoke: skipped"
fi

if [[ "$RUN_AGENT_RELEASE_SMOKE" == "1" ]]; then
  log "Running Agent release endpoint smoke"
  ENV_FILE="$ENV_FILE" \
    SMOKE_API_BASE_URL="$FRONTEND_URL_VALUE" \
    BACKEND_URL="$BACKEND_URL_VALUE" \
    pnpm smoke:agent-release
  append_report "- agent_release_smoke: passed"
else
  warn "Agent release smoke skipped because RUN_AGENT_RELEASE_SMOKE=${RUN_AGENT_RELEASE_SMOKE}"
  append_report "- agent_release_smoke: skipped (${RUN_AGENT_RELEASE_SMOKE})"
fi

if [[ "$RUN_RECHARGE_CALLBACK_SMOKE" == "1" ]]; then
  log "Running forged recharge callback smoke with temporary provider/order data"
  ENV_FILE="$ENV_FILE" \
    SMOKE_API_BASE_URL="$FRONTEND_URL_VALUE" \
    BACKEND_URL="$BACKEND_URL_VALUE" \
    pnpm smoke:recharge-callback
  append_report "- recharge_callback_smoke: passed"
else
  warn "Recharge callback smoke skipped. Set RUN_RECHARGE_CALLBACK_SMOKE=1 to run temporary provider/order negative checks."
  append_report "- recharge_callback_smoke: skipped"
fi

if [[ "$RUN_AGENT_HEARTBEAT_SMOKE" == "1" ]]; then
  log "Running Agent heartbeat smoke with temporary host/agent data"
  ENV_FILE="$ENV_FILE" \
    SMOKE_API_BASE_URL="$FRONTEND_URL_VALUE" \
    BACKEND_URL="$BACKEND_URL_VALUE" \
    pnpm smoke:agent-heartbeat
  append_report "- agent_heartbeat_smoke: passed"
else
  warn "Agent heartbeat smoke skipped. Set RUN_AGENT_HEARTBEAT_SMOKE=1 to run temporary host/agent checks."
  append_report "- agent_heartbeat_smoke: skipped"
fi

if [[ "$RUN_LOG_HEADER_CHECK" == "1" ]]; then
  log "Running production log/header exposure check"
  ENV_FILE="$ENV_FILE" \
    FRONTEND_URL="$FRONTEND_URL_VALUE" \
    BACKEND_URL="$BACKEND_URL_VALUE" \
    pnpm verify:log-header
  append_report "- log_header_exposure_check: passed"
else
  warn "Production log/header exposure check skipped. Set RUN_LOG_HEADER_CHECK=1 to run it."
  append_report "- log_header_exposure_check: skipped"
fi

if [[ -n "$LIVE_ACCEPTANCE_REPORT" ]]; then
  append_report ''
  append_report '## Accepted Warnings'
  append_report ''
  if [[ -n "$ACCEPTED_WARNINGS_NOTE" ]]; then
    append_report "- owner: ${ACCEPTED_WARNINGS_OWNER}"
    append_report "- date: ${ACCEPTED_WARNINGS_DATE}"
    append_report "- note: ${ACCEPTED_WARNINGS_NOTE}"
  else
    append_report "- none documented"
  fi
fi

if [[ -n "$LIVE_ACCEPTANCE_REPORT" ]]; then
  append_report ''
  append_report '## Live Proof References'
  append_report ''

  append_live_proof_ref payment "$LIVE_PAYMENT_PROOF_REF"
  append_live_proof_ref incus_resource_delivery "$LIVE_INCUS_PROOF_REF"
  append_live_proof_ref agent_install_reports "$LIVE_AGENT_PROOF_REF"
  append_live_proof_ref mail_lsky_notifications "$LIVE_MAIL_PROOF_REF"
  append_live_proof_ref log_header_exposure "$LIVE_LOG_HEADER_PROOF_REF"

  if [[ "$LIVE_PROOF_MISSING" == "0" ]]; then
    append_report ''
    append_report 'final_go_status: live_proof_references_documented'
  else
    append_report ''
    append_report 'final_go_status: pending_live_proof'
  fi
fi

if [[ "$PRINT_MANUAL_CHECKLIST" == "1" ]]; then
  cat <<'CHECKLIST'
[verify-live-acceptance] Manual proof still required before final Go:
- Real payment sandbox or low-value payment: valid callback completes once, replay/wrong signature rejected, credited amount matches records.
- Real Incus lifecycle: create, start, stop, restart, reinstall/recreate, terminal, NAT/IPv6, traffic collection, delete.
- Real Agent install: sha256-verified binary, fresh heartbeat, resources, metrics, instance report, traffic snapshots.
- Real SMTP/mail source/Lsky/notification delivery with production credentials.
- Production log/header check: CSP/nosniff/frame/referrer headers, backend not public, no sensitive secrets in logs.
CHECKLIST
  append_report ''
  append_report '## Manual Proof Still Required'
  append_report ''
  append_report '- Real payment sandbox or low-value payment: valid callback completes once, replay/wrong signature rejected, credited amount matches records.'
  append_report '- Real Incus lifecycle: create, start, stop, restart, reinstall/recreate, terminal, NAT/IPv6, traffic collection, delete.'
  append_report '- Real Agent install: sha256-verified binary, fresh heartbeat, resources, metrics, instance report, traffic snapshots.'
  append_report '- Real SMTP/mail source/Lsky/notification delivery with production credentials.'
  append_report '- Production log/header check: CSP/nosniff/frame/referrer headers, backend not public, no sensitive secrets in logs.'
fi

if [[ "$REQUIRE_LIVE_PROOF_REFS" == "1" && "$LIVE_PROOF_MISSING" != "0" ]]; then
  append_report ''
  append_report 'status: pending_live_proof'
  REPORT_COMPLETED=1
  fail "Live proof references are required when REQUIRE_LIVE_PROOF_REFS=1"
fi

append_report ''
append_report 'status: automated_checks_completed'
REPORT_COMPLETED=1
log "Automated live acceptance checks completed"
