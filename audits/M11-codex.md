# M11 审计报告
## 结论摘要
套餐输入校验和归属检查整体较完整，但公开商城库存判断、宿主机配额释放存在高风险正确性缺陷。另发现未发布方案可被普通用户读取、内部错误泄露、公开接口 N+1 查询及前端请求竞态等问题。

## 发现清单
- [M11-01] P1 | 置信度 高 | server/src/routes/packages.ts:882
  - 问题:公开商城自行计算售罄状态时只检查 CPU、内存，遗漏磁盘容量、实例实际资源占用及系统盘池可用性，与统一售罄实现不一致。
  - 证据:`select: { id: true, cpuAllowanceMax: true, memoryMax: true, cpuUsed: true, memoryUsed: true }`；随后仅执行 `return cpuAvailable && memoryAvailable`。而 `server/src/db/packages.ts:1438` 的统一实现要求 `cpuAvailable >= minCpu && memoryAvailable >= minMemory && diskAvailable >= minDisk`，并在此前检查存储池。
  - 影响:磁盘不足或没有可用系统盘池的套餐仍会在公开商城显示“有货”，用户进入下单流程后才失败，造成错误售卖展示。
  - 修复建议:公开接口复用统一的批量售罄检查，避免维护第二套容量算法。

- [M11-02] P1 | 置信度 高 | server/src/routes/packages.ts:2458
  - 问题:配额释放接口不要求 `hostIds` 唯一，并逐宿主机独立提交增量，没有整体事务。
  - 证据:Schema 只有 `items/minItems/maxItems`，没有 `uniqueItems: true`；`for (const hostId of hostIds)` 内逐次调用 `await db.increaseHostQuota(hostId, cpuAdd, memoryAdd)`。该函数在 `server/src/db/packages.ts:1335` 对容量字段直接执行 `increment`。
  - 影响:重复 ID 会让同一宿主机被多次增加容量；中途失败则已处理宿主机不会回滚，用户重试可能再次增加容量，进而导致库存误判和资源超卖。
  - 修复建议:入口去重并拒绝重复 ID，将全部宿主机容量变更放入同一数据库事务。

- [M11-03] P2 | 置信度 高 | server/src/routes/packages.ts:2590
  - 问题:非套餐所有者可以通过不传 `activeOnly=true` 读取公开套餐的全部方案，包括未启用方案。
  - 证据:`const activeOnly = request.query.activeOnly === 'true'` 默认得到 `false`；普通用户只需通过 `canUserAccessPackage` 即可访问，随后执行 `db.getPlansByPackageId(packageId, { activeOnly })`。`server/src/db/package-plans.ts:31` 明确在 `activeOnly=false` 时不添加 `isActive` 条件。
  - 影响:任意登录用户可以枚举公开套餐尚未发布或已下架的方案、价格和资源配置，泄露运营信息。
  - 修复建议:仅所有者和管理员允许读取全部方案，其他访问者强制限定 `isActive=true`。

- [M11-04] P2 | 置信度 高 | server/src/routes/packages.ts:1824
  - 问题:套餐创建和更新将数据库层异常原文直接返回客户端。
  - 证据:创建路径执行 `const errorMessage = error instanceof Error ? error.message : String(error)`，随后 `send({ error: errorMessage, code: 'INVALID_PACKAGE_CONFIG' })`；更新路径在第 2093-2094 行采用相同处理。
  - 影响:Prisma、数据库约束、字段名称或服务端路径等内部实现细节可能暴露给套餐创建者，也会把内部故障错误包装成误导性的 400 响应。
  - 修复建议:服务端记录经过脱敏的完整异常，响应只返回稳定错误码和通用提示。

- [M11-05] P2 | 置信度 高 | server/src/routes/packages.ts:810
  - 问题:无分页的公开套餐接口对每个套餐分别查询方案和宿主机，形成明显的 `2N+1` 查询。
  - 证据:先执行一次 `prisma.package.findMany`，随后在 `Promise.all(packages.map(...))` 内分别调用 `packagePlan.findMany`（第 849 行）和 `host.findMany`（第 882 行）。
  - 影响:套餐数量增长后，每次匿名访问都会同时制造大量数据库查询；公开接口允许每分钟 60 次请求，可能显著放大数据库负载和响应延迟。
  - 修复建议:一次批量读取方案、宿主机及容量信息并按套餐分组，同时为公开列表增加合理分页或数量上限。

- [M11-06] P2 | 置信度 高 | client/src/views/MarketView.vue:397
  - 问题:商城数据加载没有请求序号或取消机制，并发请求的旧响应可以覆盖较新的来源状态。
  - 证据:`loadData` 直接根据当前 `packageSource.value` 发起请求，并在完成后无条件写入 `packages.value`、`regions.value`；`switchSource` 和路由监听均可再次调用该函数。
  - 影响:用户快速切换“官方直营/托管市场”或连续改变路由时，较慢的旧请求可能最后返回，导致来源标签、URL 与实际套餐列表不一致；旧请求失败还可能清空新请求已加载的数据。
  - 修复建议:为每次加载分配递增请求标识或使用 AbortController，只允许最新请求更新页面状态。

- [M11-07] P3 | 置信度 高 | client/src/views/PortalView.vue:38
  - 问题:门户套餐展示上方的主标题文案绕过 i18n，仅按是否为中文硬编码中英文。
  - 证据:`isChineseLocale ? '智能云计算' : 'Smart cloud computing'`、`isChineseLocale ? '连接' : 'Connect '`、`isChineseLocale ? '无限可能' : 'infinite possibilities'`。
  - 影响:除中文外的所有语言都会固定显示英文，文案也无法通过语言包统一维护或覆盖。
  - 修复建议:将三段文案迁入现有 i18n 语言包并通过翻译 key 获取。
