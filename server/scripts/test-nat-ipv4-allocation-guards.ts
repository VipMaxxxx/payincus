import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '../..')
const read = (p: string) => readFileSync(resolve(repoRoot, p), 'utf8')

const ipAddressesDb = read('server/src/db/ip-addresses.ts')
const schema = read('server/prisma/schema.prisma')
const migration = read('server/prisma/migrations/20260714120000_add_nat_ipv4_reservations/migration.sql')
const instancesRoute = read('server/src/routes/instances.ts')
const hostsRoute = read('server/src/routes/hosts.ts')
const adminBillingRoute = read('server/src/routes/admin-billing.ts')
const taskWorker = read('server/src/workers/instanceTaskWorker.ts')
const lxcProxy = read('server/src/lib/proxy/LxcProxyStrategy.ts')

// ==================== NAT 内网 IPv4 分配竞态 ====================
//
// 原来的分配散落在 7 处：随机取一个 IP → 查重 → 只留在内存里 → 等实例交付完成（数分钟，克隆更久）
// 才写回 instance.ipv4 并建 ip_addresses 记录。这段窗口里，已分配的 IP 对查重的两处
// （ip_addresses 表、instance.ipv4）都是隐形的 —— 同一宿主机上并发创建的实例会拿到同一个内网 IP，
// 两个容器同 IP，端口转发随即打到错误的容器上。地址池只有 766 个，实例越多撞得越狠。

assert.ok(
  ipAddressesDb.includes('export async function allocateAndReserveNatIpv4'),
  'NAT internal IPv4 allocation must live in one place'
)

// 分配必须在「每宿主机一把」的事务级 advisory lock 内，并且预留必须在同一把锁内落库 ——
// 只要预留晚于锁释放，窗口就依然存在。
const allocator = ipAddressesDb.slice(ipAddressesDb.indexOf('export async function allocateAndReserveNatIpv4'))
const lockIndex = allocator.indexOf('advisoryTransactionLockString')
const reserveIndex = allocator.indexOf('tx.natIpv4Reservation.create')
assert.notEqual(lockIndex, -1, 'the allocator must take a per-host advisory lock')
assert.notEqual(reserveIndex, -1, 'the allocator must persist the reservation')
assert.ok(
  lockIndex < reserveIndex,
  'the reservation must be written while the per-host lock is still held, otherwise the race window remains'
)
assert.ok(
  allocator.includes('`nat-ipv4:host:${hostId}`'),
  'the allocation lock must be scoped per host: internal IPs only need to be unique within one host'
)

// 已分配但尚未落地的地址必须计入「已占用」，否则预留形同虚设。
assert.ok(
  allocator.includes('tx.natIpv4Reservation.findMany') &&
    allocator.includes('for (const row of reserved) used.add(row.address)'),
  'active reservations must be counted as used when picking a free address'
)

// 池子只有 766 个地址。「随机取一个再查重、最多试 N 次」在池子变满后会退化成分配失败（生日问题），
// 因此必须一次性算出空闲集合再挑。
assert.ok(
  allocator.includes('listNatIpv4Pool().filter(address => !used.has(address))'),
  'allocation must pick from the computed free set, not retry random draws against a shrinking pool'
)

// 预留表必须有 (host_id, address) 唯一约束：这是并发重复分配的数据库级兜底。
assert.ok(
  schema.includes('model NatIpv4Reservation') &&
    schema.includes('@@unique([hostId, address])') &&
    migration.includes('CREATE UNIQUE INDEX "nat_ipv4_reservations_host_id_address_key"'),
  'the reservation table must enforce (host_id, address) uniqueness at the database level'
)

// 预留必须能自然过期，否则交付失败的地址会被永久占住。
assert.ok(
  allocator.includes('tx.natIpv4Reservation.deleteMany({ where: { expiresAt: { lt: now } } })') &&
    ipAddressesDb.includes('NAT_IPV4_RESERVATION_TTL_MS'),
  'reservations must expire so that addresses from failed provisioning are not leaked forever'
)

// 所有分配点都必须走中心化分配器 —— 只要还剩一处「裸的随机 + 查重」，那条路径依旧会撞车。
for (const [name, source] of [
  ['routes/instances.ts', instancesRoute],
  ['routes/hosts.ts', hostsRoute],
  ['routes/admin-billing.ts', adminBillingRoute],
  ['workers/instanceTaskWorker.ts', taskWorker]
] as const) {
  assert.ok(
    !source.includes('generateRandomIPv4()'),
    `${name} must not allocate NAT IPv4 by itself: use db.allocateAndReserveNatIpv4 so the address is reserved under the per-host lock`
  )
  assert.ok(
    !source.includes('isIpAddressExistsOnHost'),
    `${name} must not run its own uniqueness check: the check-then-use gap is exactly the race being fixed`
  )
  assert.ok(
    source.includes('allocateAndReserveNatIpv4'),
    `${name} must allocate through the centralized allocator`
  )
}

// ==================== LXC 端口转发内存 ====================
//
// Incus 的 proxy device 默认给每个端口映射 fork 一个常驻 forkproxy 进程（~10-30 MB RSS）。
// nat=true 改走内核 nftables DNAT：零进程。但 nat=true 要求 listen 是宿主机上的一个具体地址 ——
// 0.0.0.0 / [::] 这类通配监听会被 Incus 直接拒绝，无脑加 nat 会让端口映射创建失败。

assert.ok(
  lxcProxy.includes("deviceConfig.nat = 'true'") &&
    lxcProxy.includes('isConcreteHostIpv4'),
  'LXC IPv4 NAT port mappings must use kernel NAT instead of a per-mapping forkproxy process'
)
assert.ok(
  lxcProxy.includes("return Boolean(address) && address !== '0.0.0.0'"),
  'nat=true must only be set when the listen address is a concrete host IPv4: wildcard listens are rejected by Incus'
)
assert.ok(
  lxcProxy.includes("IPV4_NAT_NETWORK_MODES.includes(networkMode) && isConcreteHostIpv4(_hostNatIp)"),
  'nat=true must be gated on both an IPv4 NAT network mode and a concrete host IPv4'
)
// nat_ipv6_nat 原本用单个 [::] 设备做双栈监听；[::] 开不了 NAT，必须拆成两个设备
// （IPv4 走内核 NAT，IPv6 仍走 forkproxy），否则这个模式下端口映射会创建失败。
assert.ok(
  lxcProxy.includes("nameSuffix: '-v6'"),
  'nat_ipv6_nat must split into separate IPv4 (kernel NAT) and IPv6 (forkproxy) devices, because a [::] wildcard listen cannot use nat=true'
)

// 存量映射的设备配置不会自己变，必须有一条把它们转成内核 NAT 的运维通道，
// 否则改动只对新建映射生效，宿主机上已有的 forkproxy 进程一个都省不掉。
assert.ok(
  hostsRoute.includes("'/:id/ops/optimize-port-mappings'") &&
    hostsRoute.includes("device.nat === 'true'") &&
    hostsRoute.includes("{ ...device, nat: 'true' }"),
  'there must be an ops action that converts pre-existing proxy devices to kernel NAT'
)
assert.ok(
  hostsRoute.includes("if (!expectedPrefixes.some(prefix => listen.startsWith(prefix)))"),
  'the conversion must skip devices whose listen address is not a concrete host IPv4, instead of breaking a working mapping'
)

console.log('nat ipv4 allocation & lxc proxy guard tests passed')
