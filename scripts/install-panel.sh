#!/usr/bin/env bash
# ============================================================================
# Incudal 面板一键部署脚本（产物包模式）
#
# 功能：
#   - 安装 Node.js 22、PostgreSQL 16、Redis 7
#   - 从 GitHub Releases 下载预构建产物包
#   - 自动配置数据库、环境变量、systemd 服务
#   - 支持 Nginx+Certbot / Cloudflare Tunnel / 纯端口 三种外部访问方案
#   - 支持升级已有安装
#
# 用法：
#   安装：  sudo bash install-panel.sh
#   升级：  sudo bash install-panel.sh --upgrade
#   卸载：  sudo bash install-panel.sh --uninstall
#
# 项目地址: https://github.com/0xdabiaoge/incudal
# ============================================================================
set -euo pipefail

# ========================== 全局常量 ==========================
readonly SCRIPT_VERSION="3.0.0"
readonly GITHUB_REPO="0xdabiaoge/incudal"
readonly INSTALL_DIR="/opt/incudal"
readonly SERVICE_NAME="incudal"
readonly SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
readonly ENV_FILE="${INSTALL_DIR}/.env"
readonly RUN_USER="incudal"
readonly DEFAULT_PORT=3000
readonly NODE_MAJOR=22
readonly PG_VERSION=16

# ========================== 颜色定义 ==========================
readonly RED='\033[1;31m'
readonly GREEN='\033[1;32m'
readonly YELLOW='\033[1;33m'
readonly CYAN='\033[1;36m'
readonly BOLD='\033[1m'
readonly DIM='\033[2m'
readonly NC='\033[0m'

# ========================== 工具函数 ==========================
# 所有日志输出到 stderr，避免在 $() 子 shell 中被捕获
log()   { echo -e "${GREEN}[✓]${NC} $1" >&2; }
info()  { echo -e "${CYAN}[i]${NC} $1" >&2; }
warn()  { echo -e "${YELLOW}[!]${NC} $1" >&2; }
error() { echo -e "${RED}[✗]${NC} $1" >&2; }
step()  { echo -e "\n${CYAN}[▶]${NC} ${BOLD}$1${NC}" >&2; }

divider() {
    echo -e "${DIM}────────────────────────────────────────────────────${NC}" >&2
}

# 生成随机密码
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

ensure_env_keys() {
    if [[ ! -f "$ENV_FILE" ]]; then
        return 0
    fi

    set_env_if_missing "JWT_SECRET" "$(gen_secret 48)" "JWT 密钥"
    set_env_if_missing "COOKIE_SECRET" "$(gen_secret 48)" "Cookie 密钥"
    set_env_if_missing "ENCRYPTION_KEY" "$(openssl rand -base64 32)" "敏感数据加密密钥"
    set_env_if_missing "ADMIN_PASSWORD" "$(gen_password 16)" "管理员初始密码"

    chmod 600 "$ENV_FILE"
    chown "${RUN_USER}:${RUN_USER}" "$ENV_FILE" 2>/dev/null || true
}

# ========================== 系统检查 ==========================
check_root() {
    if [[ "$EUID" -ne 0 ]]; then
        error "请以 root 权限运行此部署脚本！"
        error "用法: sudo bash $0"
        exit 1
    fi
}

check_os() {
    if [[ ! -f /etc/os-release ]]; then
        error "无法检测操作系统（/etc/os-release 不存在）"
        exit 1
    fi

    source /etc/os-release
    OS_ID="${ID:-unknown}"
    OS_VERSION="${VERSION_ID:-unknown}"
    OS_CODENAME="${VERSION_CODENAME:-unknown}"
    ARCH=$(dpkg --print-architecture 2>/dev/null || uname -m)

    # 仅支持 Ubuntu 和 Debian
    if [[ "$OS_ID" != "ubuntu" && "$OS_ID" != "debian" ]]; then
        error "不支持的操作系统: ${OS_ID}"
        error "本脚本仅支持 Ubuntu 和 Debian 系统"
        exit 1
    fi

    # 版本检查
    case "$OS_ID" in
        ubuntu)
            local major="${OS_VERSION%%.*}"
            if [[ "$major" -lt 22 ]] 2>/dev/null; then
                error "Ubuntu 版本过低 (${OS_VERSION})，最低要求 Ubuntu 22.04"
                exit 1
            fi
            ;;
        debian)
            local major="${OS_VERSION%%.*}"
            if [[ "$major" -lt 12 ]] 2>/dev/null; then
                error "Debian 版本过低 (${OS_VERSION})，最低要求 Debian 12 (Bookworm)"
                exit 1
            fi
            ;;
    esac

    # 架构检查
    case "$ARCH" in
        amd64|x86_64) ARCH="amd64" ;;
        arm64|aarch64) ARCH="arm64" ;;
        *)
            error "不支持的系统架构: ${ARCH}"
            error "仅支持 amd64 (x86_64) 和 arm64 (aarch64)"
            exit 1
            ;;
    esac

    log "系统检测通过: ${OS_ID} ${OS_VERSION} (${ARCH})"
}

