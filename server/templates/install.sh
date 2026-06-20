#!/usr/bin/env bash
# ============================================================================
# Incudal 节点安装管理脚本
# 将 Ubuntu / Debian 服务器配置为 Incudal 面板管理的 Incus LXC 容器节点
#
# 用法:
#   交互式: sudo bash Incudal.sh
#   命令行: sudo bash Incudal.sh --mode nat --token <TOKEN>
#   卸载:   sudo bash Incudal.sh --uninstall
#
# 项目地址: https://incudal.com
# ============================================================================
set -euo pipefail

# ========面板动态注入区========
# 面板在下载时自动注入以下变量，无需手动修改
INJECT_PANEL_URL=""
INJECT_TOKEN=""
INJECT_MODE=""
INJECT_IPV6_SUBNET=""
INJECT_IPV6_IFACE=""
INJECT_AGENT_ID=""
INJECT_AGENT_SECRET=""
INJECT_AGENT_INSTALL_TOKEN=""
INJECT_AGENT_BINARY_URL=""
INJECT_AGENT_ENABLED="true"
# ==============================

# ========================== 全局常量 ==========================
PANEL_URL="${INJECT_PANEL_URL:-}"
PANEL_URL="${PANEL_URL%/}"
readonly PANEL_URL
readonly SCRIPT_VERSION="2.0.0"
readonly BRIDGE_SUBNET="10.10.0.1/22"
readonly BRIDGE_NAME="incusbr0"
readonly PRESEED_FILE="/tmp/.incus-preseed-$$.yaml"
readonly AGENT_ID="${INJECT_AGENT_ID:-}"
readonly AGENT_SECRET="${INJECT_AGENT_SECRET:-}"
readonly AGENT_INSTALL_TOKEN="${INJECT_AGENT_INSTALL_TOKEN:-}"
readonly AGENT_BINARY_URL="${INJECT_AGENT_BINARY_URL:-}"
readonly AGENT_ENABLED="${INJECT_AGENT_ENABLED:-true}"
readonly AGENT_SERVICE_NAME="incudal-agent"
readonly AGENT_CONFIG_FILE="${INCUDAL_AGENT_CONFIG_FILE:-/etc/incudal-agent/config.yaml}"
readonly AGENT_BIN_PATH="${INCUDAL_AGENT_BIN:-/usr/local/bin/incudal-agent}"

# ZFS 预编译模块下载地址（GitHub Release）
# 格式: ${ZFS_PREBUILT_URL}/zfs-modules-<内核版本>.tar.gz
readonly ZFS_PREBUILT_URL="https://github.com/0xdabiaoge/Incudal-Debian-ZFS/releases/download/Debian-ZFS"

# ========================== 颜色定义 ==========================
readonly RED='\033[1;31m'
readonly GREEN='\033[1;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[1;34m'
readonly CYAN='\033[1;36m'
readonly BOLD='\033[1m'
readonly DIM='\033[2m'
readonly NC='\033[0m'

# ========================== 运行时变量 ==========================
MODE=""
TOKEN=""
OS_ID=""
OS_VERSION=""
OS_CODENAME=""
ARCH=""
DEFAULT_IFACE=""
IS_PURE_IPV6="false"
AGENT_INSTALL_STATUS="未安装"
AGENT_HEARTBEAT_INTERVAL_SECONDS="30"

# ========================== 工具函数 ==========================
log()   { echo -e "${GREEN}[✓]${NC} $1"; }
info()  { echo -e "${BLUE}[i]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; }
step()  { echo -e "\n${CYAN}[▶]${NC} ${BOLD}$1${NC}"; }

# 分隔线
divider() {
    echo -e "${DIM}────────────────────────────────────────────────────${NC}"
}

pause_return() {
    if [[ -t 0 ]]; then
        echo ""
        echo -ne "  ${DIM}按回车返回菜单...${NC}"
        read -r _
    fi
}

mask_value() {
    local value="${1:-}"
    local length=${#value}
    if [[ -z "$value" ]]; then
        echo "-"
    elif (( length <= 12 )); then
        echo "${value:0:4}****"
    else
        echo "${value:0:8}...${value: -4}"
    fi
}

is_http_url() {
    local value="${1:-}"
    [[ "$value" =~ ^https?://[^[:space:]]+$ ]]
}

read_agent_config_value() {
    local key="$1"
    if [[ ! -f "$AGENT_CONFIG_FILE" ]]; then
        return 0
    fi

    local line=""
    line=$(grep -E "^[[:space:]]*${key}[[:space:]]*:" "$AGENT_CONFIG_FILE" 2>/dev/null | head -n1 || true)
    if [[ -z "$line" ]]; then
        return 0
    fi

    local value="${line#*:}"
    value=$(printf '%s' "$value" | sed -E "s/[[:space:]]+#.*$//; s/^[[:space:]]+//; s/[[:space:]]+$//; s/^\"(.*)\"$/\1/; s/^'(.*)'$/\1/")
    printf '%s\n' "$value"
}

get_agent_panel_url() {
    local config_panel_url=""
    config_panel_url=$(read_agent_config_value "panel_url" || true)
    if [[ -n "$config_panel_url" ]]; then
        echo "${config_panel_url%/}"
        return 0
    fi
    if [[ -n "$PANEL_URL" ]]; then
        echo "${PANEL_URL%/}"
        return 0
    fi
    return 0
}

extract_agent_install_token() {
    local input="$1"
    printf '%s\n' "$input" | grep -Eo 'ait_[A-Za-z0-9_-]{32,}' | head -n1 || true
}

extract_agent_panel_url() {
    local input="$1"
    printf '%s\n' "$input" \
        | sed -nE "s#.*(https?://[^[:space:]'\\\"]+)/api/agent/install\\.sh.*#\\1#p" \
        | head -n1 || true
}

normalize_agent_interval() {
    local value="${1:-30}"
    if [[ "$value" =~ ^[0-9]+$ ]] && (( value >= 5 && value <= 3600 )); then
        echo "$value"
    else
        echo "30"
    fi
}

prompt_agent_heartbeat_interval() {
    local default_interval=""
    default_interval=$(normalize_agent_interval "${1:-30}")

    if [[ ! -t 0 ]]; then
        AGENT_HEARTBEAT_INTERVAL_SECONDS="$default_interval"
        return 0
    fi

    echo -ne "  ${BOLD}Agent 上报间隔秒数 [默认 ${default_interval}，范围 5-3600]: ${NC}"
    local agent_interval=""
    read -r agent_interval

    if [[ -z "$agent_interval" ]]; then
        AGENT_HEARTBEAT_INTERVAL_SECONDS="$default_interval"
    elif [[ "$agent_interval" =~ ^[0-9]+$ ]] && (( agent_interval >= 5 && agent_interval <= 3600 )); then
        AGENT_HEARTBEAT_INTERVAL_SECONDS="$agent_interval"
    else
        warn "Agent 上报间隔无效，已使用默认 ${default_interval} 秒"
        AGENT_HEARTBEAT_INTERVAL_SECONDS="$default_interval"
    fi
}

show_agent_summary_line() {
    local label="${DIM}未安装${NC}"
    if command -v systemctl &>/dev/null && systemctl is-active --quiet "$AGENT_SERVICE_NAME" 2>/dev/null; then
        label="${GREEN}运行中${NC}"
    elif [[ -f "$AGENT_CONFIG_FILE" || -x "$AGENT_BIN_PATH" ]]; then
        label="${YELLOW}已安装（未运行）${NC}"
    fi
    echo -e "  Agent    :  ${label}"
}

# 清理临时文件
cleanup() {
    rm -f "$PRESEED_FILE" 2>/dev/null || true
}
trap cleanup EXIT

# ========================== 显示横幅 ==========================
show_banner() {
    clear 2>/dev/null || true
    echo ""
    echo -e "${CYAN}  ╔══════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}  ║                                                  ║${NC}"
    echo -e "${CYAN}  ║            ${BOLD}Incudal 节点安装管理脚本${NC}${CYAN}              ║${NC}"
    echo -e "${CYAN}  ║            ${DIM}LXC Container Host Setup${NC}${CYAN}              ║${NC}"
    echo -e "${CYAN}  ║                                                  ║${NC}"
    echo -e "${CYAN}  ╚══════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  ${DIM}版本: ${SCRIPT_VERSION}  |  面板: ${PANEL_URL}${NC}"
    echo ""
}

# ========================== 系统检测 ==========================
detect_system() {
    # 检测 /etc/os-release 是否存在
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

    # 版本兼容性检查
    case "$OS_ID" in
        ubuntu)
            # 建议 Ubuntu 22.04+
            local ubuntu_major="${OS_VERSION%%.*}"
            if [[ "$ubuntu_major" -lt 22 ]] 2>/dev/null; then
                warn "Ubuntu 版本较低 (${OS_VERSION})，建议使用 22.04 或 24.04"
                echo -ne "  是否继续？[y/N]: "
                read -r confirm
                [[ "$confirm" =~ ^[yY]$ ]] || exit 0
            fi
            ;;
        debian)
            # 最低 Debian 11 (Bullseye)
            local deb_major="${OS_VERSION%%.*}"
            if [[ "$deb_major" -lt 11 ]] 2>/dev/null; then
                error "Debian 版本过低 (${OS_VERSION})，最低要求 Debian 11 (Bullseye)"
                exit 1
            fi
            ;;
    esac

    # 检测默认网络接口
    DEFAULT_IFACE=$(ip route get 8.8.8.8 2>/dev/null | awk -F'dev ' '{print $2}' | awk '{print $1}' | head -n1 || true)
    if [[ -z "$DEFAULT_IFACE" ]]; then
        warn "无法通过默认路由检测网络接口"
        # 回退：获取第一个非 lo 的 UP 接口
        DEFAULT_IFACE=$(ip -o link show up 2>/dev/null | awk -F': ' '{print $2}' | grep -v lo | head -n1 || true)
        if [[ -z "$DEFAULT_IFACE" ]]; then
            error "未找到可用的网络接口"
            exit 1
        fi
        info "使用备选接口: ${DEFAULT_IFACE}"
    fi

    # 纯 IPv6 环境检测 (双通道并发)
    if ! curl -4 -s --connect-timeout 2 1.1.1.1 >/dev/null 2>&1; then
        if curl -6 -s --connect-timeout 2 "https://[2606:4700:4700::1111]" >/dev/null 2>&1; then
            IS_PURE_IPV6="true"
            info "检测到当前服务器为【纯 IPv6 (Pure IPv6)】"
        fi
    fi
}

# ========================== 显示系统信息 ==========================
show_system_info() {
    divider
    echo -e "  ${BOLD}系统信息${NC}"
    divider

    # 操作系统名称格式化
    local os_label=""
    case "$OS_ID" in
        ubuntu) os_label="Ubuntu" ;;
        debian) os_label="Debian" ;;
        *)      os_label="$OS_ID" ;;
    esac

    echo -e "  操作系统  :  ${GREEN}${os_label} ${OS_VERSION}${NC} (${OS_CODENAME})"
    echo -e "  系统架构  :  ${GREEN}${ARCH}${NC}"
    echo -e "  默认接口  :  ${GREEN}${DEFAULT_IFACE}${NC}"
    echo -e "  主 机 名  :  ${GREEN}$(hostname)${NC}"

    if [[ "$IS_PURE_IPV6" == "true" ]]; then
        echo -e "  网络环境  :  ${YELLOW}纯 IPv6 (Pure IPv6) - 将启用 WARP 出站接力${NC}"
    else
        echo -e "  网络环境  :  ${GREEN}原生 IPv4 可达${NC}"
    fi

    # 检查 Incus 安装状态
    if command -v incus &>/dev/null; then
        local incus_ver
        incus_ver=$(incus version 2>/dev/null | awk '/Client version/ {print $3}' || echo "未知")
        [[ -z "$incus_ver" ]] && incus_ver="未知"
        
        # 判断服务端是否能连通
        if ! incus version 2>/dev/null | grep -q -E "Server version: [0-9]"; then
            echo -e "  Incus     :  ${YELLOW}客户端残留（服务未在运行）${NC} (${incus_ver})"
        else
            echo -e "  Incus     :  ${GREEN}已安装并运行${NC} (${incus_ver})"
        fi

        # 检查网桥
        if incus network show "$BRIDGE_NAME" &>/dev/null; then
            echo -e "  网桥状态  :  ${YELLOW}${BRIDGE_NAME} 已存在${NC}"
        else
            echo -e "  网桥状态  :  ${DIM}未初始化${NC}"
        fi

        # 检查面板证书
        if incus config trust list --format csv 2>/dev/null | grep -q "panel"; then
            echo -e "  面板证书  :  ${YELLOW}已导入${NC}"
        else
            echo -e "  面板证书  :  ${DIM}未导入${NC}"
        fi
    else
        echo -e "  Incus     :  ${DIM}未安装${NC}"
    fi

    # 检查 RFW 防火墙状态
    if [[ -f /root/rfw/rfw ]]; then
        if systemctl is-active --quiet rfw 2>/dev/null; then
            local rfw_rules="未知"
            if [[ -f /etc/systemd/system/rfw.service ]]; then
                local exec_start
                exec_start=$(grep "^ExecStart=" /etc/systemd/system/rfw.service 2>/dev/null || true)
                if [[ "$exec_start" =~ "--block-all" ]] && [[ ! "$exec_start" =~ "--block-all-from" ]]; then
                    rfw_rules="全部阻止"
                else
                    rfw_rules=$(echo "$exec_start" | grep -o -- "--block-[a-z0-9-]*" | sed 's/--block-//g' | tr '\n' '/' | sed 's/\/$//')
                    [[ -z "$rfw_rules" ]] && rfw_rules="无协议过滤"
                fi
                
                local geo="无GeoIP"
                if [[ "$exec_start" =~ --countries\ ([A-Za-z,]*) ]]; then
                    geo="黑名单:${BASH_REMATCH[1]}"
                elif [[ "$exec_start" =~ --allow-only-countries\ ([A-Za-z,]*) ]]; then
                    geo="白名单:${BASH_REMATCH[1]}"
                elif [[ "$exec_start" =~ --block-all-from\ ([A-Za-z,]*) ]]; then
                    geo="黑名单:${BASH_REMATCH[1]}"
                fi
                rfw_rules="${rfw_rules} | ${geo}"
            fi
            echo -e "  RFW 防火墙:  ${GREEN}运行中${NC} (${rfw_rules})"
        else
            echo -e "  RFW 防火墙:  ${YELLOW}已安装（未运行）${NC}"
        fi
    else
        echo -e "  RFW 防火墙:  ${DIM}未安装${NC}"
    fi

    show_agent_summary_line

    divider
    echo ""
}

