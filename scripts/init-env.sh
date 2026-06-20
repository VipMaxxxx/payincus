#!/usr/bin/env bash
# ============================================================================
# Incudal 本地 .env 初始化脚本
#
# 用法：
#   bash scripts/init-env.sh
#
# 行为：
#   - 如果 .env 不存在，创建 .env
#   - 如果 .env 已存在，只补齐缺失或空值的关键变量
#   - 不覆盖已有非空配置，避免破坏已部署实例
# ============================================================================
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env}"

log() {
    echo "[✓] $1" >&2
}

info() {
    echo "[i] $1" >&2
}

gen_password() {
    openssl rand -hex 64 | cut -c "1-${1:-24}"
}

gen_secret() {
    printf 'A1!%s' "$(openssl rand -hex 64)" | cut -c "1-${1:-48}"
}

get_env_value() {
    local key="$1"
    if [[ ! -f "$ENV_FILE" ]]; then
        return 0
    fi
    grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -n 1 | cut -d'=' -f2- || true
}

set_env_if_missing() {
    local key="$1"
    local value="$2"
    local label="$3"
    local current
    current="$(get_env_value "$key")"

    if [[ -n "$current" ]]; then
        return 0
    fi

    if grep -qE "^${key}=" "$ENV_FILE" 2>/dev/null; then
        local tmp_file
        tmp_file="$(mktemp)"
        awk -v key="$key" -v value="$value" '
            BEGIN { replaced = 0 }
            $0 ~ "^" key "=" && replaced == 0 {
                print key "=" value
                replaced = 1
                next
            }
            { print }
        ' "$ENV_FILE" > "$tmp_file"
        cat "$tmp_file" > "$ENV_FILE"
        rm -f "$tmp_file"
    else
        printf '\n%s=%s\n' "$key" "$value" >> "$ENV_FILE"
    fi

    log "已自动补充 ${label}: ${key}"
}

if [[ ! -f "$ENV_FILE" ]]; then
    cat > "$ENV_FILE" <<EOF_ENV
# ============================================================================
# Incudal Docker 部署环境配置
# 由 scripts/init-env.sh 自动生成于 $(date '+%Y-%m-%d %H:%M:%S')
# ============================================================================
EOF_ENV
    info "已创建 ${ENV_FILE}"
fi

set_env_if_missing "POSTGRES_USER" "incudal" "PostgreSQL 用户"
set_env_if_missing "POSTGRES_PASSWORD" "$(gen_password 24)" "PostgreSQL 密码"
set_env_if_missing "POSTGRES_DB" "incudal" "PostgreSQL 数据库名"
set_env_if_missing "REDIS_PASSWORD" "$(gen_password 24)" "Redis 密码"
set_env_if_missing "JWT_SECRET" "$(gen_secret 48)" "JWT 密钥"
set_env_if_missing "COOKIE_SECRET" "$(gen_secret 48)" "Cookie 密钥"
set_env_if_missing "ENCRYPTION_KEY" "$(openssl rand -base64 32)" "敏感数据加密密钥"
set_env_if_missing "APP_PORT" "3000" "应用端口"
set_env_if_missing "ADMIN_PASSWORD" "$(gen_password 16)" "管理员初始密码"
set_env_if_missing "LOG_LEVEL" "info" "日志级别"
set_env_if_missing "DISABLE_REQUEST_LOG" "true" "请求日志开关"

chmod 600 "$ENV_FILE"
log "环境配置已就绪: ${ENV_FILE}"
info "请备份 ${ENV_FILE}，尤其是 ENCRYPTION_KEY，生产环境不能随意更换。"
