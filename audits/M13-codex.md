# M13 审计报告
## 结论摘要
网络/IP/流量模块存在多处高风险边界缺陷，整体健康度偏低。最严重问题是双通道流量采集可回退快照并重复计量，以及批量端口映射可绕过端口范围和配额限制；IPv6 子网重叠、重置周期串账和租户可触发的内网 TLS 外呼也需要优先处理。

## 发现清单
- [M13-01] P1 | 置信度 高 | server/src/services/agent-instance-report.ts:230
  - 问题:Agent 上报与主动 Incus 采集共用同一快照，但均无采样版本判断；较旧上报会将快照回退，造成后续流量重复计量。
  - 证据:Agent 路径先执行 `calculateIncrement(item.rxBytes!, latestSnapshot.rxRaw)`，随后无条件写入 `rxRaw: item.rxBytes!`；主动采集路径在 `server/src/services/instance-traffic-collector.ts:73-115` 采取相同模式。例如快照从 1000 被迟到上报回退到 900，下一次采到 1100 时会再次计入 200。
  - 影响:实例和用户月流量可能被重复累计，导致提前预警、限速及计费争议。
  - 修复建议:为快照保存并原子校验采样时间/序号，拒绝迟到样本回退基线，并统一单一权威采集源。

- [M13-02] P1 | 置信度 高 | server/src/routes/instances.ts:4721
  - 问题:批量端口映射的配额按 `privatePortStart/privatePortEnd` 计算，但提供 `portMappings` 时直接采用任意长度数组，并绕过宿主 NAT 端口范围校验。
  - 证据:配额使用 `privatePortCount` 和 `quotaNeeded`；`server/src/routes/instances.ts:4749-4751` 直接执行 `finalMappings = portMappings`，而 NAT 范围校验仅位于后续 `else if` 分支；请求 schema 的 `portMappings` 也没有 `maxItems`。
  - 影响:租户可声明一个端口的范围，却提交大量任意公网端口映射，绕过套餐配额并暴露宿主保留端口。
  - 修复建议:统一校验最终映射数组的数量、唯一性、内外端口范围及与声明区间的对应关系，并按最终创建数量计算配额。

- [M13-03] P1 | 置信度 高 | server/src/routes/ip-addresses.ts:620
  - 问题:自定义 IPv6 CIDR 只检查是否包含在宿主网段及字符串是否完全重复，不检查与已分配子网是否重叠，也不限制为允许的 `/112`、`/120`、`/124`。
  - 证据:路由仅调用 `isIpv6SubnetWithinSubnet()` 和 `isIpv6SubnetExists(cidr)`；后者在 `server/src/db/ipv6-subnets.ts:74-77` 只是 `findUnique({ where: { cidr } })`。因此宿主 `/64`、已有 `/112` 的子集或同一网段的非规范写法都可能再次分配。
  - 影响:不同实例可能获得相互重叠的路由，产生流量串扰、路由劫持或大范围 IPv6 不可达。
  - 修复建议:规范化 CIDR，并在同一宿主下以起止地址检查任何区间重叠，同时强制允许的前缀集合。

- [M13-04] P1 | 置信度 高 | server/src/db/traffic.ts:600
  - 问题:月流量重置只清零累计值，不同步刷新原始计数器快照，导致下一次采样把重置前后的整个采样窗口计入新周期。
  - 证据:`resetInstanceMonthlyTraffic()` 仅设置 `monthlyTrafficUsed: 0n`；采集器在 `server/src/services/instance-traffic-collector.ts:69-85` 继续使用重置前的 `trafficSnapshot` 计算增量。付费重置路径 `server/src/routes/traffic.ts:451-460` 同样只清零用量，且未持有采集器使用的 `traffic:instance:*` 分布式锁。
  - 影响:用户刚完成自动或付费重置后，会立即重新出现一段重置前流量；并发付费重置时误计窗口可能更大。
  - 修复建议:在同一实例采集锁内先补采或重建当前基线，再原子清零周期用量。

- [M13-05] P1 | 置信度 高 | server/src/lib/caddy-client.ts:159
  - 问题:新增 Caddy 路由时把任意 POST 失败都当成服务器不存在，并尝试用仅含当前路由的配置 PUT 整个 `sites` 服务器。
  - 证据:`catch (postError)` 未判断 404，随后构造 `serverConfig = { listen, routes: [route] }` 并执行 `PUT /config/apps/http/servers/sites`。
  - 影响:短暂网络错误、认证异常或其他 POST 故障后，若 PUT 成功，可能覆盖该宿主全部已有反代路由，造成所有站点中断。
  - 修复建议:仅在明确的“不存在”响应下创建服务器，并使用条件写入或读取合并，禁止盲目全量覆盖。