# ========================== 交互式菜单 ==========================
show_menu() {
    echo -e "  ${BOLD}请选择操作：${NC}"
    echo ""
    echo -e "    ${CYAN}1)${NC}  安装节点  ${DIM}─  仅 IPv4${NC}"
    echo -e "    ${CYAN}2)${NC}  安装节点  ${DIM}─  IPv4 + IPv6（自动检测配置）${NC}"
    echo -e "    ${CYAN}3)${NC}  安装 RFW  ${DIM}─  入站流量屏蔽防火墙${NC}"
    echo -e "    ${CYAN}4)${NC}  查看系统信息"
    echo -e "    ${CYAN}7)${NC}  网络模式说明（必看说明）"
    echo -e "    ${CYAN}8)${NC}  Agent 管理  ${DIM}─  安装 / 更新宿主机 Agent${NC}"
    echo ""
    echo -e "    ${RED}5)${NC}  卸载 RFW  ${DIM}─  移除 RFW 防火墙${NC}"
    echo -e "    ${RED}6)${NC}  卸载节点  ${DIM}─  彻底清理还原系统${NC}"
    echo -e "    ${CYAN}0)${NC}  退出"
    echo ""
    echo -ne "  ${BOLD}请输入选项 [0-8]: ${NC}"
}

# ========================== 网络模式说明 ==========================
show_network_mode_help() {
    echo ""
    divider
    echo -e "  ${BOLD}面板支持的网络模式说明${NC}"
    divider
    echo ""
    echo -e "  ${BOLD}节点安装模式（本脚本选择）：${NC}"
    echo ""
    echo -e "  ${CYAN}模式 1：仅 IPv4${NC}"
    echo -e "  节点只启用 IPv4 NAT 网桥，容器通过端口映射访问。"
    echo -e "  适合没有 IPv6 网段或不需要 IPv6 的场景。"
    echo ""
    echo -e "  ${CYAN}模式 2：IPv4 + IPv6${NC}"
    echo -e "  节点同时启用 IPv4 NAT 和 IPv6 路由转发。"
    echo -e "  安装后可在面板创建以下任意 IPv6 网络模式的实例。"
    echo ""
    echo -e "  ${BOLD}面板实例网络模式（在面板创建实例/套餐时选择）：${NC}"
    echo ""
    echo -e "  ${GREEN}IPv4 NAT${NC}"
    echo -e "  宿主机仅有 IPv4，通过端口映射给容器提供对外服务。"
    echo -e "  ${DIM}节点要求：模式 1 或 模式 2 均可${NC}"
    echo ""
    echo -e "  ${GREEN}IPv4 NAT + IPv6${NC}"
    echo -e "  宿主机拥有 IPv4 + 独立公网 IPv6 地址（双栈）。"
    echo -e "  IPv4 通过端口映射，IPv6 根据网段选择独立分配给容器。"
    echo -e "  ${DIM}节点要求：模式 2 + 配置 IPv6 子网${NC}"
    echo ""
    echo -e "  ${GREEN}IPv4 NAT + IPv6 NAT${NC}"
    echo -e "  宿主机拥有 IPv4 + IPv6（均为 NAT 共享宿主机出口）。"
    echo -e "  适用于宿主机只有单个 IPv6 地址或者不分配 IPv6 网段，全局共享宿主机的 IPv6。"
    echo -e "  ${DIM}节点要求：模式 2，无需 IPv6 子网${NC}"
    echo ""
    echo -e "  ${GREEN}IPv6 Only${NC}"
    echo -e "  宿主机仅有独立公网 IPv6（无 IPv4）。"
    echo -e "  ${DIM}节点要求：模式 2 + 配置 IPv6 子网${NC}"
    echo ""
    echo -e "  ${GREEN}IPv6 NAT${NC}"
    echo -e "  宿主机仅有单个 IPv6（共享宿主机 IPv6 出口，无 IPv4）。"
    echo -e "  ${DIM}节点要求：模式 2，无需 IPv6 子网${NC}"
    echo ""
    echo -e "  ${YELLOW}提示：${NC}本脚本选择模式 2 后，会自动检测宿主机 IPv6，"
    echo -e "  并帮助计算适合面板使用的 IPv6 子网。安装完成后在面板"
    echo -e "  「节点管理」中填入子网信息即可。"
    echo ""
    divider
    echo ""
}

# ========================== 读取 Token ==========================
read_token() {
    echo ""
    divider
    echo -e "  ${BOLD}请输入面板 Token${NC}"
    echo -e "  ${DIM}Token 可在面板「节点管理 → 添加节点」中获取${NC}"
    divider
    echo ""

    while true; do
        echo -ne "  ${CYAN}Token: ${NC}"
        read -r TOKEN

        # 非空检查
        if [[ -z "$TOKEN" ]]; then
            warn "Token 不能为空，请重新输入"
            continue
        fi

        # 去除首尾空格
        TOKEN=$(echo "$TOKEN" | xargs)

        # Token 格式校验（宽松匹配：允许较长的数字/字母/短横线组合）
        if [[ ! "$TOKEN" =~ ^[a-zA-Z0-9_-]{16,}$ ]]; then
            warn "Token 格式不符合预期（可能不完整或包含非法字符）"
            echo -e "  ${DIM}说明: Token 通常是一串较长的包含数字和字母的字符串${NC}"
            echo -ne "  是否仍要使用此 Token？[y/N]: "
            read -r confirm
            [[ "$confirm" =~ ^[yY]$ ]] || continue
        fi

        break
    done
}

# ========================== Agent 上报间隔 ==========================
configure_agent_heartbeat_interval() {
    if [[ "$AGENT_ENABLED" != "true" || ( -z "$AGENT_INSTALL_TOKEN" && ( -z "$AGENT_ID" || -z "$AGENT_SECRET" ) ) ]]; then
        AGENT_HEARTBEAT_INTERVAL_SECONDS="30"
        return 0
    fi

    if [[ ! -t 0 ]]; then
        AGENT_HEARTBEAT_INTERVAL_SECONDS="30"
        return 0
    fi

    echo -e "\n${CYAN}==> (可选) Agent 上报间隔${NC}"
    echo -e "  ${DIM}默认 30 秒；面板宿主机状态卡片会自动跟随此间隔刷新${NC}"
    echo -ne "  ${BOLD}Agent 上报间隔秒数 [默认 30，范围 5-3600]: ${NC}"
    local agent_interval=""
    read -r agent_interval

    if [[ -z "$agent_interval" ]]; then
        AGENT_HEARTBEAT_INTERVAL_SECONDS="30"
    elif [[ "$agent_interval" =~ ^[0-9]+$ ]] && (( agent_interval >= 5 && agent_interval <= 3600 )); then
        AGENT_HEARTBEAT_INTERVAL_SECONDS="$agent_interval"
    else
        warn "Agent 上报间隔无效，已使用默认 30 秒"
        AGENT_HEARTBEAT_INTERVAL_SECONDS="30"
    fi
}

# ========================== 安装确认 ==========================
confirm_install() {
    local mode_label=""
    case "$MODE" in
        nat)      mode_label="仅 IPv4" ;;
        nat_ipv6) mode_label="IPv4 + IPv6" ;;
    esac

    local os_label=""
    case "$OS_ID" in
        ubuntu) os_label="Ubuntu ${OS_VERSION}" ;;
        debian) os_label="Debian ${OS_VERSION}" ;;
    esac

    # Token 脱敏显示（仅显示首8位和末4位）
    local token_masked="${TOKEN:0:8}····${TOKEN: -4}"

    echo ""
    divider
    echo -e "  ${BOLD}安装确认${NC}"
    divider
    echo -e "  操作系统  :  ${GREEN}${os_label}${NC} (${OS_CODENAME})"
    echo -e "  网络模式  :  ${GREEN}${mode_label}${NC}"
    echo -e "  网桥子网  :  ${GREEN}${BRIDGE_SUBNET}${NC}"
    if [[ -n "${IPV6_SUBNET:-}" ]]; then
        echo -e "  IPv6 子网 :  ${GREEN}${IPV6_SUBNET}${NC} (${IPV6_IFACE:-auto})"
    fi
    echo -e "  通信端口  :  ${GREEN}[::]:${LISTEN_PORT}${NC}"
    echo -e "  Token     :  ${GREEN}${token_masked}${NC}"
    if [[ "$AGENT_ENABLED" == "true" && ( -n "$AGENT_INSTALL_TOKEN" || ( -n "$AGENT_ID" && -n "$AGENT_SECRET" ) ) ]]; then
        echo -e "  Agent     :  ${GREEN}${AGENT_HEARTBEAT_INTERVAL_SECONDS} 秒上报${NC}"
    fi
    
    if [[ "$IS_PURE_IPV6" == "true" ]]; then
        if [[ "${SKIP_WARP:-false}" == "true" ]]; then
            echo -e "  IPv4 出站 :  ${YELLOW}已跳过 WARP (保持纯净原生 IPv6)${NC}"
        else
            echo -e "  IPv4 出站 :  ${GREEN}Cloudflare WARP 虚拟网络接驳${NC}"
        fi
    fi
    
    divider
    echo ""
    echo -ne "  ${YELLOW}确认开始安装？${NC}[y/N]: "
    read -r confirm
    if [[ ! "$confirm" =~ ^[yY]$ ]]; then
        info "已取消安装"
        exit 0
    fi
}

# ========================== IPv6 子网精准探测模块 ==========================

# 单个 IP 可达性探测
# 返回: 0=可达, 1=不可达
probe_single_ip() {
    local test_ip="$1"
    local iface="$2"

    # 临时绑定测试 IP
    if ! ip -6 addr add "${test_ip}/128" dev "$iface" 2>/dev/null; then
        return 1
    fi

    # 短暂等待 NDP 生效
    sleep 0.5

    # 用该 IP 作为源地址 ping 外网（Google DNS IPv6）
    local ret=1
    if ping6 -c 1 -W 3 -I "$test_ip" 2001:4860:4860::8888 &>/dev/null; then
        ret=0
    fi

    # 无论成功失败，立即清理
    ip -6 addr del "${test_ip}/128" dev "$iface" 2>/dev/null || true
    return $ret
}

# IPv6 子网精准探测主函数
# 输入: $1=宿主机 IPv6 地址(不含前缀) $2=接口掩码前缀 $3=网卡名
# 输出全局变量:
#   PROBE_TYPE:  "full_64" | "small_block" | "single_ip" | "skip"
#   PROBE_CIDR:  安全 CIDR（如 "2604:a880:2:d1::/64"）  
#   PROBE_COUNT: 可用地址数量（数字或 "海量"）
PROBE_TYPE=""
PROBE_CIDR=""
PROBE_COUNT="0"

