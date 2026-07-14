import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const hostInstallScript = readFileSync(resolve(__dirname, '../templates/install.sh'), 'utf8')
const caddyInstallScript = readFileSync(resolve(__dirname, '../templates/caddy.sh'), 'utf8')
const hostRoutes = readFileSync(resolve(__dirname, '../src/routes/hosts.ts'), 'utf8')
const zhCnLocale = readFileSync(resolve(__dirname, '../../client/src/locales/zh-CN.ts'), 'utf8')
const zhTwLocale = readFileSync(resolve(__dirname, '../../client/src/locales/zh-TW.ts'), 'utf8')
const enLocale = readFileSync(resolve(__dirname, '../../client/src/locales/en.ts'), 'utf8')
const installPanel = readFileSync(resolve(__dirname, '../../scripts/install-panel.sh'), 'utf8')
const systemctlWrapper = readFileSync(resolve(__dirname, '../../deploy/incudal-systemctl-wrapper.sh.example'), 'utf8')

assert.ok(
  installPanel.includes('install_verified_root_helpers_from_archive') &&
    installPanel.includes('install -o root -g root -m 0755 "$tmp" /usr/local/libexec/incudal/incudal-online-task') &&
    installPanel.includes('chown "root:${RUN_USER}" "$ENV_FILE"') &&
    installPanel.includes('chmod 640 "$ENV_FILE"'),
  'panel installer must install the fixed OTA entry from the verified archive and keep root unit env service-read-only'
)
assert.ok(
  systemctlWrapper.includes('[[ "$#" -ne 3 || "$1" != "start" || "$2" != "--no-block" ]]') &&
    systemctlWrapper.includes('^incudal-online-(update|rollback)@[1-9][0-9]*\\.service$') &&
    systemctlWrapper.includes('exec /usr/bin/systemctl start --no-block "$UNIT_NAME"'),
  'sudo systemctl wrapper must reject extra arguments and non-OTA unit names'
)

assert.ok(
  hostInstallScript.includes('明确支持 Debian 12/13') &&
    hostInstallScript.includes('Debian 11 可兼容安装，但推荐使用 Debian 12/13') &&
    hostInstallScript.includes('if [[ "$deb_major" -lt 11 ]]') &&
    hostInstallScript.includes('if [[ "$deb_major" -eq 11 ]]'),
  'host install script must explicitly support Debian 12/13 while keeping Debian 11 as best-effort compatibility'
)

assert.ok(
  hostInstallScript.includes('if [[ -f /etc/apt/sources.list.d/debian.sources ]]') &&
    hostInstallScript.includes('sed -i \'s/Components: main$/Components: main contrib/\'') &&
    hostInstallScript.includes('Debian 12+'),
  'host install script must keep Debian 12+ DEB822 apt-source handling for ZFS contrib packages'
)

assert.ok(
  hostInstallScript.includes('normalize_agent_interval()') &&
    hostInstallScript.includes('local value="${1:-60}"') &&
    hostInstallScript.includes('value >= 30 && value <= 3600') &&
    hostInstallScript.includes('Agent 上报间隔秒数 [默认 60，范围 30-3600]'),
  'host install script must keep Agent heartbeat interval at a conservative 60s default and 30s minimum'
)

assert.ok(
  hostInstallScript.includes('cert_file=$(mktemp /tmp/incudal-panel-cert.XXXXXX.crt)') &&
    hostInstallScript.includes('curl -sSf "$cert_url" -o "$cert_file"') &&
    hostInstallScript.includes('面板证书已存在，更新为当前证书') &&
    hostInstallScript.includes('incus config trust remove panel') &&
    hostInstallScript.includes('incus config trust add-certificate "$cert_file" --name panel') &&
    !hostInstallScript.includes('面板证书已存在，跳过导入'),
  'host install script must refresh the panel trust certificate instead of skipping stale panel entries'
)