- [M13-06] P1 | 置信度 高 | server/src/routes/proxy-sites.ts:953
  - 问题:证书查询接口直接连接站点域名的 443 端口，未走 `outbound-security`，也未在连接时重新限制解析结果为该宿主公网地址。
  - 证据:代码直接调用 `tls.connect({ host: site.domain, port: 443 })`；站点激活后的 DNS 可被租户修改为回环、私网或云元数据地址，证书查询路径不会重新执行第 395-435 行的 DNS 匹配校验。
  - 影响:已认证租户可利用 DNS 重绑定让后端探测内网 443 服务，形成 SSRF/内网端口探测能力。
  - 修复建议:连接前通过统一出站安全组件解析并锁定允许地址，禁止私网/回环/链路本地目标并防止 DNS 重绑定。

- [M13-07] P1 | 置信度 高 | server/src/lib/caddy-client.ts:39
  - 问题:Caddy 管理请求携带 Basic Auth，但 TLS 明确关闭证书校验。
  - 证据:构造函数生成 `this.authHeader = 'Basic ' + ...`，同时 Agent 配置 `rejectUnauthorized: false`，随后在第 66-74 行向该连接发送认证头。
  - 影响:宿主与后端之间链路若被劫持，攻击者可窃取 Caddy 管理凭证并篡改全部反代配置。
  - 修复建议:使用受信 CA、证书指纹固定或双向 TLS，禁止对携带管理凭证的连接关闭证书验证。

- [M13-08] P2 | 置信度 高 | server/src/services/traffic-scheduler.ts:163
  - 问题:流量通知在发送前永久占领本月通知状态，而发送服务会吞掉最终失败，之后不再补发。
  - 证据:调度器先调用 `markUserTrafficWarningIfNeeded()`，再发送通知；`sendTrafficWarningNotification()` 在 `server/src/services/traffic-notifier.ts:151-158` 只记录失败并捕获异常，不把失败反馈给调度器。
  - 影响:Webhook 临时故障超过三次重试后，用户整个月都可能收不到流量预警或限速通知。
  - 修复建议:采用带状态和租约的通知 outbox，仅在成功后完成 claim，失败任务进入可重试队列。

- [M13-09] P2 | 置信度 高 | server/src/lib/caddy-client.ts:37
  - 问题:每个 CaddyClient 都创建独立 Undici `Agent`，但类中没有关闭 Agent 的方法，调用端也未释放。
  - 证据:构造函数执行 `this.agent = new Agent(...)`；类仅提供请求和站点操作方法，到文件结束没有 `close()`/`destroy()`，而代理站点路由会反复创建新客户端。
  - 影响:频繁站点操作会积累连接池、套接字和相关定时资源，长期运行可能增加文件描述符和内存占用。
  - 修复建议:复用按宿主缓存的 Agent，或为客户端实现明确的生命周期并在 `finally` 中关闭。

- [M13-10] P2 | 置信度 高 | server/src/routes/proxy-sites.ts:484
  - 问题:Caddy 上游原始错误被持久化并直接返回给普通用户。
  - 证据:激活失败返回 ``error: `激活失败: ${errorMessage}` ``，更新失败在第 793-796 行同样返回原始消息；`CaddyClient` 在 `server/src/lib/caddy-client.ts:77-80` 会把 Caddy 响应正文拼入异常。
  - 影响:用户可能看到 Caddy 内部路径、配置校验详情、宿主信息或其他运维实现细节。
  - 修复建议:对外返回稳定错误码和通用文案，仅将脱敏后的详细错误记录到服务端日志。

- [M13-11] P3 | 置信度 高 | client/src/components/host/HostPublicIpv4Tab.vue:68
  - 问题:独立 IPv4 管理组件的大量提示、按钮、状态和确认文案直接硬编码中文，未使用 i18n key。
  - 证据:例如 `toast.error('加载独立 IPv4 地址池失败...')`、模板中的“新增地址池”“可用”“已分配”“删除”等均为字面量。
  - 影响:切换语言后该页面仍显示中文，且错误文案无法统一维护。
  - 修复建议:把所有用户可见文案迁移到现有 i18n 资源并通过 `t()`/`$t()` 引用。

- [M13-12] P3 | 置信度 高 | client/src/components/instance/TrafficStats.vue:341
  - 问题:历史记录只有一天时，X 轴位置计算会产生 `NaN%`。
  - 证据:位置公式为 `(label.index / (trafficHistory.length - 1)) * 100`；当长度为 1 时分母为零，唯一标签计算为 `0 / 0`。
  - 影响:新实例或周期首日的日期标签可能消失或产生无效内联样式。
  - 修复建议:对单条历史记录单独设置固定位置，例如居中显示。
