import { generateVmNicMacs, type VmNicMacs } from './vm-network-identifiers.js'

// ================= 类型定义 =================

interface StaticNetworkConfig {
  ipAddress: string
  gateway: string
  dns?: string[]
  ipv6Address?: string
  ipv6Gateway?: string
  ipv6Dns?: string[]
}

export interface IncusConfigParams {
  instanceName: string
  imageAlias: string
  rootPassword: string
  sshKey?: string
  network?: StaticNetworkConfig
  extraShellCommands?: string
  instanceIdSeed?: string
  networkMode?: 'nat' | 'nat_ipv6' | 'nat_ipv6_nat' | 'ipv6_only' | 'ipv6_nat'
}

export interface IncusConfigResult {
  configPayload: {
    'user.user-data': string
    'user.network-config': string
  }
}

type VmOsFamily = 'ubuntu' | 'debian' | 'rhel' | 'rhel8' | 'alpine' | 'linux'
type PackageManager = 'apt' | 'dnf' | 'yum' | 'apk'
type InitSystem = 'systemd' | 'openrc'

interface VmOsInfo {
  family: VmOsFamily
  packageManager: PackageManager
  initSystem: InitSystem
  sshServiceName: 'ssh' | 'sshd'
  defaultShell: string
  defaultUsers: string[]
}

// 核心修复：DNS 指向网桥 dnsmasq 网关（同 LXC），支持纯 IPv6 宿主机的 DNS64 转发分流
const DEFAULT_DNS_V4 = ['10.10.0.1']
const DEFAULT_DNS_V6 = ['2606:4700:4700::1111', '2001:4860:4860::8888']
const DEFAULT_IPV6_GATEWAY = 'fe80::1'
const SSHD_PRIMARY_DROPIN_PATH = '/etc/ssh/sshd_config.d/99-incudal-force.conf'
const SSHD_LEGACY_DROPIN_PATH = '/etc/ssh/sshd_config.d/00-incudal-auth.conf'

// ================= 工具函数 =================

