/**
 * incus-config-container.ts
 * LXC 容器专用配置生成器
 */

import crypto from 'crypto'

// ==================== 类型定义 ====================

type OsFamily =
  | 'debian'      // Debian, Kali
  | 'ubuntu'      // Ubuntu
  | 'rhel'        // AlmaLinux, CentOS, Rocky, Oracle, Fedora
  | 'rhel8'       // RHEL 8 系列
  | 'suse'        // openSUSE
  | 'alpine'      // Alpine Linux
  | 'arch'        // Arch Linux
  | 'linux'       // VM 通用 Linux
  | 'other'

type PackageManager = 'apt' | 'dnf' | 'yum' | 'zypper' | 'apk' | 'pacman'
type InitSystem = 'systemd' | 'openrc'

interface OsInfo {
  family: OsFamily
  packageManager: PackageManager
  initSystem: InitSystem
  sshServiceName: string
  defaultShell: string
  defaultUsers: string[]
  supportsInclude: boolean
}

// 静态网络配置接口 (支持 IPv6 双栈)
interface StaticNetworkConfig {
  /** IPv4 CIDR 格式，例如: 10.10.1.100/24 */
  ipAddress: string
  /** IPv4 网关，例如: 10.10.1.1 */
  gateway: string
  /** IPv4 DNS，默认为 ["8.8.8.8", "1.1.1.1"] */
  dns?: string[]
  /** IPv6 CIDR 格式，例如: 2001:db8::100/64 */
  ipv6Address?: string
  /** IPv6 网关，例如: 2001:db8::1 */
  ipv6Gateway?: string
  /** IPv6 DNS，例如: ["2001:4860:4860::8888"] */
  ipv6Dns?: string[]
}

export interface IncusConfigParams {
  instanceName: string
  imageAlias: string
  rootPassword: string
  sshKey?: string
  type?: 'container' | 'virtual-machine'
  networkMode?: 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat'
  /** 可选: 面板计算出的静态 IP 配置，不提供则使用 DHCP */
  network?: StaticNetworkConfig
  /** 可选: 用户自定义初始化命令（多行文本，按换行分割） */
  extraShellCommands?: string
}

export interface IncusConfigMetaData {
  sshPort: number
  rootPassword: string
  osFamily: OsFamily
  imageAlias: string
  instanceType: 'container' | 'virtual-machine'
  ipAddress: string
}

export interface IncusConfigResult {
  configPayload: {
    'user.user-data': string
    'user.network-config': string
  }
  metaData: IncusConfigMetaData
}

// ==================== 常量配置 ====================

const CONFIG = {
  SSH_PORT: 22,
  NETWORK_RETRY_COUNT: 20,
  NETWORK_RETRY_DELAY: 3,
  // 核心修复：DNS 指向网桥 dnsmasq 网关，由其代理向上游转发
  // 纯 IPv6 宿主机的网桥上游 DNS 已配置为 DNS64 集群，
  // 容器通过 dnsmasq 间接完成解析，无需直连外部 DNS
  DEFAULT_DNS: ['10.10.0.1'],
  INTERFACE_NAME: 'eth0'  // 容器网络接口名
} as const

// ==================== 工具函数 ====================

export function generateRandomPassword(length: number = 16): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*'
  let password = ''
  for (let i = 0; i < length; i++) {
    password += chars.charAt(crypto.randomInt(chars.length))
  }
  return password
}

function escapeForShellSingleQuote(str: string): string {
  return str.replace(/'/g, "'\"'\"'")
}