# ========================== 显示横幅 ==========================
show_banner() {
    clear 2>/dev/null || true
    echo ""
    echo -e "${CYAN}  ╔══════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}  ║                                                  ║${NC}"
    echo -e "${CYAN}  ║          ${BOLD}Incudal 面板一键部署脚本${NC}${CYAN}                ║${NC}"
    echo -e "${CYAN}  ║          ${DIM}Pre-built Package Deploy${NC}${CYAN}                ║${NC}"
    echo -e "${CYAN}  ║                                                  ║${NC}"
    echo -e "${CYAN}  ╚══════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  ${DIM}版本: ${SCRIPT_VERSION}  |  仓库: ${GITHUB_REPO}${NC}"
    echo ""
}

# ========================== 检查已有安装 ==========================
check_existing() {
    if [[ -d "$INSTALL_DIR" && -f "${INSTALL_DIR}/server/dist/app.js" ]]; then
        return 0  # 已安装
    fi
    return 1  # 未安装
}

# ========================== 安装 Node.js ==========================
install_nodejs() {
    step "安装 Node.js ${NODE_MAJOR}..."

    if command -v node &>/dev/null; then
        local current_ver
        current_ver=$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1)
        if [[ "$current_ver" -ge "$NODE_MAJOR" ]] 2>/dev/null; then
            log "Node.js $(node -v) 已安装，跳过"
            return 0
        fi
        warn "当前 Node.js 版本较低 ($(node -v))，将升级到 v${NODE_MAJOR}"
    fi

    # 通过 NodeSource 安装
    info "添加 NodeSource APT 源..."
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null 2>&1
    apt-get install -y -qq nodejs >/dev/null 2>&1

    log "Node.js $(node -v) 安装完成"
}

# ========================== 安装 PostgreSQL ==========================
install_postgresql() {
    step "安装 PostgreSQL ${PG_VERSION}..."

    if command -v psql &>/dev/null; then
        local pg_ver
        pg_ver=$(psql --version 2>/dev/null | awk '{print $3}' | cut -d. -f1)
        if [[ "$pg_ver" -ge "$PG_VERSION" ]] 2>/dev/null; then
            log "PostgreSQL ${pg_ver} 已安装，跳过"
            return 0
        fi
    fi

    # 添加 PostgreSQL 官方 APT 源
    info "添加 PostgreSQL 官方 APT 源..."
    apt-get install -y -qq gnupg lsb-release >/dev/null 2>&1

    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
        | gpg --yes --dearmor -o /etc/apt/keyrings/postgresql.gpg

    echo "deb [signed-by=/etc/apt/keyrings/postgresql.gpg] https://apt.postgresql.org/pub/repos/apt ${OS_CODENAME}-pgdg main" \
        > /etc/apt/sources.list.d/pgdg.list

    apt-get update -qq >/dev/null 2>&1
    apt-get install -y -qq "postgresql-${PG_VERSION}" >/dev/null 2>&1

    # 确保服务启动
    systemctl enable postgresql >/dev/null 2>&1
    systemctl start postgresql

    log "PostgreSQL ${PG_VERSION} 安装完成"
}

# ========================== 安装 Redis ==========================
install_redis() {
    step "安装 Redis..."

    if command -v redis-server &>/dev/null; then
        log "Redis $(redis-server --version | awk '{print $3}' | sed 's/v=//') 已安装，跳过"
        return 0
    fi

    apt-get install -y -qq redis-server >/dev/null 2>&1

    # 确保服务启动
    systemctl enable redis-server >/dev/null 2>&1
    systemctl start redis-server

    log "Redis 安装完成"
}

# ========================== 手动包目录 ==========================
readonly MANUAL_PKG_DIR="/tmp/incudal"