function indentString(str: string, count: number): string {
  const indent = ' '.repeat(count)
  return str.split('\n').map(line => line ? indent + line : line).join('\n')
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

function escapeForYamlSingleQuote(str: string): string {
  return str.replace(/'/g, "''")
}

function isRhel8Series(alias: string): boolean {
  return /alma.*8|rocky.*8|oracle.*8|centos.*8|rhel.*8/i.test(alias)
}

function uniqueUsers(users: string[]): string[] {
  return [...new Set(users.filter(Boolean))]
}

function detectVmOsInfo(imageAlias: string): VmOsInfo {
  const alias = imageAlias.toLowerCase()

  if (alias.includes('ubuntu')) {
    return {
      family: 'ubuntu',
      packageManager: 'apt',
      initSystem: 'systemd',
      sshServiceName: 'ssh',
      defaultShell: '/bin/bash',
      defaultUsers: ['root', 'ubuntu']
    }
  }

  if (alias.includes('debian') || alias.includes('kali')) {
    return {
      family: 'debian',
      packageManager: 'apt',
      initSystem: 'systemd',
      sshServiceName: 'ssh',
      defaultShell: '/bin/bash',
      defaultUsers: ['root', 'debian']
    }
  }

  if (alias.includes('alpine')) {
    return {
      family: 'alpine',
      packageManager: 'apk',
      initSystem: 'openrc',
      sshServiceName: 'sshd',
      defaultShell: '/bin/ash',
      defaultUsers: ['root']
    }
  }

  if (alias.includes('alma') || alias.includes('rocky') || alias.includes('oracle') || alias.includes('centos') || alias.includes('rhel') || alias.includes('fedora')) {
    const detectedUser = alias.includes('alma')
      ? 'almalinux'
      : alias.includes('rocky')
        ? 'rocky'
        : alias.includes('oracle')
          ? 'opc'
          : alias.includes('centos')
            ? 'centos'
            : alias.includes('fedora')
              ? 'fedora'
              : 'cloud-user'

    return {
      family: isRhel8Series(alias) ? 'rhel8' : 'rhel',
      packageManager: isRhel8Series(alias) ? 'yum' : 'dnf',
      initSystem: 'systemd',
      sshServiceName: 'sshd',
      defaultShell: '/bin/bash',
      defaultUsers: uniqueUsers(['root', 'cloud-user', detectedUser])
    }
  }

  return {
    family: 'linux',
    packageManager: 'apt',
    initSystem: 'systemd',
    sshServiceName: 'sshd',
    defaultShell: '/bin/bash',
    defaultUsers: ['root']
  }
}

function normalizeIpv6Address(address: string): string {
  const trimmed = address.trim()
  return trimmed.includes('/') ? trimmed : `${trimmed}/128`
}

function getPackageInstallCommand(osInfo: VmOsInfo): string {
  switch (osInfo.packageManager) {
    case 'apt':
      return 'retry_cmd "DEBIAN_FRONTEND=noninteractive apt-get update" && retry_cmd "DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends qemu-guest-agent openssh-server curl ca-certificates"'
    case 'dnf':
      return 'retry_cmd "dnf install -y qemu-guest-agent openssh-server curl ca-certificates"'
    case 'yum':
      return 'retry_cmd "yum install -y qemu-guest-agent openssh-server curl ca-certificates"'
    case 'apk':
      return 'retry_cmd "apk update" && retry_cmd "apk add --no-cache qemu-guest-agent openssh-server openssh-keygen curl ca-certificates shadow" || retry_cmd "apk add --no-cache qemu-guest-agent openssh curl ca-certificates shadow"'
    default:
      return ':'
  }
}

function getCloudInitPackages(osInfo: VmOsInfo): string[] {
  switch (osInfo.packageManager) {
    case 'apt':
      return ['qemu-guest-agent', 'openssh-server', 'curl', 'ca-certificates']
    case 'dnf':
    case 'yum':
      return ['qemu-guest-agent', 'openssh-server', 'curl', 'ca-certificates']
    default:
      return []
  }
}

function getSshdDropInContent(osInfo: VmOsInfo): string {
  const lines = [
    'PermitRootLogin yes',
    'PasswordAuthentication yes',
    'PubkeyAuthentication yes',
    'ChallengeResponseAuthentication no'
  ]

  if (osInfo.family !== 'alpine') {
    lines.push('UsePAM yes')
  }

  return lines.join('\n')
}

function getNetworkMatchYaml(macAddress: string): string {
  return `      macaddress: "${macAddress.toLowerCase()}"`
}

function generateSetupScript(params: IncusConfigParams, osInfo: VmOsInfo): string {
  const escapedKey = escapeForShellDoubleQuote(params.sshKey || '')
  const escapedPassword = escapeForShellSingleQuote(params.rootPassword)
  const usersList = osInfo.defaultUsers.join(' ')
  const sshServiceName = osInfo.sshServiceName
  const packageInstallCommand = getPackageInstallCommand(osInfo)
  const sshdPrimaryDropInPath = SSHD_PRIMARY_DROPIN_PATH
  const sshdLegacyDropInPath = SSHD_LEGACY_DROPIN_PATH

  const extraCommands = params.extraShellCommands?.trim() || ': # No extra commands'
  const sshdDropInContent = getSshdDropInContent(osInfo)
  const hasRoutedIpv6 = Boolean(params.network?.ipv6Address)
  const escapedPrimaryIpv6 = params.network?.ipv6Address
    ? escapeForShellDoubleQuote(params.network.ipv6Address.trim().split('/')[0])
    : ''

  const serialConsoleCommands = osInfo.initSystem === 'openrc'
    ? `if [ -f /etc/inittab ] && ! grep -q '^ttyS0::respawn:/sbin/getty -L ttyS0 115200 vt100$' /etc/inittab 2>/dev/null; then
  echo 'ttyS0::respawn:/sbin/getty -L ttyS0 115200 vt100' >> /etc/inittab
fi
kill -HUP 1 2>/dev/null || true`
    : `systemctl enable serial-getty@ttyS0.service || true
systemctl restart serial-getty@ttyS0.service || true`

  const serviceEnableCommands = osInfo.initSystem === 'openrc'
    ? `[ -f /etc/init.d/${sshServiceName} ] && rc-update add ${sshServiceName} default 2>/dev/null || true
[ -f /etc/init.d/${sshServiceName} ] && rc-service ${sshServiceName} restart 2>/dev/null || /etc/init.d/${sshServiceName} restart 2>/dev/null || /etc/init.d/${sshServiceName} start 2>/dev/null || true
[ -f /etc/init.d/qemu-guest-agent ] && rc-update add qemu-guest-agent default 2>/dev/null || true
[ -f /etc/init.d/qemu-guest-agent ] && rc-service qemu-guest-agent restart 2>/dev/null || /etc/init.d/qemu-guest-agent restart 2>/dev/null || /etc/init.d/qemu-guest-agent start 2>/dev/null || true`
    : `systemctl daemon-reload || true
systemctl unmask ${sshServiceName} || true
systemctl enable ${sshServiceName} 2>/dev/null || true
systemctl restart ${sshServiceName} 2>/dev/null || true
systemctl enable qemu-guest-agent 2>/dev/null || true
systemctl restart qemu-guest-agent 2>/dev/null || true`

  return `#!/bin/sh
LOG_FILE="/var/log/incudal-vm-setup.log"
exec >>"$LOG_FILE" 2>&1
# 不启用 shell trace，避免 ROOT_PASSWORD/SSH_KEY 写入 guest 日志

SSH_KEY="${escapedKey}"
ROOT_PASSWORD='${escapedPassword}'
DEFAULT_USERS="${usersList}"
SSH_SERVICE="${sshServiceName}"

retry_cmd() {
  command="$1"
  attempt=0
  while [ "$attempt" -lt 20 ]; do
    if sh -c "$command"; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 3
  done
  return 1
}

ensure_dns_fallback() {
  if [ ! -s /etc/resolv.conf ] || ! grep -q '^nameserver ' /etc/resolv.conf 2>/dev/null; then
    {
      # DNS 指向网桥 dnsmasq，兼容纯 IPv6 宿主机
      printf '%s\\n' 'nameserver 10.10.0.1'
    } > /etc/resolv.conf
  fi
}

wait_for_network() {
  attempt=0
  while [ "$attempt" -lt 30 ]; do
    if ip route show default >/dev/null 2>&1; then
      return 0
    fi
    if ping -c 1 -W 1 1.1.1.1 >/dev/null 2>&1; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 2
  done
  return 1
}

user_home_dir() {
  user="$1"
  if [ "$user" = "root" ]; then
    echo "/root"
    return 0
  fi
  awk -F: -v target="$user" '$1 == target { print $6; exit }' /etc/passwd 2>/dev/null
}

set_password() {
  user="$1"
  id "$user" >/dev/null 2>&1 || return 0
  echo "$user:$ROOT_PASSWORD" | chpasswd >/dev/null 2>&1 || true
  passwd -u "$user" >/dev/null 2>&1 || usermod -U "$user" >/dev/null 2>&1 || true
}

set_authorized_key() {
  [ -n "$SSH_KEY" ] || return 0
  user="$1"
  id "$user" >/dev/null 2>&1 || return 0

  home_dir="$(user_home_dir "$user")"
  [ -n "$home_dir" ] || return 0

  mkdir -p "$home_dir/.ssh"
  chmod 700 "$home_dir/.ssh"
  printf '%s\\n' "$SSH_KEY" > "$home_dir/.ssh/authorized_keys"
  chmod 600 "$home_dir/.ssh/authorized_keys"

  if [ "$user" = "root" ]; then
    chown root:root "$home_dir/.ssh" "$home_dir/.ssh/authorized_keys" 2>/dev/null || true
  else
    chown -R "$user":"$user" "$home_dir/.ssh" 2>/dev/null || true
  fi
}

ensure_include_directive() {
  config_path="/etc/ssh/sshd_config"
  [ -f "$config_path" ] || return 0

  grep -q '^Include /etc/ssh/sshd_config.d/\\*\\.conf$' "$config_path" && return 0

  tmp_path="$config_path.incudal.tmp"
  {
    printf '%s\\n' 'Include /etc/ssh/sshd_config.d/*.conf'
    cat "$config_path"
  } > "$tmp_path" && mv "$tmp_path" "$config_path"
}

write_sshd_dropin() {
  mkdir -p /etc/ssh/sshd_config.d
  ensure_include_directive
  # 暴力清理各大云系统的防修改枷锁文件
  rm -f "${sshdLegacyDropInPath}" 2>/dev/null || true
  rm -f /etc/ssh/sshd_config.d/50-cloud-init.conf 2>/dev/null || true
  rm -f /etc/ssh/sshd_config.d/60-cloudimg-settings.conf 2>/dev/null || true
  # 以 99 结尾占据排序优势
  cat > "${sshdPrimaryDropInPath}" <<'EOF'
${sshdDropInContent}
EOF
}

update_sshd_main_config() {
  config_path="/etc/ssh/sshd_config"
  [ -f "$config_path" ] || return 0

  # 极其暴力的 SED：不管前面有没有注释，只要包含这两个关键句语意，统统连根铲除或覆盖
  sed -i -E 's/^[#[:space:]]*PermitRootLogin.*/PermitRootLogin yes/' "$config_path" 2>/dev/null || true
  sed -i -E 's/^[#[:space:]]*PasswordAuthentication.*/PasswordAuthentication yes/' "$config_path" 2>/dev/null || true
  sed -i -E 's/^[#[:space:]]*PubkeyAuthentication.*/PubkeyAuthentication yes/' "$config_path" 2>/dev/null || true
  sed -i -E 's/^[#[:space:]]*ChallengeResponseAuthentication.*/ChallengeResponseAuthentication no/' "$config_path" 2>/dev/null || true

  # 有些极端的镜像会直接把 PasswordAuthentication no 写好几遍，甚至藏在别的 drop-in 里。
  # 我们强行剔除其他零散文件里的阻碍
  if ls /etc/ssh/sshd_config.d/*.conf 1> /dev/null 2>&1; then
      for f in /etc/ssh/sshd_config.d/*.conf; do
          if [ "$f" != "${sshdPrimaryDropInPath}" ]; then
              sed -i -E 's/^[#[:space:]]*(PasswordAuthentication|PermitRootLogin)[[:space:]]+no/# &/' "$f" 2>/dev/null || true
          fi
      done
  fi

  grep -q '^PermitRootLogin ' "$config_path" || printf '\\n%s\\n' 'PermitRootLogin yes' >> "$config_path"
  grep -q '^PasswordAuthentication ' "$config_path" || printf '%s\\n' 'PasswordAuthentication yes' >> "$config_path"
  grep -q '^PubkeyAuthentication ' "$config_path" || printf '%s\\n' 'PubkeyAuthentication yes' >> "$config_path"
  grep -q '^ChallengeResponseAuthentication ' "$config_path" || printf '%s\\n' 'ChallengeResponseAuthentication no' >> "$config_path"

  # 无论如何暴力统一注入内置 internal-sftp 子系统来抵抗外部缺失包
  sed -i -E 's/^[#[:space:]]*Subsystem[[:space:]]+sftp.*/Subsystem sftp internal-sftp/' "$config_path" 2>/dev/null || true
  grep -q '^Subsystem sftp ' "$config_path" || printf '\\n%s\\n' 'Subsystem sftp internal-sftp' >> "$config_path"

  if [ "${osInfo.family}" != "alpine" ]; then
    sed -i -E 's/^[#[:space:]]*UsePAM.*/UsePAM yes/' "$config_path" 2>/dev/null || true
    grep -q '^UsePAM ' "$config_path" || printf '%s\\n' 'UsePAM yes' >> "$config_path"
  fi
}

disable_firewall() {
  if command -v ufw >/dev/null 2>&1; then
    ufw disable || true
  fi

  if command -v systemctl >/dev/null 2>&1; then
    systemctl disable --now firewalld 2>/dev/null || true
  fi
}

echo "Installing base packages..."
ensure_dns_fallback
wait_for_network || true
${packageInstallCommand} || true

command -v update-ca-certificates >/dev/null 2>&1 && update-ca-certificates || true
command -v ssh-keygen >/dev/null 2>&1 && ssh-keygen -A || true

echo "Configuring SSH access..."
disable_firewall
write_sshd_dropin
update_sshd_main_config

for user in $DEFAULT_USERS; do
  set_password "$user"
  set_authorized_key "$user"
done

if command -v restorecon >/dev/null 2>&1; then
  restorecon -RF /root/.ssh /etc/ssh /home 2>/dev/null || true
fi

echo "Enabling serial console..."
${serialConsoleCommands}

echo "Enabling guest services..."
${serviceEnableCommands}

echo "Installing persistent IPv4-only guard for primary NIC..."
cat > /usr/local/bin/incudal-ipv4-only.sh <<'EOF'
#!/bin/sh
set -e

PRIMARY_IFACE="$(ip -4 route show default 2>/dev/null | awk '/default/ {print $5; exit}')"
if [ -z "$PRIMARY_IFACE" ]; then
  PRIMARY_IFACE="$(ip route show default 2>/dev/null | awk '/default/ {for(i=1;i<=NF;i++) if($i=="dev") {print $(i+1); exit}}')"
fi
if [ -z "$PRIMARY_IFACE" ]; then
  PRIMARY_IFACE="eth0"
fi

mkdir -p /etc/sysctl.d
cat > /etc/sysctl.d/99-incudal-ipv4-only.conf <<CONF
net.ipv6.conf.\${PRIMARY_IFACE}.disable_ipv6 = 1
net.ipv6.conf.\${PRIMARY_IFACE}.accept_ra = 0
net.ipv6.conf.\${PRIMARY_IFACE}.autoconf = 0
CONF

sysctl -p /etc/sysctl.d/99-incudal-ipv4-only.conf >/dev/null 2>&1 || true
ip -6 addr flush dev "\${PRIMARY_IFACE}" scope global >/dev/null 2>&1 || true
ip -6 route del default dev "\${PRIMARY_IFACE}" >/dev/null 2>&1 || true
EOF
chmod +x /usr/local/bin/incudal-ipv4-only.sh
/usr/local/bin/incudal-ipv4-only.sh || true

if command -v systemctl >/dev/null 2>&1; then
  cat > /etc/systemd/system/incudal-ipv4-only.service <<'EOF'
[Unit]
Description=Incudal primary NIC IPv4-only guard
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/incudal-ipv4-only.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload || true
  systemctl enable incudal-ipv4-only.service || true
  systemctl start incudal-ipv4-only.service || true
elif [ -d /etc/local.d ]; then
  cat > /etc/local.d/incudal-ipv4-only.start <<'EOF'
#!/bin/sh
/usr/local/bin/incudal-ipv4-only.sh || true
EOF
  chmod +x /etc/local.d/incudal-ipv4-only.start
  rc-update add local default 2>/dev/null || true
  /etc/local.d/incudal-ipv4-only.start || true
fi

${hasRoutedIpv6 ? `echo "Installing persistent IPv6 default-route guard..."
cat > /usr/local/bin/incudal-ipv6-route-guard.sh <<'EOF'
#!/bin/sh
set -e

TARGET_IPV6="${escapedPrimaryIpv6}"
if [ -z "$TARGET_IPV6" ]; then
  exit 0
fi

IPV6_IFACE="$(ip -6 -o addr show scope global 2>/dev/null | awk -v target="$TARGET_IPV6" '$4 ~ ("^" target "/") {print $2; exit}')"
if [ -z "$IPV6_IFACE" ]; then
  exit 0
fi

if ! ip -6 route show default 2>/dev/null | grep -q "dev \${IPV6_IFACE}"; then
  ip -6 route replace default via fe80::1 dev "\${IPV6_IFACE}" metric 100 onlink >/dev/null 2>&1 || true
fi
EOF
chmod +x /usr/local/bin/incudal-ipv6-route-guard.sh
/usr/local/bin/incudal-ipv6-route-guard.sh || true

if command -v systemctl >/dev/null 2>&1; then
  cat > /etc/systemd/system/incudal-ipv6-route-guard.service <<'EOF'
[Unit]
Description=Incudal IPv6 routed default-route guard
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/incudal-ipv6-route-guard.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload || true
  systemctl enable incudal-ipv6-route-guard.service || true
  systemctl start incudal-ipv6-route-guard.service || true
elif [ -d /etc/local.d ]; then
  cat > /etc/local.d/incudal-ipv6-route-guard.start <<'EOF'
#!/bin/sh
/usr/local/bin/incudal-ipv6-route-guard.sh || true
EOF
  chmod +x /etc/local.d/incudal-ipv6-route-guard.start
  rc-update add local default 2>/dev/null || true
  /etc/local.d/incudal-ipv6-route-guard.start || true
fi
` : ''}

echo "Running user custom commands..."
${extraCommands}
`
}

// ================= cloud-init: user-data =================

function generateUserData(params: IncusConfigParams, osInfo: VmOsInfo): string {
  const setupScriptContent = generateSetupScript(params, osInfo)
  const yamlSafePassword = escapeForYamlSingleQuote(params.rootPassword)
  const packages = getCloudInitPackages(osInfo)
  const packagesSection = packages.length > 0
    ? `packages:\n${packages.map(pkg => `  - ${pkg}`).join('\n')}\n\n`
    : ''
  const sshKeySection = params.sshKey?.trim()
    ? `    ssh_authorized_keys:\n      - ${params.sshKey}\n`
    : ''

  return `#cloud-config
package_update: ${packages.length > 0 ? 'true' : 'false'}
package_upgrade: false
hostname: ${params.instanceName}
manage_etc_hosts: true

${packagesSection}users:
  - default
  - name: root
    lock_passwd: false
    shell: ${osInfo.defaultShell}
${sshKeySection}
chpasswd:
  expire: false
  list:
    - 'root:${yamlSafePassword}'

ssh_pwauth: true
disable_root: false

write_files:
  - path: /root/incudal-vm-setup.sh
    permissions: '0755'
    owner: root:root
    content: |
${indentString(setupScriptContent, 6)}

runcmd:
  - [ "/bin/sh", "-c", "/root/incudal-vm-setup.sh" ]
`
}

// ================= cloud-init: network-config =================

function generateDhcpNetworkConfig(nicMacs: VmNicMacs): string {
  return `version: 2
ethernets:
  incus_eth0:
    match:
${getNetworkMatchYaml(nicMacs.eth0)}
    dhcp4: true
    dhcp6: false
    accept-ra: false
    link-local: [ ipv4 ]
`
}

function generateNetworkConfig(net: StaticNetworkConfig | undefined, nicMacs: VmNicMacs): string {
  if (!net?.ipAddress || !net.gateway) {
    return generateDhcpNetworkConfig(nicMacs)
  }

  const dnsV4 = net.dns && net.dns.length > 0 ? net.dns : DEFAULT_DNS_V4
  const dnsV6 = net.ipv6Dns && net.ipv6Dns.length > 0 ? net.ipv6Dns : DEFAULT_DNS_V6

  const ipv4Section = `  incus_eth0:
    match:
${getNetworkMatchYaml(nicMacs.eth0)}
    dhcp4: false
    dhcp6: false
    accept-ra: false
    link-local: [ ipv4 ]
    addresses:
      - ${net.ipAddress}
    gateway4: ${net.gateway}
    nameservers:
      addresses:
${dnsV4.map(dns => `        - ${dns}`).join('\n')}`

  if (!net.ipv6Address) {
    return `version: 2
ethernets:
${ipv4Section}
`
  }

  const ipv6Section = `  incus_eth1:
    match:
${getNetworkMatchYaml(nicMacs.eth1)}
    dhcp4: false
    dhcp6: false
    accept-ra: false
    addresses:
      - ${normalizeIpv6Address(net.ipv6Address)}
    routes:
      - to: ::/0
        via: ${DEFAULT_IPV6_GATEWAY}
        on-link: true
    nameservers:
      addresses:
${dnsV6.map(dns => `        - ${dns}`).join('\n')}`

  return `version: 2
ethernets:
${ipv4Section}
${ipv6Section}
`
}

// ================= 主入口 =================

export function generateVmConfig(params: IncusConfigParams): IncusConfigResult {
  const osInfo = detectVmOsInfo(params.imageAlias)
  const nicMacs = generateVmNicMacs(params.instanceIdSeed || params.instanceName)

  return {
    configPayload: {
      'user.user-data': generateUserData(params, osInfo),
      'user.network-config': generateNetworkConfig(params.network, nicMacs)
    }
  }
}