assert.ok(
  caddyInstallScript.includes('auto_https disable_redirects') &&
    caddyInstallScript.indexOf('auto_https disable_redirects') > caddyInstallScript.indexOf('admin localhost:2019') &&
    caddyInstallScript.indexOf('auto_https disable_redirects') < caddyInstallScript.indexOf(':${CADDY_PORT} {'),
  'Caddy install script must disable automatic HTTP to HTTPS redirects so it does not bind port 80 on shared hosts'
)

assert.ok(
  hostInstallScript.includes('独立 IPv4') &&
    hostInstallScript.includes('独立 IPv4 + 独立 IPv6') &&
    hostInstallScript.includes('新节点、新套餐和新实例不再以 IPv6 NAT 作为目标能力。') &&
    hostInstallScript.includes('ipv6_block="ipv6.address: none"') &&
    !hostInstallScript.includes('${GREEN}IPv4 NAT + IPv6 NAT${NC}') &&
    !hostInstallScript.includes('${GREEN}IPv6 NAT${NC}') &&
    !hostInstallScript.includes('网桥 NAT 双通道模式') &&
    !hostInstallScript.includes('Bridge: Auto+NAT'),
  'host install script must document dedicated IPv4/IPv6 targets and stop presenting IPv6 NAT as a new node capability'
)

assert.ok(
  hostRoutes.includes('function getPanelCertificatePaths') &&
    hostRoutes.includes("appDir.endsWith('/current') ? dirname(appDir) : null") &&
    hostRoutes.includes("join(installDir, 'server/certs/client.crt')") &&
    hostRoutes.includes("join(installDir, 'server/certs/client.key')") &&
    hostRoutes.includes('existsSync(stableCertPath)') &&
    hostRoutes.includes('existsSync(stableKeyPath)'),
  'host routes must prefer stable install-level panel client certificate paths over release-local paths'
)

assert.ok(
  zhCnLocale.includes('目前支持 Ubuntu 22.04+、Debian 12/13；Debian 11 可兼容安装但建议升级。') &&
    zhTwLocale.includes('目前支援 Ubuntu 22.04+、Debian 12/13；Debian 11 可相容安裝但建議升級。') &&
    enLocale.includes('Currently supports Ubuntu 22.04+ and Debian 12/13. Debian 11 is best-effort compatible but should be upgraded.'),
  'host create page copy must explicitly show Debian 12/13 support in all enabled locales'
)

for (const staleCopy of [
  '目前仅支持 Ubuntu 22.04+ 和 Debian 11+ 系统。',
  '目前僅支援 Ubuntu 22.04+ 和 Debian 11+ 系統。',
  'Currently supports Ubuntu 22.04+ and Debian 11+ only.'
]) {
  assert.ok(
    !zhCnLocale.includes(staleCopy) && !zhTwLocale.includes(staleCopy) && !enLocale.includes(staleCopy),
    `host create page must not keep stale Debian support copy: ${staleCopy}`
  )
}

// ==================== ZFS 安装 ====================
//
// 背景：用户反馈「装宿主机节点时 ZFS 安装报错，得自己手动装」。根因是拿不到当前内核的精确
// 头文件时，脚本回退去装 linux-headers-amd64 —— 那是个 meta 包，拉的是 Debian 最新 stock
// 内核的头文件，不是当前运行内核的。DKMS 于是把模块编译进另一个内核的目录，modprobe 必然失败。
// 厂商内核（cloud/vendor kernel）的 VPS 上这条「兜底」等于保证失败。

assert.ok(
  !hostInstallScript.includes('generic_headers="linux-headers-amd64"') &&
    !hostInstallScript.includes('generic_headers="linux-headers-arm64"') &&
    !hostInstallScript.includes('正尝试拉取架构级通用头文件'),
  'ZFS DKMS must never fall back to architecture-generic kernel headers: they belong to a different kernel than the running one, so the built module can never be loaded'
)
assert.ok(
  hostInstallScript.includes('apt-get install -y -qq "linux-headers-${running_kernel}"') &&
    hostInstallScript.includes('return 2'),
  'ZFS DKMS must build against the running kernel headers only, and signal a distinct code when they are unavailable'
)