# ========================== 获取最新版本号（快速尝试） ==========================
get_latest_version() {
    local api_url="https://api.github.com/repos/${GITHUB_REPO}/releases/latest"
    local response=""
    local version=""

    # 5 秒超时速查，不阻塞
    response=$(curl -sL --connect-timeout 5 --max-time 8 "$api_url" 2>/dev/null) || true

    if [[ -n "$response" ]]; then
        version=$(echo "$response" | grep '"tag_name"' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/' || true)
    fi

    echo "$version"
}

# ========================== 自动下载产物包 ==========================
download_release() {
    local version="$1"
    local filename="incudal-${version}-linux-${ARCH}.tar.gz"
    local download_url="https://github.com/${GITHUB_REPO}/releases/download/${version}/${filename}"
    local tmp_file="/tmp/${filename}"

    info "下载地址: ${download_url}"

    if curl -fSL --progress-bar --connect-timeout 15 --max-time 600 \
        "$download_url" -o "$tmp_file" 2>/dev/null; then
        local file_size
        file_size=$(du -h "$tmp_file" | cut -f1 || true)
        log "下载完成 (${file_size})"
        echo "$tmp_file"
        return 0
    fi

    rm -f "$tmp_file" 2>/dev/null || true
    return 1
}

# ========================== 扫描手动放置的产物包 ==========================
scan_manual_package() {
    local found=""

    if [[ ! -d "$MANUAL_PKG_DIR" ]]; then
        return 1
    fi

    # 优先匹配当前架构的包
    found=$(find "$MANUAL_PKG_DIR" -maxdepth 1 -name "incudal-*-linux-${ARCH}.tar.gz" -type f 2>/dev/null | head -n1 || true)

    # 退而匹配任意 incudal tar.gz
    if [[ -z "$found" ]]; then
        found=$(find "$MANUAL_PKG_DIR" -maxdepth 1 -name "incudal-*.tar.gz" -type f 2>/dev/null | head -n1 || true)
    fi

    if [[ -n "$found" ]]; then
        echo "$found"
        return 0
    fi

    return 1
}

# ========================== 等待用户放置产物包 ==========================
wait_for_manual_package() {
    echo "" >&2
    divider
    echo -e "  ${YELLOW}${BOLD}⚠ 自动获取产物包失败${NC}" >&2
    echo -e "  ${DIM}（仓库可能是私有的，或网络无法连接 GitHub）${NC}" >&2
    divider
    echo "" >&2
    echo -e "  ${BOLD}请手动下载产物包并放到以下目录：${NC}" >&2
    echo "" >&2
    echo -e "  ${CYAN}${BOLD}${MANUAL_PKG_DIR}/${NC}" >&2
    echo "" >&2
    echo -e "  ${BOLD}下载地址：${NC}" >&2
    echo -e "  ${CYAN}https://github.com/${GITHUB_REPO}/releases${NC}" >&2
    echo "" >&2
    echo -e "  ${BOLD}所需文件名格式：${NC}" >&2
    echo -e "  ${GREEN}incudal-vX.Y.Z-linux-${ARCH}.tar.gz${NC}" >&2
    echo "" >&2
    echo -e "  ${DIM}提示: 可使用 scp、wget、rz 等方式将文件传到服务器${NC}" >&2
    echo -e "  ${DIM}例如: scp incudal-v1.0.0-linux-${ARCH}.tar.gz root@服务器IP:${MANUAL_PKG_DIR}/${NC}" >&2
    divider
    echo "" >&2

    # 创建目录
    mkdir -p "$MANUAL_PKG_DIR"

    # 轮询等待文件出现
    local wait_count=0
    local max_wait=600  # 最多等 10 分钟（含上传时间）
    local spin_chars='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
    local MIN_SIZE_KB=10240  # 产物包至少 10MB

    while true; do
        # 尝试扫描
        local pkg_file=""
        pkg_file=$(scan_manual_package) || true

        if [[ -n "$pkg_file" ]]; then
            # 检测到文件，等待上传完成（文件大小稳定）
            echo "" >&2
            info "检测到文件: $(basename "$pkg_file")"
            info "等待上传完成..."

            local stable_count=0
            local last_size=0

            while true; do
                local current_size
                current_size=$(stat -c%s "$pkg_file" 2>/dev/null || echo "0")
                local current_size_human
                current_size_human=$(du -h "$pkg_file" 2>/dev/null | cut -f1 || echo "?")

                if [[ "$current_size" -eq "$last_size" && "$current_size" -gt 0 ]]; then
                    stable_count=$((stable_count + 1))
                else
                    stable_count=0
                    last_size="$current_size"
                fi

                # 连续 3 次（9 秒）大小不变，认为上传完成
                if [[ $stable_count -ge 3 ]]; then
                    # 检查最小文件大小
                    local size_kb=$((current_size / 1024))
                    if [[ $size_kb -lt $MIN_SIZE_KB ]]; then
                        warn "文件过小 (${current_size_human})，产物包通常 >100MB，可能不完整"
                        warn "如确认无误，请将文件删除后重新放置"
                        # 继续等待
                        stable_count=0
                        last_size=0
                        sleep 3
                        continue
                    fi

                    log "上传完成！文件大小: ${current_size_human}"
                    echo "$pkg_file"
                    return 0
                fi

                printf "\r  ${CYAN}⏳${NC} 上传中... 当前大小: ${current_size_human}  " >&2
                sleep 3
                wait_count=$((wait_count + 3))

                if [[ $wait_count -ge $max_wait ]]; then
                    echo "" >&2
                    error "等待超时 (${max_wait}s)，请重新运行脚本"
                    return 1
                fi
            done
        fi

        # 显示等待动画（输出到 stderr）
        local spin_idx=$((wait_count % ${#spin_chars}))
        local spin_char="${spin_chars:$spin_idx:1}"
        printf "\r  ${CYAN}${spin_char}${NC} 等待产物包... (已等待 %ds，输入 Ctrl+C 取消)  " "$wait_count" >&2

        sleep 2
        wait_count=$((wait_count + 2))

        if [[ $wait_count -ge $max_wait ]]; then
            echo "" >&2
            error "等待超时 (${max_wait}s)，请重新运行脚本"
            return 1
        fi
    done
}

# ========================== 统一入口：获取产物包 ==========================
obtain_release() {
    step "获取 Incudal 产物包..."

    # ---- 阶段 0：检查是否已有手动放置的包 ----
    local existing_pkg=""
    existing_pkg=$(scan_manual_package) || true
    if [[ -n "$existing_pkg" ]]; then
        log "检测到手动放置的产物包: $(basename "$existing_pkg")"
        echo "$existing_pkg"
        return 0
    fi

    # ---- 阶段 1：尝试 API 自动获取版本号 ----
    info "正在查询最新版本（5 秒超时）..."
    local version=""
    version=$(get_latest_version)

    if [[ -n "$version" ]]; then
        info "最新版本: ${version}"

        # ---- 阶段 2：尝试自动下载 ----
        local tar_file=""
        tar_file=$(download_release "$version") || true

        if [[ -n "$tar_file" && -f "$tar_file" ]]; then
            echo "$tar_file"
            return 0
        fi

        warn "自动下载失败（文件可能不存在或网络受限）"
    else
        warn "自动获取版本号失败（仓库可能是私有的）"
    fi

    # ---- 阶段 3：引导用户手动放置包 ----
    local manual_file=""
    manual_file=$(wait_for_manual_package) || return 1
    echo "$manual_file"
    return 0
}

# ========================== 解压安装 ==========================
install_release() {
    local tar_file="$1"
    local is_upgrade="${2:-false}"

    step "安装产物包..."

    # 创建安装目录
    mkdir -p "$INSTALL_DIR"

    if [[ "$is_upgrade" == "true" ]]; then
        # 升级模式：先备份当前版本
        info "备份当前版本..."
        local backup_dir="${INSTALL_DIR}.bak.$(date +%Y%m%d%H%M%S)"
        cp -r "$INSTALL_DIR" "$backup_dir"
        info "备份已保存到: ${backup_dir}"

        # 保留 .env 文件和证书目录
        local env_backup=""
        local certs_backup=""
        if [[ -f "${INSTALL_DIR}/.env" ]]; then
            env_backup=$(mktemp)
            cp "${INSTALL_DIR}/.env" "$env_backup"
        fi
        if [[ -d "${INSTALL_DIR}/server/certs" ]]; then
            certs_backup=$(mktemp -d)
            cp -r "${INSTALL_DIR}/server/certs" "$certs_backup/"
        fi

        # 清理旧文件（保留 .env 和 certs）
        rm -rf "${INSTALL_DIR}/client" "${INSTALL_DIR}/server/dist" "${INSTALL_DIR}/server/node_modules"

        # 解压新版本
        tar -xzf "$tar_file" -C "$INSTALL_DIR" --strip-components=0

        # 恢复 .env 和证书
        if [[ -n "$env_backup" && -f "$env_backup" ]]; then
            cp "$env_backup" "${INSTALL_DIR}/.env"
            rm -f "$env_backup"
        fi
        if [[ -n "$certs_backup" && -d "$certs_backup/certs" ]]; then
            mkdir -p "${INSTALL_DIR}/server/certs"
            cp -r "$certs_backup/certs/"* "${INSTALL_DIR}/server/certs/" 2>/dev/null || true
            rm -rf "$certs_backup"
        fi
    else
        # 全新安装
        tar -xzf "$tar_file" -C "$INSTALL_DIR" --strip-components=0
    fi

    # 清理下载的临时文件
    rm -f "$tar_file"

    # 创建证书目录
    mkdir -p "${INSTALL_DIR}/server/certs"

    log "产物包安装完成"
}

# ========================== 创建系统用户 ==========================
create_user() {
    step "配置系统用户..."

    if id "$RUN_USER" &>/dev/null; then
        log "用户 ${RUN_USER} 已存在，跳过"
    else
        useradd --system --home-dir "${INSTALL_DIR}" --shell /usr/sbin/nologin "$RUN_USER"
        log "系统用户 ${RUN_USER} 创建完成"
    fi

    # 创建 npm 缓存目录（npx/prisma 需要可写的 home 目录）
    mkdir -p "${INSTALL_DIR}/.npm"
    mkdir -p "${INSTALL_DIR}/.cache"

    # 设置目录权限
    chown -R "${RUN_USER}:${RUN_USER}" "$INSTALL_DIR"
    chmod 750 "$INSTALL_DIR"
    chmod 600 "${ENV_FILE}" 2>/dev/null || true
}

# ========================== 生成面板客户端证书 ==========================
generate_panel_cert() {
    local cert_dir="${INSTALL_DIR}/server/certs"
    local cert_file="${cert_dir}/client.crt"
    local key_file="${cert_dir}/client.key"

    step "配置面板客户端证书..."

    # 幂等性：证书已存在则跳过
    if [[ -f "$cert_file" && -f "$key_file" ]]; then
        log "面板客户端证书已存在，跳过生成"
        return 0
    fi

    mkdir -p "$cert_dir"

    # 生成自签名客户端证书（用于面板与 Incus API 的 mTLS 通信）
    info "生成面板客户端证书（RSA 4096 位，有效期 10 年）..."
    openssl req -x509 -newkey rsa:4096 \
        -keyout "$key_file" \
        -out "$cert_file" \
        -days 3650 -nodes \
        -subj "/CN=incudal-panel/O=Incudal" \
        2>/dev/null

    # 设置权限：只有 incudal 用户可读
    chmod 600 "$cert_file" "$key_file"
    chown "${RUN_USER}:${RUN_USER}" "$cert_file" "$key_file"

    log "面板客户端证书生成完成"
    info "证书路径: ${cert_file}"
    info "密钥路径: ${key_file}"
}

# ========================== 配置数据库 ==========================
setup_database() {
    local db_password="$1"

    step "配置 PostgreSQL 数据库..."

    # 检查数据库和用户是否已存在
    local db_exists
    db_exists=$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='incudal'" 2>/dev/null || echo "")

    if [[ "$db_exists" == "1" ]]; then
        info "数据库 'incudal' 已存在，跳过创建"
        # 更新密码
        sudo -u postgres psql -c "ALTER USER incudal WITH PASSWORD '${db_password}';" >/dev/null 2>&1 || true
    else
        # 创建用户和数据库
        sudo -u postgres psql -c "CREATE USER incudal WITH PASSWORD '${db_password}';" >/dev/null 2>&1 || true
        sudo -u postgres psql -c "CREATE DATABASE incudal OWNER incudal;" >/dev/null 2>&1
        sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE incudal TO incudal;" >/dev/null 2>&1
        log "数据库 'incudal' 创建完成"
    fi
}

# ========================== 生成环境变量 ==========================
generate_env() {
    local db_password="$1"
    local redis_password="$2"
    local admin_password="${3:-admin123}"

    step "生成环境配置..."

    if [[ -f "$ENV_FILE" ]]; then
        info ".env 文件已存在，检查并补齐缺失的密钥配置"
        ensure_env_keys
        return 0
    fi

    local jwt_secret
    jwt_secret=$(gen_secret 48)
    local cookie_secret
    cookie_secret=$(gen_secret 48)
    local encryption_key
    encryption_key=$(openssl rand -base64 32)

    cat > "$ENV_FILE" << EOF
# ============================================================================
# Incudal 环境配置
# 由安装脚本自动生成于 $(date '+%Y-%m-%d %H:%M:%S')
# ============================================================================

# ============ 运行环境 ============
NODE_ENV=production
HOST=127.0.0.1
PORT=${DEFAULT_PORT}

# ============ 数据库配置 ============
DATABASE_URL=postgresql://incudal:${db_password}@127.0.0.1:5432/incudal

# ============ Redis 配置 ============
REDIS_URL=redis://:${redis_password}@127.0.0.1:6379

# ============ 安全配置（请勿泄露！）============
JWT_SECRET=${jwt_secret}
COOKIE_SECRET=${cookie_secret}
ENCRYPTION_KEY=${encryption_key}

# ============ 应用配置 ============
APP_PORT=${DEFAULT_PORT}
ADMIN_PASSWORD=${admin_password}
LOG_LEVEL=info
DISABLE_REQUEST_LOG=true

# ============ CORS 配置（必须修改为实际域名！）============
# 支付回调地址也会使用这个域名，必须是公网可访问的地址
FRONTEND_URL=

# ============ 监控告警（可选）============
# ALERT_WEBHOOK_URL=https://your-webhook-url
EOF

    chmod 600 "$ENV_FILE"
    chown "${RUN_USER}:${RUN_USER}" "$ENV_FILE"

    log "环境配置文件生成完成: ${ENV_FILE}"
}

# ========================== 配置 Redis 密码 ==========================
setup_redis() {
    local redis_password="$1"

    step "配置 Redis..."

    local redis_conf="/etc/redis/redis.conf"
    if [[ -f "$redis_conf" ]]; then
        # 设置密码
        if grep -q "^requirepass" "$redis_conf" 2>/dev/null; then
            sed -i "s/^requirepass.*/requirepass ${redis_password}/" "$redis_conf"
        elif grep -q "^# requirepass" "$redis_conf" 2>/dev/null; then
            sed -i "s/^# requirepass.*/requirepass ${redis_password}/" "$redis_conf"
        else
            echo "requirepass ${redis_password}" >> "$redis_conf"
        fi

        systemctl restart redis-server
        log "Redis 密码配置完成"
    else
        warn "Redis 配置文件不存在，跳过密码配置"
    fi
}

# ========================== 运行数据库迁移 ==========================
run_migrations() {
    step "执行数据库迁移..."

    cd "${INSTALL_DIR}/server"

    # 以 incudal 用户身份加载 .env 并运行迁移
    # HOME 需要指向有写权限的目录，否则 npm 缓存报 EACCES
    sudo -u "$RUN_USER" HOME="${INSTALL_DIR}" bash -c "
        set -a
        source '${ENV_FILE}'
        set +a
        cd '${INSTALL_DIR}/server'
        npx prisma migrate deploy
    "

    log "数据库迁移完成"
}

# ========================== 创建 systemd 服务 ==========================
create_service() {
    step "创建 systemd 服务..."

    cat > "$SERVICE_FILE" << EOF
[Unit]
Description=Incudal 容器虚拟化管理平台
Documentation=https://github.com/${GITHUB_REPO}
After=network.target postgresql.service redis-server.service
Requires=postgresql.service redis-server.service

[Service]
Type=simple
User=${RUN_USER}
Group=${RUN_USER}
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${ENV_FILE}

# 确保 npm 缓存目录可写
Environment=HOME=${INSTALL_DIR}
Environment=NPM_CONFIG_CACHE=${INSTALL_DIR}/.npm

# 启动前自动执行数据库迁移
ExecStartPre=/usr/bin/bash -c 'cd ${INSTALL_DIR}/server && npx prisma migrate deploy'

# 启动主程序
ExecStart=/usr/bin/node ${INSTALL_DIR}/server/dist/app.js

# 优雅关闭
KillMode=mixed
KillSignal=SIGTERM
TimeoutStopSec=30

# 自动重启
Restart=on-failure
RestartSec=10
StartLimitBurst=5
StartLimitIntervalSec=300

# 安全加固
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${INSTALL_DIR}/server/certs
PrivateTmp=true

# 资源限制
LimitNOFILE=65536

# 日志
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable "$SERVICE_NAME" >/dev/null 2>&1

    log "systemd 服务创建完成"
}

# ========================== Nginx + Certbot ==========================
setup_nginx_certbot() {
    info "准备配置 Nginx 反代及 Let's Encrypt SSL 自动证书"
    echo -ne "  ${BOLD}请输入你要绑定的域名 (例如 panel.yourdomain.com): ${NC}"
    read -r DOMAIN

    if [[ -z "$DOMAIN" ]]; then
        error "域名不能为空！"
        return 1
    fi

    echo -ne "  ${BOLD}请输入你的邮箱 (用于证书过期通知，可留空): ${NC}"
    read -r EMAIL

    info "安装 Nginx 与 Certbot..."
    apt-get install -y -qq nginx certbot python3-certbot-nginx >/dev/null 2>&1

    # 更新 FRONTEND_URL
    sed -i "s|^FRONTEND_URL=.*|FRONTEND_URL=https://${DOMAIN}|" "$ENV_FILE"

    log "配置 Nginx 站点..."
    cat > /etc/nginx/sites-available/incudal.conf <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    # 安全头
    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options DENY;

    location / {
        proxy_pass http://127.0.0.1:${DEFAULT_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;

        # WebSocket 超时
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
NGINX

    ln -sf /etc/nginx/sites-available/incudal.conf /etc/nginx/sites-enabled/
    # 移除默认站点（避免冲突）
    rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
    nginx -t >/dev/null 2>&1
    systemctl reload nginx

    log "申请 Let's Encrypt SSL 证书..."
    if [[ -n "$EMAIL" ]]; then
        certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect
    else
        certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect
    fi

    log "HTTPS 配置完成！访问地址: https://${DOMAIN}"
}

# ========================== Cloudflare Tunnel ==========================
setup_cf_tunnel() {
    info "准备配置 Cloudflare Tunnel 内网穿透"
    echo -e "  ${DIM}请先在 Cloudflare Zero Trust 管理后台创建 Tunnel${NC}"
    echo -e "  ${DIM}并将 Public Hostname 的目标路由设置为 http://localhost:${DEFAULT_PORT}${NC}"
    echo ""
    echo -ne "  ${BOLD}请输入 Cloudflare Tunnel Token: ${NC}"
    read -r CF_TOKEN

    if [[ -z "$CF_TOKEN" ]]; then
        error "Token 不能为空！"
        return 1
    fi

    echo -ne "  ${BOLD}请输入绑定的域名 (例: panel.yourdomain.com): ${NC}"
    read -r DOMAIN

    if [[ -n "$DOMAIN" ]]; then
        sed -i "s|^FRONTEND_URL=.*|FRONTEND_URL=https://${DOMAIN}|" "$ENV_FILE"
    fi

    # 安装 cloudflared
    if ! command -v cloudflared &>/dev/null; then
        info "安装 cloudflared..."
        curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH} \
            -o /usr/local/bin/cloudflared
        chmod +x /usr/local/bin/cloudflared
    fi

    # 创建 cloudflared systemd 服务
    cloudflared service install "$CF_TOKEN" 2>/dev/null || true

    log "Cloudflare Tunnel 配置完成！"
    if [[ -n "$DOMAIN" ]]; then
        echo -e "  访问地址: ${GREEN}https://${DOMAIN}${NC}"
    fi
}

# ========================== 启动服务 ==========================
start_service() {
    step "启动 Incudal 服务..."

    systemctl start "$SERVICE_NAME"

    # 等待几秒检查状态
    sleep 3

    if systemctl is-active --quiet "$SERVICE_NAME"; then
        log "Incudal 服务启动成功！"
    else
        error "服务启动失败，查看日志："
        journalctl -u "$SERVICE_NAME" --no-pager -n 20
        exit 1
    fi
}

# ========================== 显示安装结果 ==========================
show_result() {
    echo ""
    divider
    echo -e "  ${GREEN}${BOLD}✅ Incudal 面板部署成功！${NC}"
    divider
    echo ""
    echo -e "  ${BOLD}面板信息${NC}"
    echo -e "  安装路径  :  ${GREEN}${INSTALL_DIR}${NC}"
    echo -e "  配置文件  :  ${GREEN}${ENV_FILE}${NC}"
    echo -e "  服务名称  :  ${GREEN}${SERVICE_NAME}${NC}"
    echo -e "  监听端口  :  ${GREEN}${DEFAULT_PORT}${NC}"
    echo ""
    echo -e "  ${BOLD}默认账号${NC}"
    echo -e "  用户名    :  ${GREEN}admin${NC}"
    echo -e "  密码      :  ${GREEN}admin123${NC}  ${YELLOW}（请在首次登录后立即修改！）${NC}"
    echo ""
    echo -e "  ${BOLD}常用命令${NC}"
    echo -e "  启动服务  :  ${CYAN}systemctl start ${SERVICE_NAME}${NC}"
    echo -e "  停止服务  :  ${CYAN}systemctl stop ${SERVICE_NAME}${NC}"
    echo -e "  重启服务  :  ${CYAN}systemctl restart ${SERVICE_NAME}${NC}"
    echo -e "  查看状态  :  ${CYAN}systemctl status ${SERVICE_NAME}${NC}"
    echo -e "  查看日志  :  ${CYAN}journalctl -u ${SERVICE_NAME} -f${NC}"
    echo ""
    divider
}

# ========================== 升级流程 ==========================
do_upgrade() {
    show_banner
    check_os

    if ! check_existing; then
        error "未检测到已安装的 Incudal，请先执行全新安装"
        exit 1
    fi

    info "检测到已安装的 Incudal，准备升级..."

    # 停止服务
    info "停止当前服务..."
    systemctl stop "$SERVICE_NAME" 2>/dev/null || true

    # 获取产物包（自动下载或手动放置）
    local tar_file
    tar_file=$(obtain_release) || exit 1
    if [[ -z "$tar_file" ]]; then
        exit 1
    fi
    install_release "$tar_file" true

    # 修复权限
    chown -R "${RUN_USER}:${RUN_USER}" "$INSTALL_DIR"

    # 运行迁移
    run_migrations

    # 重启服务
    start_service

    echo ""
    divider
    echo -e "  ${GREEN}${BOLD}✅ Incudal 升级到 ${version} 完成！${NC}"
    divider
}

# ========================== 卸载流程 ==========================
do_uninstall() {
    show_banner

    echo -e "  ${RED}${BOLD}⚠️  警告：卸载将执行以下操作：${NC}"
    echo -e "  ${RED}  1. 停止并删除 Incudal systemd 服务${NC}"
    echo -e "  ${RED}  2. 删除安装目录 ${INSTALL_DIR}${NC}"
    echo -e "  ${RED}  3. 删除系统用户 ${RUN_USER}${NC}"
    echo -e "  ${YELLOW}  注意：PostgreSQL/Redis 和数据库数据不会被删除${NC}"
    echo ""
    echo -ne "  ${BOLD}确认卸载？${NC}[y/N]: "
    read -r confirm
    if [[ ! "$confirm" =~ ^[yY]$ ]]; then
        info "已取消卸载"
        exit 0
    fi

    # 停止服务
    systemctl stop "$SERVICE_NAME" 2>/dev/null || true
    systemctl disable "$SERVICE_NAME" 2>/dev/null || true
    rm -f "$SERVICE_FILE"
    systemctl daemon-reload

    # 删除安装目录
    rm -rf "$INSTALL_DIR"

    # 删除用户
    userdel "$RUN_USER" 2>/dev/null || true

    # 清理 Nginx 配置
    rm -f /etc/nginx/sites-enabled/incudal.conf 2>/dev/null || true
    rm -f /etc/nginx/sites-available/incudal.conf 2>/dev/null || true
    systemctl reload nginx 2>/dev/null || true

    echo ""
    log "Incudal 已完全卸载"
    info "数据库数据保留在 PostgreSQL 中，如需删除请手动执行："
    echo -e "  ${CYAN}sudo -u postgres psql -c \"DROP DATABASE incudal;\"${NC}"
    echo -e "  ${CYAN}sudo -u postgres psql -c \"DROP USER incudal;\"${NC}"
}

# ========================== 全新安装流程 ==========================
do_install() {
    show_banner
    check_os

    if check_existing; then
        warn "检测到已安装的 Incudal (${INSTALL_DIR})"
        info "产物包已解压就绪，将跳过下载步骤，直接从配置阶段继续"
        info "如需全新安装，请先运行: sudo bash $0 --uninstall"
        echo "" >&2
    fi

    # 密码处理：如果 .env 已存在则复用旧密码，避免密码不一致
    local db_password
    local redis_password

    if [[ -f "$ENV_FILE" ]]; then
        info "检测到已有 .env 配置，复用现有密码"
        # 从 DATABASE_URL 提取密码: postgresql://user:PASSWORD@host:port/db
        db_password=$(grep -oP 'DATABASE_URL=postgresql://[^:]+:\K[^@]+' "$ENV_FILE" 2>/dev/null || echo "")
        # 从 REDIS_URL 提取密码: redis://:PASSWORD@host:port
        redis_password=$(grep -oP 'REDIS_URL=redis://:\K[^@]+' "$ENV_FILE" 2>/dev/null || echo "")

        if [[ -z "$db_password" ]]; then
            warn "无法从 .env 提取数据库密码，将生成新密码并重写 .env"
            db_password=$(gen_password 24)
            rm -f "$ENV_FILE"
        fi
        if [[ -z "$redis_password" ]]; then
            redis_password=$(gen_password 24)
        fi
    else
        db_password=$(gen_password 24)
        redis_password=$(gen_password 24)
    fi

    # 安装依赖
    step "更新系统包索引..."
    apt-get update -qq >/dev/null 2>&1

    install_nodejs
    install_postgresql
    install_redis

    # 仅在全新安装时获取和解压产物包（已安装则跳过）
    if ! check_existing; then
        # 获取产物包（自动下载或手动放置）
        local tar_file
        tar_file=$(obtain_release) || exit 1
        if [[ -z "$tar_file" ]]; then
            exit 1
        fi

        # 解压安装
        install_release "$tar_file" false
    else
        log "产物包已就绪，跳过下载和解压"
    fi

    # 创建用户
    create_user

    # 生成面板客户端证书（与 Incus API mTLS 通信所需）
    generate_panel_cert

    # 配置数据库
    setup_database "$db_password"

    # 配置 Redis
    setup_redis "$redis_password"

    # 生成 .env
    generate_env "$db_password" "$redis_password"

    # 创建 systemd 服务
    create_service

    # 运行数据库迁移
    run_migrations

    # 选择网络方案
    echo ""
    divider
    echo -e "  ${BOLD}请选择外部访问方案：${NC}"
    divider
    echo -e "  ${CYAN}[1]${NC} Nginx + Certbot   ${YELLOW}（推荐：自动 HTTPS，需要公网 IP 和域名）${NC}"
    echo -e "  ${CYAN}[2]${NC} Cloudflare Tunnel  ${YELLOW}（适合无公网 IP 或隐藏源站 IP）${NC}"
    echo -e "  ${CYAN}[3]${NC} 仅启动服务        ${DIM}（手动配置反代）${NC}"
    echo ""
    echo -ne "  ${BOLD}请选择 [1-3]: ${NC}"
    read -r net_opt

    case "${net_opt:-3}" in
        1) setup_nginx_certbot ;;
        2) setup_cf_tunnel ;;
        3) info "跳过网络配置，服务将监听 127.0.0.1:${DEFAULT_PORT}" ;;
        *) info "无效选项，跳过网络配置" ;;
    esac

    # 启动服务
    start_service

    # 显示结果
    show_result
}

# ========================== 主入口 ==========================
main() {
    check_root

    case "${1:-}" in
        --upgrade|-u)
            do_upgrade
            ;;
        --uninstall|--remove)
            do_uninstall
            ;;
        --help|-h)
            echo "Incudal 面板部署脚本 v${SCRIPT_VERSION}"
            echo ""
            echo "用法: sudo bash $0 [选项]"
            echo ""
            echo "选项:"
            echo "  (无参数)      全新安装"
            echo "  --upgrade     升级已有安装"
            echo "  --uninstall   卸载 Incudal"
            echo "  --help        显示帮助"
            ;;
        *)
            do_install
            ;;
    esac
}

main "$@"
