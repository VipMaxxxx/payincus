import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const hostInstallScript = readFileSync(resolve(__dirname, '../templates/install.sh'), 'utf8')
const hostRoutes = readFileSync(resolve(__dirname, '../src/routes/hosts.ts'), 'utf8')
const zhCnLocale = readFileSync(resolve(__dirname, '../../client/src/locales/zh-CN.ts'), 'utf8')
const zhTwLocale = readFileSync(resolve(__dirname, '../../client/src/locales/zh-TW.ts'), 'utf8')
const enLocale = readFileSync(resolve(__dirname, '../../client/src/locales/en.ts'), 'utf8')

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

console.log('host install script guard tests passed')