// 只装 zfsutils-linux（用户态工具）并不会触发 DKMS 编译 —— zfs-dkms 才是编译内核模块的包。
// 此前完全依赖 Recommends 隐式带出它，而预编译路径又特意用 --no-install-recommends 避开它。
assert.ok(
  hostInstallScript.includes('apt-get install -y -qq zfs-dkms zfsutils-linux'),
  'ZFS DKMS must install zfs-dkms explicitly instead of relying on Recommends of zfsutils-linux'
)

// 成功判定必须是实证：模块确实落在当前运行内核目录下且真的能加载。只看 apt 退出码会把
// 「装了工具但没有内核模块」误判为成功。
assert.ok(
  hostInstallScript.includes('find "/lib/modules/${running_kernel}" -name \'zfs.ko*\'') &&
    hostInstallScript.includes('modprobe zfs'),
  'ZFS DKMS success must be proven by the module existing for the running kernel and actually loading'
)

// purge zfs-dkms 会触发 DKMS 卸载钩子，把刚编译好的内核模块一起删掉 —— 清理编译工具链时
// 必须把它排除在外，否则「编译成功」之后 ZFS 当场失效。
assert.ok(
  hostInstallScript.includes('zfs-dkms|zfsutils-linux|zfs-zed) continue'),
  'the post-build cleanup must never purge zfs-dkms/zfsutils-linux: purging zfs-dkms removes the module it just built'
)

// 锁内核必须锁「当前正在运行」的那个 —— 取 dpkg 列表里第一个 linux-image 会在多内核机器上
// 锁错版本，重启后进入没有 ZFS 模块的内核，存储池直接不可用。
assert.ok(
  hostInstallScript.includes('kernel_pkg="linux-image-$(uname -r)"') &&
    !hostInstallScript.includes("awk '/^ii.*linux-image-[0-9]/ {print $2}' | head -n1"),
  'the ZFS kernel hold must pin the running kernel, not the first linux-image found in dpkg'
)

// 预编译模块是 insmod 进内核的 ring-0 代码，上游仓库不在我们控制之下：哈希必须固定在本脚本里
// （fail-closed，清单外的内核一律跳过），绝不能取上游同一个 release 里的校验和 —— 能换 tar 包的
// 人同样能换校验和文件。
assert.ok(
  hostInstallScript.includes('zfs_prebuilt_sha256()') &&
    hostInstallScript.includes('verify_sha256 "$tmp_tar" "$expected_sha"') &&
    hostInstallScript.includes('if ! expected_sha=$(zfs_prebuilt_sha256 "$kernel_ver"); then'),
  'prebuilt ZFS kernel modules must be pinned to SHA-256 hashes baked into this script, and unknown kernels must be skipped (fail-closed)'
)
assert.ok(
  !hostInstallScript.includes('${ZFS_PREBUILT_URL}/zfs-modules-${kernel_ver}.tar.gz.sha256'),
  'the prebuilt module checksum must never be fetched from the same upstream release as the artifact itself'
)

// 换内核会改客户生产机的引导配置：容器型虚拟化换了没用，非交互环境不得擅自动手。
assert.ok(
  hostInstallScript.includes('systemd-detect-virt --container') &&
    hostInstallScript.includes('if [[ ! -t 0 ]]; then') &&
    hostInstallScript.includes('offer_kernel_switch_for_zfs'),
  'the kernel switch must be skipped on container virtualization and must never run unattended'
)

// ZFS 装不上不是安装失败 —— 面板用 dir 存储池照样能跑，不能因此中断整个宿主机安装。
assert.ok(
  !hostInstallScript.includes('warn "已跳过 ZFS 安装，返回主菜单"'),
  'a failed ZFS setup must degrade to the dir storage pool, not abort the host installation'
)

console.log('host install script guard tests passed')
