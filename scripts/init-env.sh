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
# Incudal 主机进程部署环境配置
# 由 scripts/init-env.sh 自动生成于 $(date '+%Y-%m-%d %H:%M:%S')
# ============================================================================
EOF_ENV
    info "已创建 ${ENV_FILE}"
fi

db_password="$(gen_password 24)"
redis_password="$(gen_password 24)"

set_env_if_missing "NODE_ENV" "production" "运行环境"
set_env_if_missing "HOST" "127.0.0.1" "后端监听地址"
set_env_if_missing "PORT" "3001" "后端监听端口"
set_env_if_missing "TRUST_PROXY" "true" "信任本机 Nginx 代理头"
set_env_if_missing "DATABASE_URL" "postgresql://incudal:${db_password}@127.0.0.1:5432/incudal" "PostgreSQL 连接地址"
set_env_if_missing "REDIS_URL" "redis://:${redis_password}@127.0.0.1:6379" "Redis 连接地址"
set_env_if_missing "JWT_SECRET" "$(gen_secret 48)" "JWT 密钥"
set_env_if_missing "COOKIE_SECRET" "$(gen_secret 48)" "Cookie 密钥"
set_env_if_missing "ENCRYPTION_KEY" "$(openssl rand -base64 32)" "敏感数据加密密钥"
set_env_if_missing "ADMIN_PASSWORD" "$(gen_password 16)" "管理员初始密码"
set_env_if_missing "SERVE_STATIC_CLIENT" "false" "后端静态文件服务开关"
set_env_if_missing "VITE_API_BASE_URL" "/api" "前端 API 基础路径"
set_env_if_missing "INCUDAL_AGENT_RELEASE_REPOSITORY" "" "Agent GitHub Release 仓库"
set_env_if_missing "INCUDAL_AGENT_RELEASE_TOKEN" "" "Agent GitHub Release Token"
set_env_if_missing "INCUDAL_AGENT_RELEASE_DIR" "" "Agent 本地 Release 目录"
set_env_if_missing "INCUDAL_AGENT_BINARY_URL" "" "Agent 自定义二进制地址"
set_env_if_missing "INCUDAL_AGENT_BINARY_SHA256" "" "Agent 自定义二进制 SHA256"
set_env_if_missing "LOG_LEVEL" "info" "日志级别"
set_env_if_missing "DISABLE_REQUEST_LOG" "true" "请求日志开关"

chmod 600 "$ENV_FILE"
log "环境配置已就绪: ${ENV_FILE}"
info "请备份 ${ENV_FILE}，尤其是 ENCRYPTION_KEY，生产环境不能随意更换。"