function escapeForShellDoubleQuote(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`')
    .replace(/"/g, '\\"')
}

function isValidSshKey(key: string): boolean {
  return /^(ssh-rsa|ssh-ed25519|ecdsa-sha2-nistp256|ecdsa-sha2-nistp384|ecdsa-sha2-nistp521|ssh-dss)\s+[A-Za-z0-9+/=]+/.test(key.trim())
}

// ==================== 操作系统检测 ====================

function isRhel8Series(alias: string): boolean {
  return /alma.*8|rocky.*8|oracle.*8|centos.*8/i.test(alias)
}

function isOldDebian(alias: string): boolean {
  return /debian.*(10|buster|11|bullseye)/i.test(alias)
}

function detectOsInfo(imageAlias: string): OsInfo {
  const alias = imageAlias.toLowerCase()

  if (alias.includes('ubuntu')) {
    return { family: 'ubuntu', packageManager: 'apt', initSystem: 'systemd', sshServiceName: 'ssh', defaultShell: '/bin/bash', defaultUsers: ['root', 'ubuntu'], supportsInclude: true }
  }

  if (alias.includes('arch')) {
    return {
      family: 'arch',
      packageManager: 'pacman',
      initSystem: 'systemd',
      sshServiceName: 'sshd',
      defaultShell: '/bin/bash',
      defaultUsers: ['root', 'arch'],
      supportsInclude: true
    }
  }

  if (alias.includes('kali')) {
    return { family: 'debian', packageManager: 'apt', initSystem: 'systemd', sshServiceName: 'ssh', defaultShell: '/bin/bash', defaultUsers: ['root', 'kali'], supportsInclude: true }
  }

  if (alias.includes('debian')) {
    const isOld = isOldDebian(alias)
    return {
      family: 'debian',
      packageManager: 'apt',
      initSystem: 'systemd',
      sshServiceName: 'ssh',
      defaultShell: '/bin/bash',
      defaultUsers: ['root', 'debian'],
      supportsInclude: !isOld
    }
  }

  if (alias.includes('alpine')) {
    return {
      family: 'alpine',
      packageManager: 'apk',
      initSystem: 'openrc',
      sshServiceName: 'sshd',
      defaultShell: '/bin/ash',
      defaultUsers: ['root'],
      supportsInclude: true
    }
  }

  if (alias.includes('opensuse') || alias.includes('suse') || alias.includes('tumbleweed') || alias.includes('leap')) {
    return { family: 'suse', packageManager: 'zypper', initSystem: 'systemd', sshServiceName: 'sshd', defaultShell: '/bin/bash', defaultUsers: ['root'], supportsInclude: true }
  }

  if (alias.includes('fedora')) {
    return { family: 'rhel', packageManager: 'dnf', initSystem: 'systemd', sshServiceName: 'sshd', defaultShell: '/bin/bash', defaultUsers: ['root', 'fedora'], supportsInclude: true }
  }

  if (alias.includes('alma') || alias.includes('rocky') || alias.includes('oracle') || alias.includes('centos') || alias.includes('rhel')) {
    const isVersion8 = isRhel8Series(alias)
    let defaultUser = 'root'
    if (alias.includes('alma')) defaultUser = 'almalinux'
    else if (alias.includes('rocky')) defaultUser = 'rocky'
    else if (alias.includes('oracle')) defaultUser = 'oracle'
    else if (alias.includes('centos')) defaultUser = 'centos'
    return {
      family: isVersion8 ? 'rhel8' : 'rhel',
      packageManager: isVersion8 ? 'yum' : 'dnf',
      initSystem: 'systemd',
      sshServiceName: 'sshd',
      defaultShell: '/bin/bash',
      defaultUsers: ['root', defaultUser],
      supportsInclude: true
    }
  }

  return { family: 'other', packageManager: 'apt', initSystem: 'systemd', sshServiceName: 'sshd', defaultShell: '/bin/bash', defaultUsers: ['root'], supportsInclude: true }
}

// ==================== 包列表生成 ====================

function getPackagesForOs(osInfo: OsInfo): string[] {
  const commonUtils = ['curl', 'wget', 'sudo', 'ca-certificates']

  switch (osInfo.packageManager) {
    case 'apt':
      return [...commonUtils, 'openssh-server', 'sed', 'grep', 'iproute2']
    case 'dnf':
    case 'yum':
      return [...commonUtils, 'openssh-server', 'openssh-clients', 'sed', 'grep', 'iproute']
    case 'zypper':
      return [...commonUtils, 'openssh', 'sed', 'grep', 'iproute2']
    case 'pacman':
      return []
    case 'apk':
      return []
    default:
      return []
  }
}

// ==================== 设置命令生成 ====================

function wrapWithNetworkRetry(cmd: string): string {
  return `
  j=0
  while [ $j -lt ${CONFIG.NETWORK_RETRY_COUNT} ]; do
    # 动态获取 IPv4 或 IPv6 默认网关作为 DNS，若依然全空，则给予双栈的知名公测兜底 DNS，护航纯 IPv6 及异常段启动
    GW4=$(ip -4 route show default 2>/dev/null | awk '/default/ {print $3}' | head -n 1)
    GW6=$(ip -6 route show default 2>/dev/null | awk '/default/ {print $3}' | head -n 1)
    if [ -n "$GW4" ]; then echo "nameserver $GW4" > /etc/resolv.conf; elif [ -n "$GW6" ]; then echo "nameserver $GW6" > /etc/resolv.conf; else echo -e "nameserver 8.8.8.8\\nnameserver 2001:4860:4860::8888" > /etc/resolv.conf; fi
    
    if ${cmd}; then
      break
    fi
    
    echo "Command failed (attempt $j), retrying in ${CONFIG.NETWORK_RETRY_DELAY}s..."
    j=$((j+1))
    sleep ${CONFIG.NETWORK_RETRY_DELAY}
  done
  `
}

function getSetupCommands(osInfo: OsInfo): string[] {
  const cmds: string[] = []

  // ================= Alpine =================
  if (osInfo.family === 'alpine') {
    cmds.push('sed -i "s/https:/http:/g" /etc/apk/repositories || true')
    const essentialPkgs = 'openssh openssh-server-pam bash shadow sed grep dhcpcd util-linux ca-certificates iproute2'
    const installCmd = `apk update && apk add --no-cache --allow-untrusted ${essentialPkgs}`
    cmds.push(wrapWithNetworkRetry(installCmd))
    cmds.push('sed -i "s/http:/https:/g" /etc/apk/repositories || true')
    cmds.push('touch /etc/shadow && chmod 640 /etc/shadow || true')
  }
  // ================= Arch Linux =================
  else if (osInfo.family === 'arch') {
    const archCmd = 'pacman -Sy --noconfirm openssh sed grep iproute2'
    cmds.push(wrapWithNetworkRetry(archCmd))
    cmds.push('ssh-keygen -A || true')
  }
  // ================= 其他发行版 =================
  else {
    switch (osInfo.packageManager) {
      case 'apt':
        cmds.push(wrapWithNetworkRetry('DEBIAN_FRONTEND=noninteractive apt-get update'))
        cmds.push('DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends openssh-server sed grep iproute2 || true')
        break
      case 'dnf':
        cmds.push(wrapWithNetworkRetry('dnf install -y openssh-server openssh-clients sed grep iproute'))
        break
      case 'yum':
        cmds.push(wrapWithNetworkRetry('yum install -y openssh-server openssh-clients sed grep iproute'))
        break
      case 'zypper':
        cmds.push(wrapWithNetworkRetry('zypper --non-interactive refresh'))
        cmds.push('zypper --non-interactive install -y openssh sed grep iproute2 || true')
        break
    }
  }

  // 通用配置
  cmds.push('mkdir -p /etc/ssh/sshd_config.d')
  cmds.push('sed -i -E "s/^[#[:space:]]*Subsystem[[:space:]]+sftp.*/Subsystem sftp internal-sftp/" /etc/ssh/sshd_config 2>/dev/null || true')
  cmds.push('grep -q "^Subsystem sftp " /etc/ssh/sshd_config || printf "\\n%s\\n" "Subsystem sftp internal-sftp" >> /etc/ssh/sshd_config')

  if (osInfo.supportsInclude) {
    cmds.push('grep -q "^Include /etc/ssh/sshd_config.d" /etc/ssh/sshd_config || sed -i "1i Include /etc/ssh/sshd_config.d/*.conf" /etc/ssh/sshd_config || true')
  }

  cmds.push('command -v ssh-keygen >/dev/null && { test -f /etc/ssh/ssh_host_rsa_key || ssh-keygen -A 2>/dev/null; } || true')

  // 服务管理
  if (osInfo.initSystem === 'systemd') {
    cmds.push(`systemctl unmask ${osInfo.sshServiceName} || true`)
    cmds.push(`systemctl enable ${osInfo.sshServiceName} || true`)
  } else {
    cmds.push(`[ -f /etc/init.d/${osInfo.sshServiceName} ] && rc-update add ${osInfo.sshServiceName} default 2>/dev/null || true`)
    cmds.push('[ -f /etc/init.d/dhcpcd ] && rc-update add dhcpcd default 2>/dev/null || true')
  }

  return cmds
}

// ==================== 脚本生成 ====================

function generateSetupScript(
  sshKey: string | undefined,
  rootPassword: string,
  users: string[],
  osInfo: OsInfo
): string {
  const escapedKey = escapeForShellDoubleQuote(sshKey || '')
  const escapedPassword = escapeForShellSingleQuote(rootPassword)
  const usersListForLoop = users.join(' ')
  const sshServiceName = osInfo.sshServiceName

  let restartSshCmd: string
  if (osInfo.initSystem === 'openrc') {
    restartSshCmd = `rc-service ${sshServiceName} restart 2>/dev/null || /etc/init.d/${sshServiceName} restart || /etc/init.d/${sshServiceName} start || true`
  } else {
    restartSshCmd = `systemctl restart ${sshServiceName} 2>/dev/null || service ${sshServiceName} restart || true`
  }

  return `#!/bin/sh
set -e

SSH_KEY="${escapedKey}"
ROOT_PASSWORD='${escapedPassword}'
USERS="${usersListForLoop}"

if echo "root:$ROOT_PASSWORD" | chpasswd >/dev/null 2>&1; then
  :
else
  echo -e "$ROOT_PASSWORD\\n$ROOT_PASSWORD" | passwd root >/dev/null 2>&1 || true
fi

passwd -u root >/dev/null 2>&1 || usermod -U root >/dev/null 2>&1 || true

mkdir -p /root/.ssh
chmod 700 /root/.ssh
if [ -n "$SSH_KEY" ]; then
  echo "$SSH_KEY" > /root/.ssh/authorized_keys
  chmod 600 /root/.ssh/authorized_keys
  chown root:root /root/.ssh /root/.ssh/authorized_keys
else
  chown root:root /root/.ssh
fi

for u in $USERS; do
  if [ "$u" = "root" ]; then continue; fi
  if id "$u" >/dev/null 2>&1; then
    HOMEDIR="/home/$u"
    if [ ! -d "$HOMEDIR" ]; then continue; fi
    mkdir -p "$HOMEDIR/.ssh"
    if [ -n "$SSH_KEY" ]; then
      echo "$SSH_KEY" > "$HOMEDIR/.ssh/authorized_keys"
      chmod 600 "$HOMEDIR/.ssh/authorized_keys"
    fi
    chown -R "$u" "$HOMEDIR/.ssh" 2>/dev/null || true
    chmod 700 "$HOMEDIR/.ssh"
    echo "$u:$ROOT_PASSWORD" | chpasswd >/dev/null 2>&1 || true
  fi
done

SED_BIN="sed"
SSH_CONFIG="/etc/ssh/sshd_config"

$SED_BIN -i 's/^PermitRootLogin/#PermitRootLogin/g' $SSH_CONFIG 2>/dev/null || true
$SED_BIN -i 's/^PasswordAuthentication/#PasswordAuthentication/g' $SSH_CONFIG 2>/dev/null || true
$SED_BIN -i 's/^PubkeyAuthentication/#PubkeyAuthentication/g' $SSH_CONFIG 2>/dev/null || true

if ! grep -q "^Include /etc/ssh/sshd_config.d" $SSH_CONFIG; then
    $SED_BIN -i "1i Include /etc/ssh/sshd_config.d/*.conf" $SSH_CONFIG 2>/dev/null || true
fi

echo "PermitRootLogin yes" >> $SSH_CONFIG
echo "PasswordAuthentication yes" >> $SSH_CONFIG
echo "PubkeyAuthentication yes" >> $SSH_CONFIG

${restartSshCmd}

exit 0
`
}

// ==================== bootcmd 生成 ====================

function getBootcmd(osInfo: OsInfo): string[] {
  const cmds: string[] = []

  if (osInfo.family === 'alpine') {
    // 动态获取 IPv4/v6 默认网关并给到默认公共回退 DNS，确立不同网段/纯 v6 下的不报错初始化
    cmds.push('GW4=$(ip -4 route show default 2>/dev/null | awk \'/default/ {print $3}\' | head -n 1); GW6=$(ip -6 route show default 2>/dev/null | awk \'/default/ {print $3}\' | head -n 1); if [ -n "$GW4" ]; then echo "nameserver $GW4" > /etc/resolv.conf; elif [ -n "$GW6" ]; then echo "nameserver $GW6" > /etc/resolv.conf; else echo -e "nameserver 8.8.8.8\\nnameserver 2001:4860:4860::8888" > /etc/resolv.conf; fi')
    cmds.push('rc-update add networking boot || true')
    cmds.push('rc-service networking start 2>/dev/null || true')
  } else {
    switch (osInfo.packageManager) {
      case 'apt':
        cmds.push('cloud-init-per once apt_update_early apt-get update || true')
        break
      case 'dnf':
        cmds.push('cloud-init-per once dnf_makecache dnf makecache || true')
        break
      case 'yum':
        cmds.push('cloud-init-per once yum_makecache yum makecache || true')
        break
      case 'zypper':
        cmds.push('cloud-init-per once zypper_refresh zypper --non-interactive refresh || true')
        break
    }
  }

  return cmds
}

// ==================== 网络配置生成 ====================

function getNetworkConfig(net: StaticNetworkConfig | undefined, shouldBlockSharedIpv6OnEth0: boolean): string {
  if (!net) {
    if (shouldBlockSharedIpv6OnEth0) {
      return `version: 1
config:
  - type: physical
    name: ${CONFIG.INTERFACE_NAME}
    subnets:
      - type: dhcp
`
    }
    return `version: 1
config:
  - type: physical
    name: ${CONFIG.INTERFACE_NAME}
    subnets:
      - type: dhcp
      - type: dhcp6
`
  }

  const subnets: string[] = []
  const dnsV4 = net.dns || CONFIG.DEFAULT_DNS
  subnets.push(`      - type: static
        address: ${net.ipAddress}
        gateway: ${net.gateway}
        dns_nameservers:
${dnsV4.map(d => `          - ${d}`).join('\n')}`)

  // eth0 上的 IPv6 子网配置（仅当 IPv6 地址和网关都绑定在 eth0 上时使用，
  // 即非双网卡 routed 架构的场景；双网卡时 IPv6 走 eth1）
  // 注意：当前双网卡架构中，此分支不再为 eth0 添加 IPv6 子网
  // IPv6 routed 配置已移至下方 eth1 块

  let config = `version: 1
config:
  - type: physical
    name: ${CONFIG.INTERFACE_NAME}
    subnets:
${subnets.join('\n')}
`

  // eth1: IPv6 Routed 配置（双网卡架构：eth0=IPv4 bridged, eth1=IPv6 routed）
  // 当存在 IPv6 配置时，生成 eth1 的 cloud-init 网络配置
  // 网关使用 fe80::1（Incus routed 模式的标准链路本地网关）
  if (net.ipv6Address) {
    const ipv6Addr = net.ipv6Address.includes('/') ? net.ipv6Address : `${net.ipv6Address}/128`
    const defaultDnsV6 = ['2606:4700:4700::1111', '2001:4860:4860::8888']
    const dnsV6 = net.ipv6Dns || defaultDnsV6
    config += `  - type: physical
    name: eth1
    subnets:
      - type: static
        address: ${ipv6Addr}
        gateway: fe80::1
        dns_nameservers:
${dnsV6.map(d => `          - ${d}`).join('\n')}
`
  }

  return config
}

// ==================== 主函数 ====================

export function generateContainerConfig(params: IncusConfigParams): IncusConfigResult {
  const { imageAlias, rootPassword, sshKey, network, extraShellCommands, networkMode } = params

  if (!imageAlias || !rootPassword) throw new Error('Missing params')
  if (sshKey && !isValidSshKey(sshKey)) throw new Error('Invalid SSH Key')

  const osInfo = detectOsInfo(imageAlias)
  const isAlpine = osInfo.family === 'alpine'
  const sshPort = CONFIG.SSH_PORT
  const commonUsers = osInfo.defaultUsers

  // 1. Users Yaml
  const usersYaml = commonUsers
    .map(u => {
      const lines = [
        `  - name: ${u}`,
        `    lock_passwd: false`,
        `    create_home: true`,
        `    shell: ${osInfo.defaultShell}`,
        `    sudo: ALL=(ALL) NOPASSWD:ALL`
      ]
      if (sshKey?.trim()) {
        lines.push(`    ssh_authorized_keys:`, `      - ${sshKey.trim()}`)
      }
      return lines.join('\n')
    })
    .join('\n')

  // 2. SSH Config
  const sshdDropInPath = '/etc/ssh/sshd_config.d/50-incus.conf'
  const sshdDropInContent = [
    `Port ${sshPort}`,
    'PermitRootLogin yes',
    'PasswordAuthentication yes',
    'PubkeyAuthentication yes'
  ].join('\n')

  // 3. Scripts
  const setupScript = generateSetupScript(sshKey, rootPassword, commonUsers, osInfo)
  const setupCmds = getSetupCommands(osInfo)

  // 4. Runcmd
  const userCustomCmds = extraShellCommands
    ? extraShellCommands.split('\n').map(cmd => cmd.trim()).filter(cmd => cmd.length > 0)
    : []

  const shouldBlockSharedIpv6OnEth0 = networkMode
    ? !['nat_ipv6_nat', 'ipv6_nat'].includes(networkMode)
    : Boolean(network?.ipv6Address)

  const routedIpv6GuardCmds = shouldBlockSharedIpv6OnEth0
    ? [
        // Routed IPv6 模式下，eth0 只承担 IPv4 NAT。
        // 某些容器镜像（尤其 Alpine + dhcpcd）在首启/重装后仍可能从 incusbr0 拿到 DHCPv6/RA，
        // 导致 guest 同时持有桥 NAT IPv6 与 eth1 独立 IPv6，出站源地址选择随机漂移。
        'mkdir -p /etc/sysctl.d || true',
        'printf "%s\\n%s\\n%s\\n" "net.ipv6.conf.eth0.disable_ipv6 = 1" "net.ipv6.conf.eth0.accept_ra = 0" "net.ipv6.conf.eth0.autoconf = 0" > /etc/sysctl.d/99-incudal-routed-ipv6.conf',
        'sysctl -p /etc/sysctl.d/99-incudal-routed-ipv6.conf >/dev/null 2>&1 || true',
        'ip -6 addr flush dev eth0 scope global >/dev/null 2>&1 || true',
        'ip -6 route del default dev eth0 >/dev/null 2>&1 || true',
        // Debian 12 在 routed IPv6 场景下偶发不会稳定保留 eth1 的默认 IPv6 路由，
        // 显式重设默认路由到 Incus routed 模式的标准网关 fe80::1，避免出现“有 IPv6 地址但无法出站”。
        'ip -6 route replace default via fe80::1 dev eth1 metric 100 >/dev/null 2>&1 || true'
      ]
    : []

  const runcmd = [
    'mkdir -p /etc/ssh/sshd_config.d || true',
    ...setupCmds,
    '/usr/local/bin/incus-setup.sh || true',
    ...routedIpv6GuardCmds,
    ...userCustomCmds
  ]

  // 5. Write Files
  const packages = getPackagesForOs(osInfo)
  const packagesYaml = packages.map(p => `  - ${p}`).join('\n')

  const writeFilesYaml = [
    `  - path: ${sshdDropInPath}`,
    `    owner: root:root`,
    `    permissions: '0644'`,
    `    content: |`,
    ...sshdDropInContent.split('\n').map(l => `      ${l}`),
    `  - path: /usr/local/bin/incus-setup.sh`,
    `    owner: root:root`,
    `    permissions: '0755'`,
    `    content: |`,
    ...setupScript.split('\n').map(l => `      ${l}`)
  ].join('\n')

  const runcmdYaml = runcmd.map(cmd => `  - ${JSON.stringify(cmd)}`).join('\n')
  const bootcmdList = getBootcmd(osInfo)
  const bootcmdSection = bootcmdList.length > 0 ? `bootcmd:\n${bootcmdList.map(cmd => `  - ${cmd}`).join('\n')}\n` : ''
  const yamlSafePassword = rootPassword.replace(/'/g, "''").replace(/\\/g, '\\\\')
  const sshPwauth = isAlpine ? 'false' : 'true'
  const packagesSection = packages.length > 0
    ? `packages:\n${packagesYaml}\n\n`
    : ''
  const chpasswdSection = isAlpine
    ? ''
    : `chpasswd:
  expire: false
  list: |
    root:${yamlSafePassword}

`

  // 6. Network Config
  const networkConfigYaml = getNetworkConfig(network, shouldBlockSharedIpv6OnEth0)

  // 7. Output
  const cloudConfigYaml = `#cloud-config
package_update: ${isAlpine ? 'false' : 'true'}
package_upgrade: false
timezone: Asia/Shanghai

ssh_pwauth: ${sshPwauth}
disable_root: false

${packagesSection}${chpasswdSection}users:
${usersYaml}

write_files:
${writeFilesYaml}

${bootcmdSection}runcmd:
${runcmdYaml}
`

  return {
    configPayload: {
      'user.user-data': cloudConfigYaml,
      'user.network-config': networkConfigYaml
    },
    metaData: {
      sshPort,
      rootPassword,
      osFamily: osInfo.family,
      imageAlias,
      instanceType: 'container',
      ipAddress: network?.ipAddress || 'dhcp'
    }
  }
}