probe_ipv6_subnet() {
    local host_ip="$1"
    local host_prefix="$2"
    local iface="$3"

    PROBE_TYPE=""
    PROBE_CIDR=""
    PROBE_COUNT="0"

    # 前缀 > 64 的直接按小段/单 IP 处理（如 /128）
    if [[ "$host_prefix" -gt 126 ]]; then
        PROBE_TYPE="single_ip"
        PROBE_COUNT="0"
        return 0
    fi

    # 确保 python3 可用（用于 IPv6 地址偏移计算）
    if ! command -v python3 &>/dev/null; then
        export DEBIAN_FRONTEND=noninteractive
        apt-get update -qq >/dev/null 2>&1 || true
        apt-get install -y -qq python3 >/dev/null 2>&1 || true
    fi

    if ! command -v python3 &>/dev/null; then
        warn "python3 不可用，无法进行精准探测"
        PROBE_TYPE="skip"
        return 1
    fi

    echo -e "  ${CYAN}▶ 第 1 步：远距探测（验证完整 /64 是否可用）...${NC}"

    # ---- 第 1 级：远距探测 ----
    # 生成一个距离宿主机 IP 尽可能远的同 /64 地址
    local far_ip
    far_ip=$(python3 -c "
import ipaddress
addr = ipaddress.IPv6Address('${host_ip}')
# 取 /64 网络前缀
net = ipaddress.IPv6Network(str(addr) + '/64', strict=False)
# 用网络地址 + 反转的 host 部分生成远端 IP
# 如原始 host 部分为 ::19，则远端为 ::ffff:ffff:ffff:fffe
far = net.network_address + (net.num_addresses - 2)
# 确保不与宿主机 IP 重合
if far == addr:
    far = net.network_address + (net.num_addresses - 3)
print(str(far))
" 2>/dev/null)

    if [[ -z "$far_ip" ]]; then
        PROBE_TYPE="skip"
        return 1
    fi

    if probe_single_ip "$far_ip" "$iface"; then
        echo -e "  ${GREEN}✓ 远距探测通过 → 完整 /64 可用${NC}"
        # 计算 /64 网络地址
        local net64
        net64=$(python3 -c "
import ipaddress
net = ipaddress.IPv6Network('${host_ip}/64', strict=False)
print(str(net))
" 2>/dev/null)
        PROBE_TYPE="full_64"
        PROBE_CIDR="$net64"
        PROBE_COUNT="海量"
        return 0
    fi

    echo -e "  ${YELLOW}✗ 远距探测未通过，非完整 /64${NC}"
    echo -e "  ${CYAN}▶ 第 2 步：近距探测（验证是否有额外可用 IP）...${NC}"

    # ---- 第 2 级：近距探测 ----
    local near_ip
    near_ip=$(python3 -c "
import ipaddress
addr = ipaddress.IPv6Address('${host_ip}')
print(str(addr + 2))
" 2>/dev/null)

    if [[ -z "$near_ip" ]]; then
        PROBE_TYPE="skip"
        return 1
    fi

    if ! probe_single_ip "$near_ip" "$iface"; then
        echo -e "  ${YELLOW}✗ 近距探测未通过 → 仅单个 IP 可用${NC}"
        PROBE_TYPE="single_ip"
        PROBE_COUNT="0"
        return 0
    fi

    echo -e "  ${GREEN}✓ 近距探测通过，存在额外可用 IP${NC}"
    echo -e "  ${CYAN}▶ 第 3 步：边界收敛（精确定位可用范围）...${NC}"

    # ---- 第 3 级：指数探测 + 二分收敛 ----
    local last_pass=2
    local first_fail=0
    local offset=4

    # 指数递增找到第一个失败的偏移
    while [[ $offset -le 65536 ]]; do
        local test_ip_exp
        test_ip_exp=$(python3 -c "
import ipaddress
addr = ipaddress.IPv6Address('${host_ip}')
print(str(addr + ${offset}))
" 2>/dev/null)
        
        if [[ -z "$test_ip_exp" ]]; then
            first_fail=$offset
            break
        fi

        echo -ne "  测试偏移 +${offset}... "
        if probe_single_ip "$test_ip_exp" "$iface"; then
            echo -e "${GREEN}✓${NC}"
            last_pass=$offset
            offset=$((offset * 2))
        else
            echo -e "${YELLOW}✗${NC}"
            first_fail=$offset
            break
        fi
    done

    # 如果 65536 都通过了，当作大段处理
    if [[ $first_fail -eq 0 ]]; then
        echo -e "  ${GREEN}✓ 可用 IP 数量极大（>65536）${NC}"
        local net64
        net64=$(python3 -c "
import ipaddress
net = ipaddress.IPv6Network('${host_ip}/64', strict=False)
print(str(net))
" 2>/dev/null)
        PROBE_TYPE="full_64"
        PROBE_CIDR="$net64"
        PROBE_COUNT="海量"
        return 0
    fi

    # 二分查找精确边界
    local lo=$last_pass
    local hi=$first_fail

    while [[ $((hi - lo)) -gt 1 ]]; do
        local mid=$(( (lo + hi) / 2 ))
        local test_ip_mid
        test_ip_mid=$(python3 -c "
import ipaddress
addr = ipaddress.IPv6Address('${host_ip}')
print(str(addr + ${mid}))
" 2>/dev/null)

        echo -ne "  二分测试 +${mid}... "
        if probe_single_ip "$test_ip_mid" "$iface"; then
            echo -e "${GREEN}✓${NC}"
            lo=$mid
        else
            echo -e "${YELLOW}✗${NC}"
            hi=$mid
        fi
    done

    # lo 是最后一个通过的偏移，可用总数 = lo + 1（包含偏移 0 即宿主机本身）
    # 但宿主机占用 1 个，所以容器可用 = lo
    local usable_count=$lo

    # 向下取整为最近的安全 CIDR
    # 找到满足 2^n <= usable_count 的最大 n
    local cidr_prefix
    local cidr_count
    cidr_prefix=$(python3 -c "
import ipaddress, math
host = ipaddress.IPv6Address('${host_ip}')
count = ${usable_count}
if count <= 0:
    print('')
else:
    # 找到 2^n <= count 的最大 n
    n = int(math.log2(count)) if count > 0 else 0
    if n < 1:
        n = 1
    prefix_len = 128 - n
    # 计算对齐的网络地址
    net = ipaddress.IPv6Network(str(host) + '/' + str(prefix_len), strict=False)
    # 确保宿主机 IP 在此网络内
    if host in net:
        print(str(net) + '|' + str(2**n))
    else:
        # 尝试向上偏移一位
        prefix_len += 1
        n -= 1
        net = ipaddress.IPv6Network(str(host) + '/' + str(prefix_len), strict=False)
        print(str(net) + '|' + str(2**n))
" 2>/dev/null)

    if [[ -z "$cidr_prefix" || "$cidr_prefix" == "" ]]; then
        PROBE_TYPE="single_ip"
        PROBE_COUNT="0"
        return 0
    fi

    PROBE_TYPE="small_block"
    PROBE_CIDR=$(echo "$cidr_prefix" | cut -d'|' -f1)
    cidr_count=$(echo "$cidr_prefix" | cut -d'|' -f2)
    PROBE_COUNT="$cidr_count"

    echo -e "  ${GREEN}✓ 检测完成：实际可用约 ${usable_count} 个 IP，安全上报为 ${PROBE_CIDR}（${cidr_count} 个）${NC}"
    return 0
}

# ========================== 纯 IPv6 支持功能模块 ==========================

setup_temp_network() {
    step "临时急救：挂载 DNS64 解析补网..."
    # 为能够下载 Github 的代码，临时注入公益 DNS64
    if ! grep -q "2a00:1098:2b::1" /etc/resolv.conf; then
        # 插入 resolv.conf 顶部
        sed -i '1i nameserver 2a00:1098:2b::1\nnameserver 2a01:4f8:c2c:123f::1' /etc/resolv.conf
        info "已临时写入 NAT64 路由节点，恢复对纯 IPv4 站点的访问能力"
    fi
}

setup_warp_v4() {
    step "破壁出击：安装 Cloudflare WARP 提供全局 IPv4 逃生出站隧道..."
    
    # 核心修复一：在建隧道前，抓取并物理备份原生态纯净网关参数
    REAL_V6_IFACE=$(ip -6 route show default 2>/dev/null | grep -v wg | grep -oP 'dev \K\S+' | head -1)
    REAL_V6_GW=$(ip -6 route show default 2>/dev/null | grep -v wg | grep -oP 'via \K\S+' | head -1)
    [ -z "$REAL_V6_IFACE" ] && REAL_V6_IFACE=$(ip -o -6 addr show scope global | grep -v wg | awk '{print $2}' | head -1)
    echo "$REAL_V6_IFACE" > /etc/incudal_v6_iface
    echo "$REAL_V6_GW" > /etc/incudal_v6_gw

    # 强制不干涉内核锁版本依赖
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq 2>/dev/null || true
    if ! apt-get install -y -qq wireguard-tools openresolv >/dev/null 2>&1; then
        warn "wireguard-tools 安装失败（纯 IPv6 环境 apt 源可能不可达）"
        warn "尝试仅安装 wireguard-tools..."
        apt-get install -y -qq wireguard-tools >/dev/null 2>&1 || true
    fi

    # 检查 wireguard 是否可用
    if ! command -v wg &>/dev/null; then
        warn "WireGuard 工具未安装成功，跳过 WARP 配置"
        warn "容器将仅使用 IPv6 出站，可稍后手动安装 WARP"
        return 0
    fi

    local wgcf_url=""
    if [[ "$ARCH" == "amd64" || "$ARCH" == "x86_64" ]]; then
        wgcf_url="https://github.com/ViRb3/wgcf/releases/download/v2.2.22/wgcf_2.2.22_linux_amd64"
    elif [[ "$ARCH" == "arm64" || "$ARCH" == "aarch64" ]]; then
        wgcf_url="https://github.com/ViRb3/wgcf/releases/download/v2.2.22/wgcf_2.2.22_linux_arm64"
    else
        warn "架构不受支持，跳过 WARP 安装"
        return 0
    fi
    
    info "拉取核心组件 wgcf..."
    # 纯 IPv6 下 GitHub 可能不可达，多次重试
    local retry=0
    local max_retry=3
    while [[ $retry -lt $max_retry ]]; do
        if curl -sL --connect-timeout 30 --max-time 120 "$wgcf_url" -o /usr/local/bin/wgcf 2>/dev/null; then
            # 验证下载是否成功（文件大于 1MB）
            local fsize
            fsize=$(stat -c%s /usr/local/bin/wgcf 2>/dev/null || echo "0")
            if [[ "$fsize" -gt 1048576 ]]; then
                break
            fi
        fi
        retry=$((retry + 1))
        if [[ $retry -lt $max_retry ]]; then
            info "下载失败，${retry}/${max_retry} 次重试中（等待 5s）..."
            sleep 5
        fi
    done

    if [[ ! -f /usr/local/bin/wgcf ]] || [[ $(stat -c%s /usr/local/bin/wgcf 2>/dev/null || echo "0") -lt 1048576 ]]; then
        warn "wgcf 下载失败（纯 IPv6 环境无法访问 GitHub CDN）"
        warn "跳过 WARP 配置，容器将仅使用 IPv6 出站"
        warn "解决方案: 手动下载 wgcf 到 /usr/local/bin/wgcf 后运行安装脚本"
        rm -f /usr/local/bin/wgcf 2>/dev/null || true
        return 0
    fi

    chmod +x /usr/local/bin/wgcf

    mkdir -p /etc/wireguard
    cd /etc/wireguard || return 0

    if [[ ! -f wgcf-account.toml ]]; then
        info "底层设备匿名注册申请中..."
        yes | /usr/local/bin/wgcf register --accept-tos >/dev/null 2>&1 || true
    fi

    if [[ ! -f wgcf-profile.conf ]]; then
        info "生成防污染隧道隔离切片..."
        /usr/local/bin/wgcf generate >/dev/null 2>&1 || true
    fi

    if [[ -f wgcf-profile.conf ]]; then
        # 核心切片：剔除接管所有 IPv6，把唯一的源出站权让给宿主机
        sed -i '/AllowedIPs = ::\/0/d' wgcf-profile.conf
        # 删除 IPv6 隧道地址，只保留 IPv4 隧道地址（防止 wg-quick 为 IPv6 地址添加路由规则）
        sed -i 's/Address = \([^,]*\), *fd[0-9a-f:].*$/Address = \1/' wgcf-profile.conf
        # 核心切片：将服务端入口转换为无缝直连 IPv6，防止断流握手
        sed -i 's/Endpoint.*engage.cloudflareclient.com/Endpoint = \[2606:4700:d0::a29f:c001\]/g' wgcf-profile.conf
        # 关键修复：删除 DNS 行，防止 wg-quick 在启停时劫持宿主机 /etc/resolv.conf
        # 如果不删除，wg-quick down 会将 resolv.conf 回滚到原始的纯 IPv4 DNS（如 GCP 的 169.254.169.254），
        # 导致宿主机和所有容器的 DNS 解析全部瘫痪
        sed -i '/^DNS/d' wgcf-profile.conf
        
        cp wgcf-profile.conf wg0.conf
        chmod 600 wg0.conf
        
        systemctl enable wg-quick@wg0 >/dev/null 2>&1 || true
        systemctl start wg-quick@wg0 >/dev/null 2>&1 || true
        
        info "内核级网卡 wg0 启动完毕，您的服务器已具备虚拟双栈特性！"
    else
        warn "WARP 配置文件未能生成（wgcf register 可能失败）"
        warn "容器将仅使用 IPv6 出站，可稍后手动配置 WARP"
    fi
    
    # 注入出站控制器
    cat > /usr/local/bin/incus-warp << 'EOF'
#!/bin/bash
if [[ "$1" == "on" ]]; then
    systemctl start wg-quick@wg0 2>/dev/null
    echo "🌍 [ON] WARP IPv4 抢救通道已激活。容器支持出海更新包下载。"
elif [[ "$1" == "off" ]]; then
    systemctl stop wg-quick@wg0 2>/dev/null
    # 核心修复二：使用强落地的环境备份读取真实原生网关，拒绝 fe80::1
    REAL_V6_IFACE=$(cat /etc/incudal_v6_iface 2>/dev/null)
    REAL_V6_GW=$(cat /etc/incudal_v6_gw 2>/dev/null)
    [ -z "$REAL_V6_IFACE" ] && REAL_V6_IFACE=$(ip -o -6 addr show scope global | grep -v wg | awk '{print $2}' | head -1)
    
    if [ -n "$REAL_V6_IFACE" ] && ! ip -6 route | grep "^default" | grep -v wg > /dev/null 2>&1; then
        if [ -n "$REAL_V6_GW" ]; then
            ip -6 route add default via "$REAL_V6_GW" dev "$REAL_V6_IFACE" 2>/dev/null || true
        else
            ip -6 route add default dev "$REAL_V6_IFACE" 2>/dev/null || true
        fi
    fi
    # 核心修复三：全面压实纯 DNS64 集群阵列防止 0% 超时现象
    cat > /etc/resolv.conf <<DNSEOF
# Incudal WARP-OFF 模式 - 纯 NAT64+DNS64 解析器
nameserver 2a00:1098:2b::1
nameserver 2a01:4f8:c2c:123f::1
nameserver 2001:67c:2b0::4
DNSEOF
    echo "🧊 [OFF] WARP IPv4 通道已切断，原生真实 IPv6 路由结构已接管。"
else
    echo -e "用法: \033[1;36mincus-warp [on/off]\033[0m"
    if systemctl is-active wg-quick@wg0 >/dev/null 2>&1; then
        echo -e "当前出站分流状态: \033[1;32m[ON] IPv6 原生 + IPv4 WARP 接驳\033[0m"
    else
        echo -e "当前出站分流状态: \033[1;31m[OFF] 100% 绝对纯净 IPv6 环境回落\033[0m"
    fi
fi
EOF
    chmod +x /usr/local/bin/incus-warp
    info "出站调度指令控制台部署成功: 随时键入 incus-warp 操控"

    # 部署 IPv6 路由恢复守护脚本（兜底保险）
    cat > /usr/local/bin/ipv6-route-guard.sh << 'GUARD_EOF'
#!/bin/bash
# IPv6 路由恢复守护脚本 - 由 Incudal 安装脚本自动部署
# 每 10 秒检测 IPv6 默认路由，丢失则自动恢复

IPV6_IFACE=$(cat /etc/incudal_v6_iface 2>/dev/null)
IPV6_GATEWAY=$(cat /etc/incudal_v6_gw 2>/dev/null)

if [ -z "$IPV6_IFACE" ]; then
    IPV6_IFACE=$(ip -6 route show default 2>/dev/null | grep -v wg | grep -oP 'dev \K\S+' | head -1)
    [ -z "$IPV6_IFACE" ] && IPV6_IFACE=$(ip -o -6 addr show scope global | grep -v wg | awk '{print $2}' | head -1)
fi

[ -z "$IPV6_IFACE" ] && exit 0

while true; do
    # 检查是否存在非 WireGuard 接口的 IPv6 默认路由
    if ! ip -6 route | grep "^default" | grep -v wg > /dev/null 2>&1; then
        if [ -n "$IPV6_GATEWAY" ]; then
            ip -6 route add default via "$IPV6_GATEWAY" dev "$IPV6_IFACE" 2>/dev/null
        else
            ip -6 route add default dev "$IPV6_IFACE" 2>/dev/null
        fi
    fi
    sleep 10
done
GUARD_EOF
    chmod +x /usr/local/bin/ipv6-route-guard.sh

    # 创建 systemd 服务
    cat > /etc/systemd/system/ipv6-route-guard.service << 'SVC_EOF'
[Unit]
Description=IPv6 Route Guard - Incudal 自动恢复 IPv6 默认路由
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/ipv6-route-guard.sh
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SVC_EOF

    systemctl daemon-reload
    systemctl enable --now ipv6-route-guard > /dev/null 2>&1 || true
    info "IPv6 路由守护已部署: 即使 WARP 意外断联，IPv6 也将在 10 秒内自愈"
}

# ========================== 安装步骤 ==========================

# 步骤 1: 配置内核参数
setup_kernel() {
    step "步骤 [1/5]  配置内核参数..."

    # 加载网桥过滤模块
    echo "br_netfilter" > /etc/modules-load.d/br_netfilter.conf
    modprobe br_netfilter || true

    # 基础 sysctl 参数 + BBR 拥塞控制 + TCP 缓冲区优化
    cat > /etc/sysctl.d/99-incus.conf <<EOF
# Incudal 节点内核参数 - 由安装脚本自动生成
# ======== 文件系统 ========
fs.inotify.max_user_instances = 1048576
fs.file-max = 6815744

# ======== 网桥过滤 ========
net.bridge.bridge-nf-call-ip6tables = 1
net.bridge.bridge-nf-call-iptables = 1
net.bridge.bridge-nf-call-arptables = 1

# ======== IPv4 转发与路由 ========
net.ipv4.ip_forward = 1
net.ipv4.conf.all.route_localnet = 1
net.ipv4.conf.all.forwarding = 1
net.ipv4.conf.default.forwarding = 1

# ======== BBR 拥塞控制 ========
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr

# ======== TCP 性能优化 ========
net.ipv4.tcp_no_metrics_save = 1
net.ipv4.tcp_ecn = 0
net.ipv4.tcp_frto = 0
net.ipv4.tcp_mtu_probing = 0
net.ipv4.tcp_rfc1337 = 0
net.ipv4.tcp_sack = 1
net.ipv4.tcp_fack = 1
net.ipv4.tcp_window_scaling = 1
net.ipv4.tcp_adv_win_scale = 1
net.ipv4.tcp_moderate_rcvbuf = 1

# ======== 网络缓冲区 ========
net.core.rmem_max = 33554432
net.core.wmem_max = 33554432
net.ipv4.tcp_rmem = 4096 87380 33554432
net.ipv4.tcp_wmem = 4096 16384 33554432
net.ipv4.udp_rmem_min = 8192
net.ipv4.udp_wmem_min = 8192

# ======== IPv6 转发（所有模式默认启用） ========
net.ipv6.conf.all.forwarding = 1
net.ipv6.conf.default.forwarding = 1
EOF

    # IPv6 NAT 模式追加代理与路由通告参数
    if [[ "$MODE" == "nat_ipv6" ]]; then
        cat >> /etc/sysctl.d/99-incus.conf <<EOF

# IPv6 NAT 模式专用参数
net.ipv6.conf.all.proxy_ndp = 1
net.ipv6.conf.all.accept_ra = 2
net.ipv6.conf.default.accept_ra = 2
net.ipv6.conf.${DEFAULT_IFACE}.accept_ra = 2
net.ipv6.conf.${DEFAULT_IFACE}.proxy_ndp = 1
EOF
    fi

    sysctl -p >/dev/null 2>&1 || true
    sysctl --system >/dev/null 2>&1 || true

    # 验证 BBR 是否生效
    if lsmod | grep -q bbr 2>/dev/null || sysctl net.ipv4.tcp_congestion_control 2>/dev/null | grep -q bbr; then
        log "BBR 拥塞控制已启用 ✓"
    else
        warn "BBR 未能自动加载（内核可能不支持），TCP 将使用默认拥塞算法"
    fi

    log "内核参数配置完成（含 BBR + TCP 优化）"
}

# 步骤 2: 安装系统依赖
install_deps() {
    step "步骤 [2/5]  安装系统依赖..."

    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq 2>/dev/null

    # Debian 系统需要确保 contrib 组件已启用（ZFS 包在 contrib 中）
    if [[ "$OS_ID" == "debian" ]]; then
        local contrib_enabled=false

        # 检查 DEB822 格式源文件（Debian 12+）
        if [[ -f /etc/apt/sources.list.d/debian.sources ]]; then
            if grep -q "contrib" /etc/apt/sources.list.d/debian.sources 2>/dev/null; then
                contrib_enabled=true
            fi
        fi

        # 检查传统格式源文件
        if [[ -f /etc/apt/sources.list ]]; then
            if grep -q "contrib" /etc/apt/sources.list 2>/dev/null; then
                contrib_enabled=true
            fi
        fi

        if [[ "$contrib_enabled" == "false" ]]; then
            info "Debian 系统：启用 contrib 组件以支持 ZFS..."
            if [[ -f /etc/apt/sources.list.d/debian.sources ]]; then
                sed -i 's/Components: main$/Components: main contrib/' \
                    /etc/apt/sources.list.d/debian.sources 2>/dev/null || true
            elif [[ -f /etc/apt/sources.list ]]; then
                sed -i '/^deb.*main/ { /contrib/! s/main/main contrib/ }' \
                    /etc/apt/sources.list 2>/dev/null || true
            fi
            apt-get update -qq 2>/dev/null
        fi
    fi

    # 安装基础依赖
    apt-get install -y -qq curl gpg >/dev/null 2>&1

    # ---- Debian ZFS 安装策略 ----
    # 优先级: 预编译包(秒级) → DKMS 编译(分钟级) → 跳过(使用 dir 存储池)
    local debian_zfs_compiled=false
    if [[ "$OS_ID" == "debian" ]]; then
        local kernel_ver
        kernel_ver=$(uname -r)

        # 策略 1: 尝试下载预编译 ZFS 模块包
        if install_zfs_prebuilt "$kernel_ver"; then
            debian_zfs_compiled=false  # 预编译模式不需要后续清理编译环境
            log "系统依赖安装完成（ZFS 预编译模块，秒级部署）"
        # 策略 2: 询问用户是否进行 DKMS 即时编译
        else
            warn "未找到内核 ${kernel_ver} 的预编译 ZFS 模块包"
            echo ""
            info "当前内核版本暂无预编译包，可选择 DKMS 即时编译（约 5-10 分钟）"
            echo -ne "  ${BOLD}是否进行实时编译？${NC}[Y/n]: "
            read -r dkms_confirm || true
            if [[ "${dkms_confirm:-}" =~ ^[nN]$ ]]; then
                warn "已跳过 ZFS 安装，返回主菜单"
                return 1
            fi
            info "开始 DKMS 即时编译..."
            install_zfs_dkms
            debian_zfs_compiled=true
        fi
    else
        # Ubuntu: 直接安装（预编译模块随内核提供）
        if apt-get install -y -qq zfsutils-linux >/dev/null 2>&1; then
            log "系统依赖安装完成（含 ZFS）"
        else
            warn "ZFS 工具安装失败，已跳过（面板可使用 dir/btrfs 存储池）"
            log "基础依赖安装完成"
        fi
    fi

    # Debian DKMS 编译后清理：删除编译工具链以释放资源
    if [[ "$debian_zfs_compiled" == "true" ]]; then
        info "ZFS DKMS 编译成功，清理编译环境以释放资源..."

        # 锁定当前内核版本，防止自动更新时 DKMS 在无编译环境下重编译失败
        local kernel_pkg
        kernel_pkg=$(dpkg -l | awk '/^ii.*linux-image-[0-9]/ {print $2}' | head -n1 || true)
        if [[ -n "$kernel_pkg" ]]; then
            apt-mark hold "$kernel_pkg" >/dev/null 2>&1 || true
            info "已锁定内核版本: ${kernel_pkg}（防止自动更新导致 ZFS 失效）"
        fi

        # 卸载编译工具链（gcc、g++、make 等，约 200-500MB）
        apt-get purge -y -qq build-essential cpp gcc g++ make dpkg-dev >/dev/null 2>&1 || true
        # 卸载内核头文件（约 100-200MB）
        apt-get purge -y -qq "linux-headers-$(uname -r)" linux-headers-* >/dev/null 2>&1 || true
        # 自动清理不再需要的依赖
        apt-get autoremove -y -qq >/dev/null 2>&1 || true
        # 清理 APT 下载缓存
        apt-get clean 2>/dev/null || true

        log "编译环境已清理，磁盘空间已释放"
        warn "注意：内核版本已锁定，如需更新内核请先重装编译依赖"
        info "更新内核前请运行: apt install build-essential linux-headers-\$(uname -r)"
    fi
}

# ---- Debian ZFS 策略 1: 预编译模块安装 ----
install_zfs_prebuilt() {
    local kernel_ver="$1"
    local prebuilt_url="${ZFS_PREBUILT_URL}/zfs-modules-${kernel_ver}.tar.gz"
    local tmp_tar="/tmp/zfs-prebuilt-$$.tar.gz"
    local tmp_dir="/tmp/zfs-prebuilt-$$"

    info "尝试下载预编译 ZFS 模块 (${kernel_ver})..."
    info "下载地址: ${prebuilt_url}"

    # 下载预编译包
    if ! curl -sSfL --connect-timeout 10 --max-time 60 \
        "$prebuilt_url" -o "$tmp_tar" 2>/dev/null; then
        info "未找到内核 ${kernel_ver} 的预编译包"
        rm -f "$tmp_tar" 2>/dev/null || true
        return 1
    fi

    info "预编译包下载成功，开始安装..."

    # 解压
    mkdir -p "$tmp_dir"
    if ! tar -xzf "$tmp_tar" -C "$tmp_dir" 2>/dev/null; then
        error "预编译包解压失败"
        rm -rf "$tmp_tar" "$tmp_dir" 2>/dev/null || true
        return 1
    fi

    # 读取元数据，获取模块安装路径
    local pack_dir
    pack_dir=$(find "$tmp_dir" -name "metadata.txt" -printf '%h\n' 2>/dev/null | head -n1)
    if [[ -z "$pack_dir" ]]; then
        error "预编译包格式无效（缺少 metadata.txt）"
        rm -rf "$tmp_tar" "$tmp_dir" 2>/dev/null || true
        return 1
    fi

    # 验证内核版本匹配
    local pkg_kernel
    pkg_kernel=$(awk -F= '/^kernel_version=/{print $2}' "$pack_dir/metadata.txt" 2>/dev/null)
    if [[ "$pkg_kernel" != "$kernel_ver" ]]; then
        warn "预编译包内核版本不匹配 (包: ${pkg_kernel}, 本机: ${kernel_ver})"
        rm -rf "$tmp_tar" "$tmp_dir" 2>/dev/null || true
        return 1
    fi

    # 获取模块安装路径
    local module_path
    module_path=$(awk -F= '/^module_path=/{print $2}' "$pack_dir/metadata.txt" 2>/dev/null)
    if [[ -z "$module_path" ]]; then
        module_path="updates/dkms"  # 默认路径
    fi

    # 复制模块文件到正确位置
    local target_dir="/lib/modules/${kernel_ver}/${module_path}"
    mkdir -p "$target_dir"
    cp "$pack_dir/modules/"*.ko* "$target_dir/" 2>/dev/null

    local ko_count
    ko_count=$(find "$target_dir" -name "*.ko*" -type f 2>/dev/null | wc -l)
    info "已安装 ${ko_count} 个内核模块 → ${target_dir}"

    # 更新模块依赖关系
    depmod -a 2>/dev/null || true

    # 加载 ZFS 模块验证
    if ! modprobe zfs 2>/dev/null; then
        error "预编译模块加载失败"
        rm -rf "$tmp_tar" "$tmp_dir" 2>/dev/null || true
        return 1
    fi

    info "ZFS 内核模块加载成功 ✓"

    # 安装 ZFS 用户空间工具（不拉取 DKMS，避免触发编译）
    info "安装 ZFS 用户空间工具..."
    apt-get install -y -qq --no-install-recommends zfsutils-linux >/dev/null 2>&1 || {
        # 如果 --no-install-recommends 不够，强制跳过 dkms
        apt-get install -y -qq zfsutils-linux >/dev/null 2>&1 || true
    }

    # 锁定内核版本
    local kernel_pkg
    kernel_pkg=$(dpkg -l | awk '/^ii.*linux-image-[0-9]/ {print $2}' | head -n1 || true)
    if [[ -n "$kernel_pkg" ]]; then
        apt-mark hold "$kernel_pkg" >/dev/null 2>&1 || true
        info "已锁定内核版本: ${kernel_pkg}"
    fi

    # 清理临时文件
    rm -rf "$tmp_tar" "$tmp_dir" 2>/dev/null || true

    log "ZFS 预编译模块安装成功（内核: ${kernel_ver}）"
    return 0
}

# ---- Debian ZFS 策略 2: DKMS 即时编译（回退方案）----
install_zfs_dkms() {
    info "安装 DKMS 编译依赖（linux-headers、build-essential）..."
    
    # 优先安装通用编译核心工具，防止一处失败导致全部跳过
    apt-get install -y -qq build-essential dkms >/dev/null 2>&1 || true

    # 尝试安装精确版本内核源码头
    if ! apt-get install -y -qq "linux-headers-$(uname -r)" >/dev/null 2>&1; then
        warn "未找到精确的内核头文件 linux-headers-$(uname -r)"
        info "正尝试拉取架构级通用头文件（linux-headers-amd64）..."
        apt-get install -y -qq linux-headers-amd64 >/dev/null 2>&1 || {
            warn "内核头文件均安装失败，ZFS DKMS 编译极可能无法正常进行"
        }
    fi

    info "开始 DKMS 编译 ZFS 模块（CPU 将跑满，请耐心等待）..."
    local start_time=$SECONDS

    if apt-get install -y -qq zfsutils-linux >/dev/null 2>&1; then
        local elapsed=$(( SECONDS - start_time ))
        info "编译耗时: ${elapsed} 秒"

        # 验证 ZFS 模块
        if modprobe zfs 2>/dev/null; then
            log "ZFS DKMS 编译成功（模块已加载）"
        else
            warn "ZFS 工具已安装但内核模块加载失败（DKMS 编译可能不完整）"
            info "面板仍可使用 dir/btrfs 存储池，ZFS 可稍后手动修复"
        fi
    else
        warn "ZFS 安装失败，已跳过（面板可使用 dir/btrfs 存储池）"
    fi
}

# 步骤 3: 安装 Incus
install_incus() {
    step "步骤 [3/5]  安装 Incus..."

    # 幂等性：已安装且服务端正常运行则跳过
    if incus version 2>/dev/null | grep -q -E "Server version: [0-9]"; then
        local current_ver
        current_ver=$(incus version 2>/dev/null | awk '/Client version/ {print $3}' || echo "未知")
        info "Incus 服务已安装并运行（版本: ${current_ver}），跳过安装"
        return 0
    fi

    # 导入 Zabbly GPG 密钥
    mkdir -p /etc/apt/keyrings
    curl -fsSL https://pkgs.zabbly.com/key.asc \
        | gpg --yes --dearmor -o /etc/apt/keyrings/zabbly.gpg

    # 添加 Zabbly APT 源（同时支持 Ubuntu 和 Debian）
    cat > /etc/apt/sources.list.d/zabbly-incus-stable.sources <<SRC
Enabled: yes
Types: deb
URIs: https://pkgs.zabbly.com/incus/stable
Suites: ${OS_CODENAME}
Components: main
Architectures: ${ARCH}
Signed-By: /etc/apt/keyrings/zabbly.gpg
SRC

    apt-get update -qq 2>/dev/null
    apt-get install -y -qq incus >/dev/null
    log "Incus 安装完成"
}

# 步骤 4: 初始化 Incus
init_incus() {
    step "步骤 [4/5]  初始化 Incus..."

    # 幂等性：网桥已存在则跳过
    if incus network show "$BRIDGE_NAME" &>/dev/null; then
        info "网桥 ${BRIDGE_NAME} 已存在，跳过初始化"
        return 0
    fi

    # 生成 preseed 配置
    local ipv6_block
    if [[ "$MODE" == "nat_ipv6" ]]; then
        info "面板受控模式 (IPv4 NAT + IPv6 环境): 准备建立内核转发链路"
        if [[ -n "${IPV6_SUBNET:-}" ]]; then
            # 有独立子网：routed 模式走 eth1 独立分配 IPv6，但网桥同时启用 IPv6 NAT 作为保底
            # 这样 nat_ipv6_nat 模式的实例也能在同一节点上通过桥共享 IPv6 出口
            ipv6_block="ipv6.address: auto\n      ipv6.nat: \"true\"\n      ipv6.dhcp: \"true\""
            info "▶ [IPv6 配置分支] 独立路由网段 + 网桥 NAT 双通道模式，routed 直通与 NAT 共享可共存。"
        else
            # 用户选择单 IP 共享，网桥需要负责分发 ULA (内部 IPv6) 并 NAT 出口
            ipv6_block="ipv6.address: auto\n      ipv6.nat: \"true\"\n      ipv6.dhcp: \"true\""
            info "▶ [IPv6 配置分支] 单一公共 IP 模式 (Bridge: Auto+NAT)，已激活内部 IPv6 出站共享代理功能。"
        fi
        
        # [核心修复区] Debian 默认闭合的内核转发
        sysctl -w net.ipv6.conf.all.forwarding=1 >/dev/null 2>&1 || true
        sysctl -w net.ipv6.conf.default.forwarding=1 >/dev/null 2>&1 || true
        sysctl -w net.ipv6.conf.all.proxy_ndp=1 >/dev/null 2>&1 || true
        sysctl -w net.ipv6.conf.default.proxy_ndp=1 >/dev/null 2>&1 || true
        
        # 配置 ndppd (邻居发现)，这是对非直连路由云主机的保底策略
        if [[ -n "${IPV6_SUBNET:-}" && -n "${IPV6_IFACE:-}" ]]; then
            export DEBIAN_FRONTEND=noninteractive
            apt-get install -y -qq ndppd >/dev/null 2>&1 || true
            cat > /etc/ndppd.conf <<EOF
proxy ${IPV6_IFACE} {
    rule ${IPV6_SUBNET} {
        auto
    }
}
EOF
            systemctl restart ndppd 2>/dev/null || true
            systemctl enable ndppd 2>/dev/null || true
            info "NDPPD 路由代理保活已附加配置"
        fi
    else
        # MODE=nat（仅 IPv4）：检测是否为纯 IPv6 环境
        if [[ "$IS_PURE_IPV6" == "true" ]]; then
            # 纯 IPv6 宿主机即使选了"仅 IPv4"，也必须启用桥 IPv6 NAT，否则容器完全断网
            ipv6_block="ipv6.address: auto\n      ipv6.nat: \"true\"\n      ipv6.dhcp: \"true\""
            info "▶ [IPv6 自动修正] 检测到纯 IPv6 环境，已自动启用网桥 IPv6 NAT 防止容器断网。"
        else
            ipv6_block="ipv6.address: none"
        fi
    fi

    # 纯 IPv6 环境：网桥必须强制配置 100% 纯 NAT64 提供商，防止容器内的双栈域名引发 IPv4 DNS 污染死锁超时
    local dns_block=""
    if [[ "$IS_PURE_IPV6" == "true" ]]; then
        dns_block="dns.nameservers: 2a00:1098:2b::1,2a01:4f8:c2c:123f::1,2001:67c:2b0::4"
        info "纯 IPv6 环境：已为网桥独家配置纯公益 NAT64/DNS64 集群，护航出站"
    fi

    # 写入文件
    cat > "$PRESEED_FILE" <<YAML
config:
  core.https_address: '[::]:${LISTEN_PORT}'
networks:
  - name: ${BRIDGE_NAME}
    type: bridge
    config:
      ipv4.address: ${BRIDGE_SUBNET}
      ipv4.nat: "true"
      ipv4.dhcp: "true"
      $(echo -e "$ipv6_block")
      ${dns_block:+$dns_block}
storage_pools: []
profiles: []
cluster: null
YAML

    incus admin init --preseed < "$PRESEED_FILE"
    log "Incus 初始化完成"
}

# 步骤 5: 导入面板证书
import_cert() {
    step "步骤 [5/5]  导入面板信任证书..."

    # 幂等性：证书已存在则跳过
    if incus config trust list --format csv 2>/dev/null | grep -q "panel"; then
        info "面板证书已存在，跳过导入"
        return 0
    fi

    local cert_url="${PANEL_URL}/api/hosts/cert/${TOKEN}"

    if ! curl -sSf "$cert_url" \
        | incus config trust add-certificate - --name panel >/dev/null 2>&1; then
        error "证书导入失败！请检查："
        error "  1. Token 是否正确"
        error "  2. 面板 ${PANEL_URL} 是否可达"
        error "  3. 网络连接是否正常"
        exit 1
    fi

    log "面板证书导入成功"
}

# 附加步骤：安装宿主机 Agent
install_incudal_agent() {
    if [[ "$AGENT_ENABLED" != "true" ]]; then
        AGENT_INSTALL_STATUS="已跳过"
        info "宿主机 Agent 自动安装已关闭，跳过"
        return 0
    fi

    if [[ -z "$PANEL_URL" || ( -z "$AGENT_INSTALL_TOKEN" && ( -z "$AGENT_ID" || -z "$AGENT_SECRET" ) ) ]]; then
        AGENT_INSTALL_STATUS="已跳过"
        warn "未注入 Agent 安装 token 或凭据，跳过宿主机 Agent 安装"
        return 0
    fi

    step "附加步骤  安装宿主机 Agent..."

    local agent_install_url="${PANEL_URL}/api/agent/install.sh"
    if curl -fsSL "$agent_install_url" | \
        INCUDAL_PANEL_URL="$PANEL_URL" \
        INCUDAL_AGENT_INSTALL_TOKEN="$AGENT_INSTALL_TOKEN" \
        INCUDAL_AGENT_ID="$AGENT_ID" \
        INCUDAL_AGENT_SECRET="$AGENT_SECRET" \
        INCUDAL_AGENT_BINARY_URL="$AGENT_BINARY_URL" \
        INCUDAL_HEARTBEAT_INTERVAL_SECONDS="$AGENT_HEARTBEAT_INTERVAL_SECONDS" \
        bash; then
        AGENT_INSTALL_STATUS="已安装"
        log "宿主机 Agent 安装完成"
    else
        AGENT_INSTALL_STATUS="安装失败"
        warn "宿主机 Agent 安装失败，Incus 节点初始化已完成，可稍后在面板重新生成 Agent 安装命令"
    fi

    return 0
}

# Agent 独立安装器调用
run_incudal_agent_installer() {
    local panel_url="${1%/}"
    local install_token="${2:-}"
    local agent_id="${3:-}"
    local agent_secret="${4:-}"
    local heartbeat_interval="${5:-30}"
    local binary_url="${6:-}"

    if [[ -z "$panel_url" ]]; then
        error "面板地址不能为空"
        return 1
    fi
    if ! is_http_url "$panel_url"; then
        error "面板地址格式无效: ${panel_url}"
        return 1
    fi
    if [[ -z "$install_token" && ( -z "$agent_id" || -z "$agent_secret" ) ]]; then
        error "缺少 Agent 安装 token 或本机 Agent 凭据"
        return 1
    fi

    heartbeat_interval=$(normalize_agent_interval "$heartbeat_interval")
    local agent_install_url="${panel_url}/api/agent/install.sh"

    step "安装 / 更新宿主机 Agent..."
    info "面板地址: ${panel_url}"
    if [[ -n "$install_token" ]]; then
        info "安装 token: $(mask_value "$install_token")"
    else
        info "Agent ID: $(mask_value "$agent_id")"
    fi

    if curl -fsSL "$agent_install_url" | \
        INCUDAL_PANEL_URL="$panel_url" \
        INCUDAL_AGENT_INSTALL_TOKEN="$install_token" \
        INCUDAL_AGENT_ID="$agent_id" \
        INCUDAL_AGENT_SECRET="$agent_secret" \
        INCUDAL_AGENT_BINARY_URL="$binary_url" \
        INCUDAL_HEARTBEAT_INTERVAL_SECONDS="$heartbeat_interval" \
        bash; then
        log "宿主机 Agent 安装 / 更新完成"
        return 0
    fi

    error "宿主机 Agent 安装 / 更新失败"
    return 1
}

show_incudal_agent_status() {
    divider
    echo -e "  ${BOLD}Agent 状态${NC}"
    divider

    local panel_url=""
    local agent_id=""
    local heartbeat_interval=""
    panel_url=$(read_agent_config_value "panel_url" || true)
    agent_id=$(read_agent_config_value "agent_id" || true)
    heartbeat_interval=$(read_agent_config_value "heartbeat_interval_seconds" || true)
    heartbeat_interval=$(normalize_agent_interval "${heartbeat_interval:-30}")

    if [[ -f "$AGENT_CONFIG_FILE" ]]; then
        echo -e "  配置文件  :  ${GREEN}${AGENT_CONFIG_FILE}${NC}"
        echo -e "  面板地址  :  ${GREEN}${panel_url:-未知}${NC}"
        echo -e "  Agent ID :  ${GREEN}$(mask_value "$agent_id")${NC}"
        echo -e "  上报间隔  :  ${GREEN}${heartbeat_interval} 秒${NC}"
    else
        echo -e "  配置文件  :  ${DIM}未找到 (${AGENT_CONFIG_FILE})${NC}"
    fi

    if [[ -x "$AGENT_BIN_PATH" ]]; then
        echo -e "  二进制    :  ${GREEN}${AGENT_BIN_PATH}${NC}"
    else
        echo -e "  二进制    :  ${DIM}未安装 (${AGENT_BIN_PATH})${NC}"
    fi

    if command -v systemctl &>/dev/null; then
        if systemctl is-active --quiet "$AGENT_SERVICE_NAME" 2>/dev/null; then
            echo -e "  服务状态  :  ${GREEN}运行中${NC}"
        elif systemctl list-unit-files "${AGENT_SERVICE_NAME}.service" --no-legend 2>/dev/null | grep -q "^${AGENT_SERVICE_NAME}.service"; then
            echo -e "  服务状态  :  ${YELLOW}已安装（未运行）${NC}"
        else
            echo -e "  服务状态  :  ${DIM}未安装${NC}"
        fi
    else
        echo -e "  服务状态  :  ${DIM}systemctl 不可用${NC}"
    fi

    divider
}

prompt_agent_panel_url() {
    local default_panel_url="${1:-}"
    local panel_url=""

    if [[ -t 0 ]]; then
        if [[ -n "$default_panel_url" ]]; then
            echo -ne "  ${BOLD}面板地址 [默认 ${default_panel_url}]: ${NC}" >&2
        else
            echo -ne "  ${BOLD}面板地址 (例如 https://panel.example.com): ${NC}" >&2
        fi
        read -r panel_url
    fi

    panel_url="${panel_url:-$default_panel_url}"
    panel_url="${panel_url%/}"
    if [[ -z "$panel_url" ]]; then
        echo -e "${RED}[✗]${NC} 无法确定面板地址，请输入完整 https:// 地址" >&2
        return 1
    fi
    if ! is_http_url "$panel_url"; then
        echo -e "${RED}[✗]${NC} 面板地址格式无效: ${panel_url}" >&2
        return 1
    fi

    echo "$panel_url"
}

update_incudal_agent_from_config() {
    local panel_url=""
    local agent_id=""
    local agent_secret=""
    local heartbeat_interval=""

    panel_url=$(read_agent_config_value "panel_url" || true)
    agent_id=$(read_agent_config_value "agent_id" || true)
    agent_secret=$(read_agent_config_value "agent_secret" || true)
    heartbeat_interval=$(read_agent_config_value "heartbeat_interval_seconds" || true)
    heartbeat_interval=$(normalize_agent_interval "${heartbeat_interval:-30}")

    if [[ -z "$panel_url" || -z "$agent_id" || -z "$agent_secret" ]]; then
        warn "本机没有完整的 Agent 配置，无法直接更新"
        info "如需补装，请先在面板为该宿主机生成 Agent 安装命令，再选择 token 补装"
        return 1
    fi

    prompt_agent_heartbeat_interval "$heartbeat_interval"
    run_incudal_agent_installer "$panel_url" "" "$agent_id" "$agent_secret" "$AGENT_HEARTBEAT_INTERVAL_SECONDS" "$AGENT_BINARY_URL"
}

install_incudal_agent_with_token() {
    echo ""
    divider
    echo -e "  ${BOLD}输入 Agent 一次性安装 token${NC}"
    echo -e "  ${DIM}可粘贴 ait_... token，也可粘贴面板生成的完整 Agent 安装命令。${NC}"
    divider
    echo ""
    echo -ne "  ${CYAN}Token / 命令: ${NC}"
    local token_input=""
    read -r token_input

    local install_token=""
    install_token=$(extract_agent_install_token "$token_input")
    if [[ -z "$install_token" ]]; then
        error "未找到 Agent 安装 token。Agent token 应以 ait_ 开头。"
        return 1
    fi

    local extracted_panel_url=""
    local default_panel_url=""
    extracted_panel_url=$(extract_agent_panel_url "$token_input" || true)
    default_panel_url="${extracted_panel_url:-$(get_agent_panel_url || true)}"

    local panel_url=""
    panel_url=$(prompt_agent_panel_url "$default_panel_url") || return 1

    local current_interval=""
    current_interval=$(read_agent_config_value "heartbeat_interval_seconds" || true)
    prompt_agent_heartbeat_interval "${current_interval:-30}"

    run_incudal_agent_installer "$panel_url" "$install_token" "" "" "$AGENT_HEARTBEAT_INTERVAL_SECONDS" "$AGENT_BINARY_URL"
}

show_incudal_agent_logs() {
    step "查看 Agent 最近日志"
    if ! command -v journalctl &>/dev/null; then
        error "journalctl 不可用"
        return 1
    fi
    journalctl -u "$AGENT_SERVICE_NAME" --no-pager -n 80 || true
}

manage_incudal_agent() {
    while true; do
        show_incudal_agent_status
        echo -e "  ${BOLD}请选择 Agent 操作：${NC}"
        echo ""
        echo -e "    ${CYAN}1)${NC}  更新 / 重装已安装 Agent  ${DIM}─  使用本机配置${NC}"
        echo -e "    ${CYAN}2)${NC}  使用一次性 token 补装 / 重装 Agent"
        echo -e "    ${CYAN}3)${NC}  查看 Agent 日志"
        echo -e "    ${CYAN}0)${NC}  返回主菜单"
        echo ""
        echo -ne "  ${BOLD}请输入选项 [0-3]: ${NC}"
        local choice=""
        read -r choice
        echo ""

        case "$choice" in
            1) update_incudal_agent_from_config || true; pause_return ;;
            2) install_incudal_agent_with_token || true; pause_return ;;
            3) show_incudal_agent_logs || true; pause_return ;;
            0) return 0 ;;
            *) warn "无效选项，请重新选择" ;;
        esac
    done
}

# ========================== 安装结果 ==========================
show_result() {
    local mode_label=""
    case "$MODE" in
        nat)      mode_label="NAT（仅 IPv4）" ;;
        nat_ipv6) mode_label="NAT + IPv6" ;;
    esac

    # 安装 incudal 快捷命令
    local script_path=""
    script_path=$(readlink -f "$0" 2>/dev/null || echo "$0")
    
    # 管道执行（curl | bash）时，$0 指向 bash 本身，不能直接复制
    if [[ -f "$script_path" && ! "$script_path" =~ (bash|sh)$ ]]; then
        # 正常文件执行：直接复制脚本
        cp -f "$script_path" /usr/local/bin/incudal 2>/dev/null || true
        chmod +x /usr/local/bin/incudal 2>/dev/null || true
    elif [[ -f /root/incudal.sh ]]; then
        # 回退方案 1：检查常见的下载位置
        cp -f /root/incudal.sh /usr/local/bin/incudal 2>/dev/null || true
        chmod +x /usr/local/bin/incudal 2>/dev/null || true
    else
        # 回退方案 2：创建自下载包装器，运行时从面板拉取最新脚本
        cat > /usr/local/bin/incudal <<'SHORTCUT'
#!/bin/bash
# Incudal 节点管理快捷入口 - 自动下载最新版本
SCRIPT_CACHE="/root/incudal.sh"
SCRIPT_URL="https://raw.githubusercontent.com/0xdabiaoge/incudal/main/server/templates/install.sh"
echo "正在获取最新的节点管理脚本..."
if curl -sSfL "$SCRIPT_URL" -o "$SCRIPT_CACHE" 2>/dev/null; then
    chmod +x "$SCRIPT_CACHE"
    exec bash "$SCRIPT_CACHE" "$@"
else
    echo "下载失败。如果本机是纯 IPv6 环境，请确保 WARP 已开启后重试。"
    echo "或手动从面板获取安装脚本保存到 /root/incudal.sh"
    exit 1
fi
SHORTCUT
        chmod +x /usr/local/bin/incudal 2>/dev/null || true
    fi

    echo ""
    echo -e "${GREEN}  ╔══════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}  ║                                                  ║${NC}"
    echo -e "${GREEN}  ║           ✓  安装完成                            ║${NC}"
    echo -e "${GREEN}  ║                                                  ║${NC}"
    echo -e "${GREEN}  ╚══════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  网桥名称  :  ${GREEN}${BRIDGE_NAME}${NC}"
    echo -e "  网桥子网  :  ${GREEN}${BRIDGE_SUBNET}${NC}"
    echo -e "  API 监听  :  ${GREEN}[::]:${LISTEN_PORT}${NC}"
    echo -e "  网络模式  :  ${GREEN}${mode_label}${NC}"
    echo -e "  Agent     :  ${GREEN}${AGENT_INSTALL_STATUS}${NC}"
    echo -e "  快捷命令  :  ${GREEN}incudal${NC}"
    echo ""
    divider
    echo -e "  ${BOLD}下一步：${NC}请返回 Incudal 面板，点击「验证并连接」按钮完成注册"
    echo -e "  ${DIM}随时输入 incudal 可重新进入此管理脚本${NC}"
    divider
    echo ""
}

# ========================== RFW 防火墙 ==========================

# RFW 下载地址
readonly RFW_RELEASE_URL="https://github.com/0xdabiaoge/incudal-rfw/releases/latest/download"
readonly RFW_INSTALL_DIR="/root/rfw"
readonly RFW_SERVICE_FILE="/etc/systemd/system/rfw.service"

# RFW 交互式配置规则
configure_rfw_rules() {
    RFW_ARGS=""
    RFW_SUMMARY_RULES=""
    RFW_SUMMARY_GEO=""
    RFW_SUMMARY_LOG="关闭"

    echo ""
    divider
    echo -e "  ${BOLD}配置 RFW 屏蔽规则${NC}"
    divider
    echo ""

    # 1. 协议屏蔽多选
    echo -e "  ┌─ 协议屏蔽（可多选，输入编号用空格分隔）──────────"
    echo -e "  │"
    echo -e "  │   1) 屏蔽邮件发送       ─  SMTP 25/587/465/2525"
    echo -e "  │   2) 屏蔽 HTTP 入站     ─  明文 HTTP 协议探测"
    echo -e "  │   3) 屏蔽 SOCKS5 入站   ─  代理协议探测"
    echo -e "  │   4) 屏蔽全加密流量     ─  SS/V2Ray（严格模式）"
    echo -e "  │   5) 屏蔽 WireGuard     ─  VPN 协议探测"
    echo -e "  │   6) 屏蔽 QUIC/HTTP3    ─  QUIC 协议"
    echo -e "  │   7) 屏蔽所有入站       ─  最激进模式"
    echo -e "  │"
    echo -e "  │   A) 全选(1-6)  D) 默认(1-5)  C) 清空"
    echo -e "  └──────────────────────────────────────────────────"
    echo ""
    echo -ne "  ${BOLD}请选择 [默认 D]: ${NC}"
    read -r rule_choice || true
    rule_choice=$(echo "${rule_choice:-D}" | tr '[:lower:]' '[:upper:]')

    local selected_rules=()
    local rule_names=()
    local block_all=false

    if [[ "$rule_choice" == "A" ]]; then
        rule_choice="1 2 3 4 5 6"
    elif [[ "$rule_choice" == "D" ]]; then
        rule_choice="1 2 3 4 5"
    elif [[ "$rule_choice" == "C" ]]; then
        rule_choice=""
    fi

    for c in $rule_choice; do
        case "$c" in
            1) selected_rules+=("--block-email"); rule_names+=("Email") ;;
            2) selected_rules+=("--block-http"); rule_names+=("HTTP") ;;
            3) selected_rules+=("--block-socks5"); rule_names+=("SOCKS5") ;;
            4) selected_rules+=("--block-fet-strict"); rule_names+=("FET-Strict") ;;
            5) selected_rules+=("--block-wireguard"); rule_names+=("WireGuard") ;;
            6) selected_rules+=("--block-quic"); rule_names+=("QUIC") ;;
            7) block_all=true ;;
        esac
    done

    if [[ "$block_all" == "true" ]]; then
        RFW_ARGS+=" --block-all"
        RFW_SUMMARY_RULES="所有入站"
    else
        if [[ ${#selected_rules[@]} -gt 0 ]]; then
            RFW_ARGS+=" ${selected_rules[*]}"
            RFW_SUMMARY_RULES=$(IFS=/ ; echo "${rule_names[*]}")
        else
            RFW_SUMMARY_RULES="无协议屏蔽"
        fi
    fi

    # 2. GeoIP 模式
    echo ""
    echo -e "  ┌─ GeoIP 过滤模式 ──────────────────────────────────"
    echo -e "  │"
    echo -e "  │   1) 黑名单模式  ─  屏蔽指定国家（推荐）"
    echo -e "  │   2) 白名单模式  ─  仅允许指定国家"
    echo -e "  │   3) 不使用 GeoIP ─  全局协议过滤"
    echo -e "  │"
    echo -e "  └──────────────────────────────────────────────────"
    echo ""
    echo -ne "  ${BOLD}请选择 [默认 1]: ${NC}"
    read -r geo_choice || true
    geo_choice=${geo_choice:-1}

    local countries=""
    if [[ "$geo_choice" == "1" || "$geo_choice" == "2" ]]; then
        echo -ne "  ${BOLD}请输入国家代码（逗号分隔）[默认 CN]: ${NC}"
        read -r countries || true
        countries=${countries:-CN}
        # 转换为大写并去除多余空格
        countries=$(echo "$countries" | tr '[:lower:]' '[:upper:]' | tr -d ' ')
        
        if [[ "$geo_choice" == "1" ]]; then
            # 如果选了 block_all，则使用 --block-all-from 作为快捷方式
            if [[ "$block_all" == "true" ]]; then
                RFW_ARGS=$(echo "$RFW_ARGS" | sed 's/ --block-all//')
                RFW_ARGS+=" --block-all-from $countries"
            else
                RFW_ARGS+=" --countries $countries"
            fi
            RFW_SUMMARY_GEO="黑名单 ($countries)"
        else
            RFW_ARGS+=" --allow-only-countries $countries"
            RFW_SUMMARY_GEO="白名单 ($countries)"
        fi
    else
        RFW_SUMMARY_GEO="不使用 GeoIP"
    fi

    # 3. 端口日志
    echo ""
    echo -e "  ┌─ 其他选项 ──────────────────────────────────────"
    echo -e "  │"
    echo -ne "  │   启用端口访问日志？[y/N]: ${NC}"
    read -r log_choice || true
    if [[ "${log_choice:-}" =~ ^[yY]$ ]]; then
        RFW_ARGS+=" --log-port-access"
        RFW_SUMMARY_LOG="开启"
    fi

    # 4. 配置确认
    echo ""
    echo -e "  ┌─ 配置确认 ──────────────────────────────────────"
    echo -e "  │  屏蔽规则  :  ${GREEN}${RFW_SUMMARY_RULES}${NC}"
    echo -e "  │  GeoIP     :  ${GREEN}${RFW_SUMMARY_GEO}${NC}"
    echo -e "  │  端口日志  :  ${GREEN}${RFW_SUMMARY_LOG}${NC}"
    echo -e "  │  "
    echo -e "  │  运行参数  :  ${DIM}${RFW_ARGS}${NC}"
    echo -e "  └──────────────────────────────────────────────────"
    echo ""
    echo -ne "  ${YELLOW}确认安装此配置？${NC}[Y/n]: "
    read -r confirm || true
    if [[ "${confirm:-Y}" =~ ^[nN]$ ]]; then
        info "已取消配置"
        return 1
    fi
    return 0
}

# 安装 RFW 防火墙
install_rfw() {
    echo ""
    divider
    echo -e "  ${BOLD}安装 RFW 入站流量屏蔽防火墙${NC}"
    divider
    echo ""

    # 检查是否已安装
    if [[ -f "${RFW_INSTALL_DIR}/rfw" ]] && systemctl is-active --quiet rfw 2>/dev/null; then
        local rfw_status
        rfw_status=$(systemctl is-active rfw 2>/dev/null || echo "未知")
        warn "RFW 已安装且正在运行（状态: ${rfw_status}）"
        echo -ne "  ${BOLD}是否重新安装？${NC}[y/N]: "
        read -r reinstall || true
        if [[ ! "${reinstall:-}" =~ ^[yY]$ ]]; then
            info "已取消"
            return 0
        fi
        # 先停止旧服务
        systemctl stop rfw 2>/dev/null || true
        systemctl disable rfw 2>/dev/null || true
    fi

    # 检测架构
    step "检测系统架构..."
    local arch_suffix=""
    case "$(uname -m)" in
        x86_64)
            arch_suffix="x86_64"
            ;;
        aarch64|arm64)
            arch_suffix="aarch64"
            ;;
        *)
            error "不支持的架构: $(uname -m)（仅支持 x86_64 / aarch64）"
            return 1
            ;;
    esac
    log "系统架构: $(uname -m) (${arch_suffix})"

    # 选择网络接口
    step "选择网络接口..."
    local interfaces=()
    while IFS= read -r iface; do
        [[ -z "$iface" ]] && continue
        interfaces+=("$iface")
    done < <(ip -o link show | awk -F': ' '{print $2}' | grep -v lo)

    if [[ ${#interfaces[@]} -eq 0 ]]; then
        error "未找到可用的网络接口"
        return 1
    fi

    local selected_interface=""

    if [[ ${#interfaces[@]} -eq 1 ]]; then
        # 只有一个接口，自动选择
        selected_interface="${interfaces[0]}"
        info "自动选择网卡: ${selected_interface}"
    else
        echo ""
        echo -e "  可用的网络接口："
        local i
        for i in "${!interfaces[@]}"; do
            local num=$((i + 1))
            # 获取该接口的 IP
            local iface_ip
            iface_ip=$(ip -4 addr show "${interfaces[$i]}" 2>/dev/null | awk '/inet / {print $2}' | head -n1 || echo "")
            if [[ -n "$iface_ip" ]]; then
                echo -e "    ${CYAN}${num})${NC}  ${interfaces[$i]}  ${DIM}(${iface_ip})${NC}"
            else
                echo -e "    ${CYAN}${num})${NC}  ${interfaces[$i]}"
            fi
        done
        echo ""

        while true; do
            echo -ne "  ${BOLD}请选择网卡编号 [1-${#interfaces[@]}]: ${NC}"
            read -r iface_choice || true
            if [[ "${iface_choice:-}" =~ ^[0-9]+$ ]] && \
               [[ "$iface_choice" -ge 1 ]] && \
               [[ "$iface_choice" -le "${#interfaces[@]}" ]]; then
                selected_interface="${interfaces[$((iface_choice - 1))]}"
                break
            else
                warn "无效输入，请重新选择"
            fi
        done
    fi

    log "使用网卡: ${selected_interface}"

    # 下载 RFW 二进制文件
    step "下载 RFW 程序..."
    mkdir -p "$RFW_INSTALL_DIR"

    local rfw_url="${RFW_RELEASE_URL}/rfw-${arch_suffix}-unknown-linux-musl"
    local download_ok=false
    local attempt

    for attempt in 1 2 3; do
        info "下载 RFW (第 ${attempt} 次)..."
        if curl -sSfL --connect-timeout 15 --max-time 120 \
            "$rfw_url" -o "${RFW_INSTALL_DIR}/rfw" 2>/dev/null; then
            download_ok=true
            break
        else
            warn "第 ${attempt} 次下载失败"
            [[ "$attempt" -lt 3 ]] && sleep 3
        fi
    done

    if [[ "$download_ok" != "true" ]]; then
        error "RFW 下载失败（已重试 3 次）"
        error "下载地址: ${rfw_url}"
        return 1
    fi

    chmod +x "${RFW_INSTALL_DIR}/rfw"
    log "RFW 下载完成"

    # 交互式配置 RFW 规则
    if ! configure_rfw_rules; then
        return 0
    fi

    # 创建 systemd 服务
    step "配置 RFW 服务..."

    cat > "$RFW_SERVICE_FILE" <<EOF
[Unit]
Description=RFW Firewall Service
After=network.target

[Service]
Type=simple
User=root
Environment=RUST_LOG=info
ExecStart=${RFW_INSTALL_DIR}/rfw --iface ${selected_interface}${RFW_ARGS}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload

    # 启动服务
    step "启动 RFW 服务..."
    systemctl start rfw
    systemctl enable rfw 2>/dev/null || true

    # 验证
    sleep 2
    if systemctl is-active --quiet rfw 2>/dev/null; then
        echo ""
        echo -e "${GREEN}  ╔══════════════════════════════════════════════════╗${NC}"
        echo -e "${GREEN}  ║                                                  ║${NC}"
        echo -e "${GREEN}  ║           ✓  RFW 防火墙安装完成                  ║${NC}"
        echo -e "${GREEN}  ║                                                  ║${NC}"
        echo -e "${GREEN}  ╚══════════════════════════════════════════════════╝${NC}"
        echo ""
        echo -e "  监听网卡  :  ${GREEN}${selected_interface}${NC}"
        echo -e "  服务状态  :  ${GREEN}运行中${NC}"
        echo -e "  屏蔽规则  :  ${GREEN}${RFW_SUMMARY_RULES}${NC}"
        echo -e "  GeoIP配置 :  ${GREEN}${RFW_SUMMARY_GEO}${NC}"
        echo -e "  端口日志  :  ${GREEN}${RFW_SUMMARY_LOG}${NC}"
        echo ""
        divider
        echo -e "  ${DIM}查看日志: journalctl -u rfw -f${NC}"
        echo -e "  ${DIM}查看状态: systemctl status rfw${NC}"
        if [[ "$RFW_SUMMARY_LOG" == "开启" ]]; then
            echo -e "  ${DIM}查看拦截: ${RFW_INSTALL_DIR}/rfw stats${NC}"
        fi
        divider
        echo ""
    else
        error "RFW 服务启动失败"
        error "请运行 journalctl -u rfw -n 20 查看日志"
    fi
}

# 卸载 RFW 防火墙
uninstall_rfw() {
    echo ""

    # 检查是否安装
    if [[ ! -f "${RFW_INSTALL_DIR}/rfw" ]] && \
       ! systemctl list-unit-files 2>/dev/null | grep -q "rfw.service"; then
        warn "RFW 未安装，无需卸载"
        return 0
    fi

    divider
    echo -e "  ${RED}${BOLD}卸载 RFW 防火墙${NC}"
    divider
    echo ""
    echo -e "  ${RED}将删除以下内容：${NC}"
    echo -e "    ${RED}•${NC}  RFW 二进制文件 (${RFW_INSTALL_DIR}/)"
    echo -e "    ${RED}•${NC}  RFW systemd 服务文件"
    echo ""
    echo -ne "  ${BOLD}确认卸载 RFW？${NC}[y/N]: "
    read -r rfw_confirm || true
    if [[ ! "${rfw_confirm:-}" =~ ^[yY]$ ]]; then
        info "已取消"
        return 0
    fi

    do_rfw_cleanup
}

# RFW 清理（供独立卸载和主卸载共用）
do_rfw_cleanup() {
    info "停止 RFW 服务..."
    systemctl stop rfw 2>/dev/null || true
    systemctl disable rfw 2>/dev/null || true

    # 删除服务文件
    rm -f /etc/systemd/system/rfw.service 2>/dev/null || true
    rm -f /usr/lib/systemd/system/rfw.service 2>/dev/null || true
    rm -f /lib/systemd/system/rfw.service 2>/dev/null || true

    # 删除程序目录
    rm -rf "$RFW_INSTALL_DIR" 2>/dev/null || true

    systemctl daemon-reload 2>/dev/null || true

    log "RFW 防火墙已卸载"
}

# ========================== 卸载功能 ==========================

# 卸载确认（双重确认，防止误操作）
confirm_uninstall() {
    echo ""
    echo -e "  ${RED}${BOLD}╔══════════════════════════════════════════════════╗${NC}"
    echo -e "  ${RED}${BOLD}║              ⚠  卸载警告                        ║${NC}"
    echo -e "  ${RED}${BOLD}╚══════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  ${RED}此操作将彻底删除以下内容：${NC}"
    echo ""
    echo -e "    ${RED}•${NC}  所有 LXC 容器及其数据（不可恢复）"
    echo -e "    ${RED}•${NC}  所有容器镜像和快照"
    echo -e "    ${RED}•${NC}  所有存储池及数据"
    echo -e "    ${RED}•${NC}  网桥 ${BRIDGE_NAME} 及网络配置"
    echo -e "    ${RED}•${NC}  Incus 软件包及配置"
    echo -e "    ${RED}•${NC}  Zabbly APT 源和 GPG 密钥"
    echo -e "    ${RED}•${NC}  本脚本添加的内核参数"
    echo ""
    divider
    echo -ne "  ${RED}${BOLD}确认要彻底卸载 Incus 节点？${NC}[y/N]: "
    read -r confirm1
    if [[ ! "$confirm1" =~ ^[yY]$ ]]; then
        info "已取消卸载"
        exit 0
    fi

    echo ""
    echo -ne "  ${RED}${BOLD}再次确认：所有容器数据将永久丢失！${NC}输入 ${YELLOW}YES${NC} 继续: "
    read -r confirm2
    if [[ "$confirm2" != "YES" ]]; then
        info "已取消卸载（需要输入大写 YES 确认）"
        exit 0
    fi
}

# 执行卸载
do_uninstall() {
    confirm_uninstall

    echo ""
    divider
    echo -e "  ${BOLD}开始卸载...${NC}"
    divider

    # ---- 步骤 1: 停止并删除所有容器 ----
    step "步骤 [1/8]  停止并删除所有容器..."
    if command -v incus &>/dev/null; then
        # 获取所有容器列表
        local containers
        containers=$(incus list --format csv -c n 2>/dev/null || true)
        if [[ -n "$containers" ]]; then
            while IFS= read -r cname; do
                [[ -z "$cname" ]] && continue
                info "停止容器: ${cname}"
                incus stop "$cname" --force 2>/dev/null || true
                info "删除容器: ${cname}"
                incus delete "$cname" --force 2>/dev/null || true
            done <<< "$containers"
            log "所有容器已删除"
        else
            info "无运行中的容器"
        fi
    else
        info "Incus 未安装，跳过容器清理"
    fi

    # ---- 步骤 2: 删除所有镜像 ----
    step "步骤 [2/8]  清理容器镜像..."
    if command -v incus &>/dev/null; then
        local images
        images=$(incus image list --format csv -c f 2>/dev/null || true)
        if [[ -n "$images" ]]; then
            while IFS= read -r fingerprint; do
                [[ -z "$fingerprint" ]] && continue
                incus image delete "$fingerprint" 2>/dev/null || true
            done <<< "$images"
            log "所有镜像已删除"
        else
            info "无缓存镜像"
        fi
    fi

    # ---- 步骤 3: 删除网桥和存储池 ----
    step "步骤 [3/8]  删除网络和存储池..."
    if command -v incus &>/dev/null; then
        # 删除面板信任证书
        if incus config trust list --format csv 2>/dev/null | grep -q "panel"; then
            info "移除面板信任证书"
            incus config trust remove panel 2>/dev/null || true
        fi

        # 删除自定义 profile（保留 default）
        local profiles
        profiles=$(incus profile list --format csv -c n 2>/dev/null | grep -v '^default$' || true)
        if [[ -n "$profiles" ]]; then
            while IFS= read -r pname; do
                [[ -z "$pname" ]] && continue
                info "删除 Profile: ${pname}"
                incus profile delete "$pname" 2>/dev/null || true
            done <<< "$profiles"
        fi

        # 删除网桥
        if incus network show "$BRIDGE_NAME" &>/dev/null; then
            info "删除网桥: ${BRIDGE_NAME}"
            incus network delete "$BRIDGE_NAME" 2>/dev/null || true
        fi

        # 删除所有其他托管网络
        local networks
        networks=$(incus network list --format csv -c n 2>/dev/null || true)
        if [[ -n "$networks" ]]; then
            while IFS= read -r nname; do
                [[ -z "$nname" ]] && continue
                info "删除网络: ${nname}"
                incus network delete "$nname" 2>/dev/null || true
            done <<< "$networks"
        fi

        # 删除所有存储池
        local pools
        pools=$(incus storage list --format csv -c n 2>/dev/null || true)
        if [[ -n "$pools" ]]; then
            while IFS= read -r pool; do
                [[ -z "$pool" ]] && continue
                info "删除存储池: ${pool}"
                # 先删除池中的存储卷
                local volumes
                volumes=$(incus storage volume list "$pool" --format csv -c n 2>/dev/null || true)
                if [[ -n "$volumes" ]]; then
                    while IFS= read -r vol; do
                        [[ -z "$vol" ]] && continue
                        incus storage volume delete "$pool" "$vol" 2>/dev/null || true
                    done <<< "$volumes"
                fi
                incus storage delete "$pool" 2>/dev/null || true
            done <<< "$pools"
        fi

        log "网络和存储池已清理"
    fi

    # ---- 步骤 4: 停止 Incus 服务 ----
    step "步骤 [4/8]  停止 Incus 服务..."
    systemctl stop incus.service 2>/dev/null || true
    systemctl stop incus.socket 2>/dev/null || true
    systemctl stop incus-user.service 2>/dev/null || true
    systemctl stop incus-user.socket 2>/dev/null || true
    systemctl stop incus-startup.service 2>/dev/null || true
    systemctl disable incus.service 2>/dev/null || true
    systemctl disable incus.socket 2>/dev/null || true
    systemctl disable incus-user.service 2>/dev/null || true
    systemctl disable incus-user.socket 2>/dev/null || true
    systemctl disable incus-startup.service 2>/dev/null || true
    log "Incus 服务已停止"

    # ---- 步骤 5: 卸载软件包 ----
    step "步骤 [5/8]  卸载软件包..."
    export DEBIAN_FRONTEND=noninteractive
    
    # 1. 强制停止服务和进程防卡死
    systemctl stop incus incus.socket incus-lxcfs incus-startup 2>/dev/null || true
    systemctl disable incus incus.socket incus-lxcfs incus-startup 2>/dev/null || true
    pkill -9 -f "incus" 2>/dev/null || true

    # 2. 直接强制尝试卸载所有相关的包（使用正则覆盖包名）
    apt-get purge -y -qq "^incus.*" lxcfs 2>/dev/null || true
    
    # 3. 兜底彻底斩断二进制文件（防止包管理器 Broken 状态导致系统内指令幽灵残留）
    rm -rf /opt/incus 2>/dev/null || true
    rm -f /usr/bin/incus* /usr/sbin/incus* /usr/local/bin/incus* 2>/dev/null || true
    
    log "Incus 相关软件包及其幽灵残留已强制清除"

    # 清理不再需要的依赖
    apt-get autoremove -y -qq 2>/dev/null || true
    log "依赖清理完成"

    # ---- 步骤 6: 清理 APT 源和密钥 ----
    step "步骤 [6/8]  清理 APT 源和密钥..."
    local cleaned=false

    if [[ -f /etc/apt/sources.list.d/zabbly-incus-stable.sources ]]; then
        rm -f /etc/apt/sources.list.d/zabbly-incus-stable.sources
        info "已删除: zabbly-incus-stable.sources"
        cleaned=true
    fi

    if [[ -f /etc/apt/keyrings/zabbly.gpg ]]; then
        rm -f /etc/apt/keyrings/zabbly.gpg
        info "已删除: zabbly.gpg"
        cleaned=true
    fi

    if [[ "$cleaned" == "true" ]]; then
        apt-get update -qq 2>/dev/null || true
        log "APT 源和密钥已清理"
    else
        info "APT 源和密钥不存在，跳过"
    fi

    # ---- 步骤 7: 清理外挂服务（RFW / WARP / 守护进程） ----
    step "步骤 [7/8]  清理外挂防护与网络代理服务..."
    
    # 1. 清理 RFW
    if [[ -f "${RFW_INSTALL_DIR}/rfw" ]] || \
       systemctl list-unit-files 2>/dev/null | grep -q "rfw.service"; then
        do_rfw_cleanup
    else
        info "RFW 未安装，跳过"
    fi

    # 2. 清理 WARP 和 IPv6 路由守护神
    if ip link show wg0 >/dev/null 2>&1 || [[ -f /usr/local/bin/wgcf ]] || [[ -d /etc/wireguard ]]; then
        systemctl stop wg-quick@wg0 2>/dev/null || true
        systemctl disable wg-quick@wg0 2>/dev/null || true
        rm -rf /etc/wireguard/ 2>/dev/null || true
        rm -f /usr/local/bin/wgcf 2>/dev/null || true
        rm -f /usr/local/bin/incus-warp 2>/dev/null || true
        
        systemctl stop ipv6-route-guard 2>/dev/null || true
        systemctl disable ipv6-route-guard 2>/dev/null || true
        rm -f /etc/systemd/system/ipv6-route-guard.service 2>/dev/null || true
        rm -f /usr/local/bin/ipv6-route-guard.sh 2>/dev/null || true
        
        systemctl daemon-reload
        info "已清理: Cloudflare WARP 出海通道及路由守护服务"
    else
        info "WARP 网络组件未安装，跳过"
    fi

    # 3. 清除 IPv6 同步守护神服务
    if systemctl list-unit-files 2>/dev/null | grep -q "incus-v6-guardian.service"; then
        systemctl stop incus-v6-guardian 2>/dev/null || true
        systemctl disable incus-v6-guardian 2>/dev/null || true
        rm -f /etc/systemd/system/incus-v6-guardian.service
        rm -f /usr/local/bin/incus-v6-guardian.sh
        systemctl daemon-reload
        info "已清理: IPv6 双栈同步守护神 (Guardian Daemon)"
    fi

    # ---- 步骤 8: 清理配置文件和数据目录 ----
    step "步骤 [8/8]  清理配置和数据文件..."

    # 内核参数配置
    if [[ -f /etc/sysctl.d/99-incus.conf ]]; then
        rm -f /etc/sysctl.d/99-incus.conf
        info "已删除: /etc/sysctl.d/99-incus.conf"
    fi

    if [[ -f /etc/modules-load.d/br_netfilter.conf ]]; then
        rm -f /etc/modules-load.d/br_netfilter.conf
        info "已删除: /etc/modules-load.d/br_netfilter.conf"
    fi

    # 重新加载 sysctl（移除自定义参数）
    sysctl --system >/dev/null 2>&1 || true

    # Incus 数据目录
    if [[ -d /var/lib/incus ]]; then
        rm -rf /var/lib/incus
        info "已删除: /var/lib/incus/"
    fi

    # Incus 日志目录
    if [[ -d /var/log/incus ]]; then
        rm -rf /var/log/incus
        info "已删除: /var/log/incus/"
    fi

    # Incus 运行时目录
    if [[ -d /run/incus ]]; then
        rm -rf /run/incus
        info "已删除: /run/incus/"
    fi

    # Incus 用户配置目录
    if [[ -d /root/.config/incus ]]; then
        rm -rf /root/.config/incus
        info "已删除: /root/.config/incus/"
    fi

    # 用户子 UID/GID 映射（Incus 可能添加的条目）
    if grep -q "incus" /etc/subuid 2>/dev/null; then
        sed -i '/incus/d' /etc/subuid 2>/dev/null || true
        info "已清理: /etc/subuid 中的 incus 条目"
    fi
    if grep -q "incus" /etc/subgid 2>/dev/null; then
        sed -i '/incus/d' /etc/subgid 2>/dev/null || true
        info "已清理: /etc/subgid 中的 incus 条目"
    fi

    # 清除安装脚本、日志文件、下载的包缓存等
    rm -f /root/log.txt /root/zfs-modules-*.tar.gz 2>/dev/null || true
    local script_path
    script_path=$(realpath "$0" 2>/dev/null || echo "$0")
    if [[ -f "$script_path" && ! "$script_path" =~ (bash|sh)$ ]]; then
        rm -f "$script_path"
        info "已清理安装脚本自身: $script_path"
    fi

    log "配置和数据文件清理完成"

    # ---- 卸载完成 ----
    echo ""
    echo -e "${GREEN}  ╔══════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}  ║                                                  ║${NC}"
    echo -e "${GREEN}  ║           ✓  卸载完成                            ║${NC}"
    echo -e "${GREEN}  ║                                                  ║${NC}"
    echo -e "${GREEN}  ╚══════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  已清理的内容："
    echo -e "    ${GREEN}✓${NC}  所有 LXC 容器和镜像"
    echo -e "    ${GREEN}✓${NC}  网桥和存储池"
    echo -e "    ${GREEN}✓${NC}  Incus 服务和软件包"
    echo -e "    ${GREEN}✓${NC}  APT 源和 GPG 密钥"
    echo -e "    ${GREEN}✓${NC}  RFW 防火墙"
    echo -e "    ${GREEN}✓${NC}  内核参数配置"
    echo -e "    ${GREEN}✓${NC}  数据和日志目录"
    echo -e "    ${GREEN}✓${NC}  安装脚本自身及缓存"
    echo ""
    divider
    echo -e "  ${DIM}系统已还原。如需重新安装，请再次运行此脚本。${NC}"
    divider
    echo ""

    # 删除自身脚本及任何下载的面板脚本残留
    rm -f "$0" 2>/dev/null || true
    rm -f incudal-install.sh *.install.sh install.sh incudal.sh 2>/dev/null || true
    rm -f /root/install.sh /root/incudal.sh 2>/dev/null || true
}

# -----------------------------------------------------------------------------
# IPv6 Guardian Daemon (双栈端口同步补丁)
# -----------------------------------------------------------------------------
setup_v6_guardian() {
    log "正在部署 IPv6 双栈端口同步守护进程 (Guardian Daemon)..."
    
    local guardian_script="/usr/local/bin/incus-v6-guardian.sh"
    local guardian_service="/etc/systemd/system/incus-v6-guardian.service"
    
    cat > "$guardian_script" << 'EOF'
#!/bin/bash
# Incudal - IPv6 Dual-Stack Guardian Daemon
# 每 15 秒轮询，将新建的单栈 IPv4 端口映射同步生成一份 IPv6 双栈跨协议互通映射。
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

while true; do
  # 防止云服务商 NetworkManager 因网络波动重置内核参数，导致 proxy_ndp 失效
  if [[ -f /etc/sysctl.d/99-incus.conf ]]; then
      sysctl -p /etc/sysctl.d/99-incus.conf >/dev/null 2>&1 || true
  fi

  for c in $(incus list -c n,s --format=csv 2>/dev/null | awk -F, '$2=="RUNNING" {print $1}'); do
    devices=$(incus config device show "$c" 2>/dev/null) || continue
    
    ip_v4=$(incus list "$c" -c 4 --format=csv 2>/dev/null | grep -E -o '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | head -n1 || echo "127.0.0.1")

    # TCP 新增同步
    v4_tcp_proxies=$(echo "$devices" | awk -F: '/^proxy-tcp-[0-9]+/ {print $1}' | tr -d ' ')
    for proxy in $v4_tcp_proxies; do
      port=$(echo "$proxy" | awk -F'-' '{print $3}')
      if ! echo "$devices" | grep -q "^proxy-v6-tcp-${port}:$"; then
         original_connect=$(incus config device get "$c" "$proxy" connect 2>/dev/null)
         target_port=$(echo "$original_connect" | awk -F: '{print $NF}')
         [[ -z "$target_port" ]] && target_port="$port"
         incus config device add "$c" proxy-v6-tcp-${port} proxy listen=tcp:[::]:${port} connect=tcp:${ip_v4}:${target_port} >/dev/null 2>&1
      fi
    done

    # UDP 新增同步
    v4_udp_proxies=$(echo "$devices" | awk -F: '/^proxy-udp-[0-9]+/ {print $1}' | tr -d ' ')
    for proxy in $v4_udp_proxies; do
      port=$(echo "$proxy" | awk -F'-' '{print $3}')
      if ! echo "$devices" | grep -q "^proxy-v6-udp-${port}:$"; then
         original_connect=$(incus config device get "$c" "$proxy" connect 2>/dev/null)
         target_port=$(echo "$original_connect" | awk -F: '{print $NF}')
         [[ -z "$target_port" ]] && target_port="$port"
         incus config device add "$c" proxy-v6-udp-${port} proxy listen=udp:[::]:${port} connect=udp:${ip_v4}:${target_port} >/dev/null 2>&1
      fi
    done
    
    # TCP 孤儿清理
    v6_tcp_proxies=$(echo "$devices" | awk -F: '/^proxy-v6-tcp-[0-9]+/ {print $1}' | tr -d ' ')
    for proxy in $v6_tcp_proxies; do
      port=$(echo "$proxy" | awk -F'-' '{print $4}')
      if ! echo "$devices" | grep -q "^proxy-tcp-${port}:$"; then
         incus config device remove "$c" proxy-v6-tcp-${port} >/dev/null 2>&1
      fi
    done

    # UDP 孤儿清理
    v6_udp_proxies=$(echo "$devices" | awk -F: '/^proxy-v6-udp-[0-9]+/ {print $1}' | tr -d ' ')
    for proxy in $v6_udp_proxies; do
      port=$(echo "$proxy" | awk -F'-' '{print $4}')
      if ! echo "$devices" | grep -q "^proxy-udp-${port}:$"; then
         incus config device remove "$c" proxy-v6-udp-${port} >/dev/null 2>&1
      fi
    done
  done
  sleep 15
done
EOF

    chmod +x "$guardian_script"

    cat > "$guardian_service" << EOF
[Unit]
Description=Incudal IPv6 Dual-Stack Guardian Daemon
After=network.target

[Service]
Type=simple
ExecStart=$guardian_script
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload 2>/dev/null || true
    systemctl enable incus-v6-guardian 2>/dev/null || true
    systemctl restart incus-v6-guardian 2>/dev/null || true
    
    info "守护神服务已启动：每隔 15 秒自动打通新增容器的反向 IPv6 映射"
}

# ========================== 主流程入口 ==========================
main() {
    # 显示横幅
    show_banner

    # Root 权限检查
    if [[ "$EUID" -ne 0 ]]; then
        error "请以 root 权限运行此脚本"
        echo -e "  ${DIM}用法: sudo bash $0${NC}"
        exit 1
    fi

    # 检测系统环境
    detect_system

    # ---- 解析命令行参数（兼容非交互模式）----
    local ACTION="install"   # 默认动作为安装
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --mode)
                MODE="$2"; shift 2 ;;
            --token)
                TOKEN="$2"; shift 2 ;;
            --ipv6-subnet)
                IPV6_SUBNET="$2"; shift 2 ;;
            --ipv6-iface)
                IPV6_IFACE="$2"; shift 2 ;;
            --port|-p)
                LISTEN_PORT="$2"; shift 2 ;;
            --uninstall)
                ACTION="uninstall"; shift ;;
            --agent|--agent-menu)
                ACTION="agent"; shift ;;
            --help|-h)
                echo "用法: $0 [选项]"
                echo ""
                echo "选项:"
                echo "  --mode <nat|nat_ipv6>   网络模式（不指定则交互选择）"
                echo "  --token <TOKEN>         面板认证 Token"
                echo "  --ipv6-subnet <CIDR>    IPv6 子网段（例如 2001:db8::/64）"
                echo "  --ipv6-iface <IFACE>    IPv6 路由父网卡（例如 eth0）"
                echo "  --port <PORT>           自定义 Incus 运行端口 (默认 8443)"
                echo "  --uninstall             卸载 Incus 节点并还原系统"
                echo "  --agent                 打开 Agent 安装 / 更新菜单"
                echo "  --help, -h              显示帮助信息"
                echo ""
                echo "交互模式: sudo bash $0"
                echo "命令行:   sudo bash $0 --mode nat --token <YOUR_TOKEN> --port 10001"
                echo "卸载:     sudo bash $0 --uninstall"
                exit 0
                ;;
            *)
                error "未知参数: $1"
                echo -e "  ${DIM}使用 --help 查看帮助${NC}"
                exit 1
                ;;
        esac
    done

    # 如果通过命令行指定了卸载，直接执行
    if [[ "$ACTION" == "uninstall" ]]; then
        do_uninstall
        exit 0
    fi
    if [[ "$ACTION" == "agent" ]]; then
        manage_incudal_agent
        exit 0
    fi

    # ---- 交互式流程 ----

    # 如果 stdin 不是终端且缺少参数，给出提示
    if [[ ! -t 0 ]]; then
        if [[ -z "$MODE" || -z "$TOKEN" ]]; then
            error "通过管道执行时，必须提供 --mode 和 --token 参数"
            echo -e "  ${DIM}示例: curl -sL <URL> | sudo bash -s -- --mode nat --token <TOKEN>${NC}"
            exit 1
        fi
    fi

    # 合并注入变量与 CLI 参数
    TOKEN="${INJECT_TOKEN:-${TOKEN:-}}"
    MODE="${INJECT_MODE:-${MODE:-}}"
    IPV6_SUBNET="${INJECT_IPV6_SUBNET:-${IPV6_SUBNET:-}}"
    IPV6_IFACE="${INJECT_IPV6_IFACE:-${IPV6_IFACE:-}}"

    # 模式选择（未通过 CLI 或面板注入指定时进入菜单）
    if [[ -z "$MODE" ]]; then
        show_system_info

        while true; do
            show_menu
            read -r choice
            echo ""

            case "$choice" in
                1)  MODE="nat";      break ;;
                2)
                    MODE="nat_ipv6"
                    echo -e "\n${CYAN}正在检测宿主机 IPv6 网络配置...${NC}"
                    
                    local detect_iface=""
                    local detect_ip=""
                    detect_iface=$(ip -6 route show default 2>/dev/null | awk '/dev/ {for(i=1;i<=NF;i++) if($i=="dev") print $(i+1)}' | head -n1 || true)
                    if [[ -z "$detect_iface" ]]; then
                        detect_iface=$(ip route show default 2>/dev/null | awk '/dev/ {for(i=1;i<=NF;i++) if($i=="dev") print $(i+1)}' | head -n1 || true)
                    fi
                    
                    if [[ -n "$detect_iface" ]]; then
                        detect_ip=$(ip -6 addr show dev "$detect_iface" scope global 2>/dev/null | awk '/inet6/ {print $2}' | grep -vEi "^(fd|fe80)" | head -n1 || true)
                    fi

                    echo ""
                    echo -e "  ${CYAN}==> IPv6 实例附加子网配置${NC}"
                    if [[ -n "$detect_ip" ]]; then
                        echo -e "  检测到当前服务器分配的 IPv6 全段为: ${GREEN}${detect_ip}${NC}，网卡: ${GREEN}${detect_iface}${NC}。"
                    else
                        echo -e "  ${YELLOW}未检测到公网 IPv6 地址${NC}"
                    fi
                    echo -e "  ${DIM}若要开启真实 IPv6 入站/出站路由分配，请直接回车采用默认值即可，或手动输入。${NC}"
                    echo -e "  ${DIM}格式须带有网络前缀长度（例如 2a01:4f9.../64），若不需要额外分发 IPv6 请留空跳过。${NC}"
                    echo -ne "  ${BOLD}请输入分配给虚拟机的 IPv6 子网 [回车默认: ${detect_ip:-留空}]: ${NC}"
                    read -r IPV6_SUBNET
                    if [[ -z "$IPV6_SUBNET" ]]; then
                        IPV6_SUBNET="$detect_ip"
                    fi

                    if [[ -n "$IPV6_SUBNET" ]]; then
                        echo -ne "  ${BOLD}请输入此 IPv6 使用的物理网卡名 [回车默认: ${detect_iface:-无}]: ${NC}"
                        read -r IPV6_IFACE
                        if [[ -z "$IPV6_IFACE" ]]; then
                            IPV6_IFACE="$detect_iface"
                        fi
                    fi
                    break
                    ;;
                3)  install_rfw; continue ;;
                4)  show_system_info; continue ;;
                5)  uninstall_rfw; continue ;;
                6)  do_uninstall; exit 0 ;;
                7)  show_network_mode_help; continue ;;
                8)  manage_incudal_agent; continue ;;
                0)  info "再见！"; exit 0 ;;
                *)  warn "无效选项，请重新选择"; continue ;;
            esac
        done
    fi

    # 模式参数合法性验证
    if [[ "$MODE" != "nat" && "$MODE" != "nat_ipv6" ]]; then
        error "--mode 必须为 'nat' 或 'nat_ipv6'"
        exit 1
    fi

    # Token 输入（未通过 CLI 指定或面板注入时交互输入）
    if [[ -z "$TOKEN" ]]; then
        read_token
    else
        local token_masked="${TOKEN:0:8}…${TOKEN: -4}"
        info "Token 已自动配置: ${token_masked}"
    fi

    # 端口修改逻辑
    if [[ -z "${LISTEN_PORT:-}" ]]; then
        echo -e "\n${CYAN}==> (可选) 自定义通信端口${NC}"
        echo -e "  ${DIM}默认 8443，若被防火墙屏蔽可改为 10000+ 端口${NC}"
        echo -ne "  ${BOLD}通信端口 [默认 8443]: ${NC}"
        read -r USER_PORT
        if [[ -n "$USER_PORT" && "$USER_PORT" =~ ^[0-9]+$ ]]; then
            LISTEN_PORT="$USER_PORT"
        else
            LISTEN_PORT="8443"
        fi
    fi

    configure_agent_heartbeat_interval

    # WARP 询问逻辑（纯 IPv6 专供）
    if [[ "$IS_PURE_IPV6" == "true" ]]; then
        if [[ -t 0 ]]; then
            echo -e "\n${CYAN}==> 检测到系统为【纯 IPv6 出站】环境${NC}"
            echo -e "  基于预设，脚本将默认请求 Cloudflare WARP 提供 IPv4 虚拟接驳支持。"
            echo -e "  若您的业务需求须使用纯净原生 IPv6，可选择跳过。"
            echo -ne "  ${BOLD}是否为目前宿主机接驳安装 WARP IPv4 出站通道？[Y/n]: ${NC}"
            read -r WARP_CHOICE
            if [[ "${WARP_CHOICE:-Y}" =~ ^[nN]$ ]]; then
                SKIP_WARP="true"
            else
                SKIP_WARP="false"
            fi
        else
            SKIP_WARP="false"
        fi
    else
        SKIP_WARP="false"
    fi

    # 安装前确认
    confirm_install

    # ---- 执行安装 ----
    echo ""
    divider
    echo -e "  ${BOLD}开始安装...${NC}"
    divider

    if [[ "$IS_PURE_IPV6" == "true" ]]; then
        setup_temp_network  # 接入临时出海通道
        if [[ "${SKIP_WARP:-false}" != "true" ]]; then
            setup_warp_v4     # 搭建底层双规双栈通道
        else
            info "用户已选择跳过 WARP 安装，保留原生纯 IPv6 环境出站"
        fi
    fi

    setup_kernel      # 1/5 内核参数

    # 2/5 系统依赖（用户可能拒绝 DKMS 编译并返回主菜单）
    if ! install_deps; then
        warn "安装已中断，返回主菜单..."
        echo ""
        exec "$0"  # 重新启动脚本回到主菜单
        exit 0
    fi

    install_incus     # 3/5 安装 Incus
    init_incus        # 4/5 初始化 Incus
    import_cert       # 5/5 导入证书
    
    # 仅当启用了 IPv6 相关功能时，挂载 IPv6 双栈同步守护神
    if [[ "$MODE" == "nat_ipv6" ]]; then
        setup_v6_guardian
    fi

    install_incudal_agent

    show_result
}

main "$@"
