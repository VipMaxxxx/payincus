# PayIncus 统一缺陷台账（DEFECTS.md）

> **生成说明**：本台账由 27 份模块只读审计报告（`audits/M01-claude.md … M27-codex.md`）合并、跨模块去重后生成。
> 依据 `MAINTENANCE_PLAN.md`（模块编号总表 + 风险分档 + 修缮流程）与 `AGENTS.md`（硬规矩/守卫纪律/完成定义）。
> **本文件仅为只读汇总**：合并过程中**未修改任何源码、未运行任何构建/测试/迁移**，也未触碰生产。修复须按 `MAINTENANCE_PLAN.md` 的波次制推进，并满足 `AGENTS.md §8` 完成定义。
> 编号规则：去重后统一重编号 `D-001…`，按 严重度（P0>P1>P2>P3）→ 置信度（高>中>低）→ 模块号 排序。每条保留全部来源原编号（`Mxx-NN`）。

---

## 一、执行摘要

- **原始发现总数（27 份报告）**：206 条
- **跨模块去重/归并后台账总数**：**175 条**（31 条并入 6 条横切问题）

### 按严重度计数（去重后）

| 严重度 | 高 | 中 | 低 | 小计 |
|--------|----|----|----|------|
| **P0 致命** | 1 | 0 | 0 | **1** |
| **P1 严重** | 56 | 6 | 0 | **62** |
| **P2 一般** | 56 | 20 | 0 | **76** |
| **P3 优化** | 13 | 15 | 8 | **36** |
| **合计** | 126 | 41 | 8 | **175** |

### 按模块计数（原始发现数，合计 206）

| 模块 | 数 | 模块 | 数 | 模块 | 数 | 模块 | 数 |
|------|----|------|----|------|----|------|----|
| M01 认证会话 | 10 | M08 钱包转账 | 4 | M15 邀请返利 | 8 | M22 主题平台 | 9 |
| M02 用户权限 | 6 | M09 风控 | 7 | M16 游戏化 | 8 | M23 Public API | 8 |
| M03 支付充值 | 6 | M10 系统配置OTA | 6 | M17 工单AI | 9 | M24 管理运营台 | 9 |
| M04 订单计费 | 13 | M11 套餐商城 | 7 | M18 通知邮件 | 7 | M25 日志审计 | 7 |
| M05 实例生命周期 | 9 | M12 秒杀兑换 | 7 | M19 邮箱托管 | 10 | M26 前端基座 | 7 |
| M06 资源交付 | 4 | M13 网络IP流量 | 12 | M20 Hosting托管 | 6 | M27 文档运维 | 4 |
| M07 主机Agent | 7 | M14 Web终端 | 7 | M21 插件平台 | 9 | | |

### 一句话结论

平台在**核心资金不变量**（余额锁 + 条件扣减 + 单事务）与 **HMAC/OAuth/OTA 主链路**上工程质量高、守卫密集；风险集中在**边界与横切层**：唯一 P0 是插件 iframe 同源可接管会话；62 条 P1 密集分布在 网络/流量(M13)、邮箱托管(M19)、管理运营台(M24)、插件/主题市场(M21/M22)、Web 终端(M14) 与若干高危路径，其中大量为**非原子竞态、硬删除级联、外呼 SSRF、事务外 TOCTOU、权限白名单自提权**等可系统性收敛的模式。

---

## 二、P0 / P1 要害清单

> 每条：`D-编号` [原编号] 模块 | 置信度 — 文件:行 · 问题 · 影响 · 修复方向

### P0（致命）

- **D-001** [M21-01] M21插件平台 | 高 — `client/src/components/plugins/PluginFrame.vue:93`
  - 问题：插件 HTML 与主站**同源**加载且 iframe 开 `allow-scripts allow-same-origin`，恶意插件脚本可访问父窗口 DOM/存储/同源接口，并移除 sandbox 重载。
  - 影响：已启用的恶意插件可窃取用户/管理员前端凭证、冒用当前会话执行敏感操作，后台插件可致管理员会话完全失陷。
  - 修复方向：插件页面托管到独立无凭证域并移除 `allow-same-origin`，仅经严格校验的 `postMessage` 能力桥通信。

### P1（严重）— 高置信度

- **D-002** [M01-01] M01认证 | 高 — `server/src/lib/redirect-validator.ts:23` + `routes/oauth.ts:281,393,575`
  - 问题：`isValidRedirectUrl` 只拦 `//` 不拦 `/\`，`redirect=/\evil.com` 过校验后浏览器归一化跳到 `https://evil.com/?oauth_code=...`。
  - 影响：一次性 OAuth 登录码泄漏到攻击者域，60s 内可账号接管。
  - 修复方向：redirect 校验拒绝反斜杠（`\`、`%5c`）及任何 `/[/\\]` 起始，前后端 `getSafeRedirectUrl` 同步收紧。

- **D-003** [M02-01] M02用户权限 | 高 — `server/src/routes/users.ts:1124` + `db/users.ts:697`
  - 问题：删用户走 `prisma.user.delete` 硬删除，阻断器只查 4 类；资金/审计关系 Cascade 被静默清除，RESTRICT 外键（邀请码等）抛未捕获 500。
  - 影响：要么不可逆销毁资金流水与登录审计（合规/取证风险），要么对真实用户几乎必然 500 失败。
  - 修复方向：改软删除或事务内显式清理/迁移关联，删前校验零余额，捕获外键错误返回业务码。

- **D-004** [M04-01] M04订单计费 | 高 — `server/src/services/billing-scheduler.ts:520` · `schema.prisma:4270`
  - 问题：到期删除任务对实例硬删除，`InstanceBillingRecord` = `onDelete:Cascade`，全部消费/退款账单随之永久删除。
  - 影响：线上"到期→封停→自动删除"常态下账单消失，订单丢单、收入统计倒缩水、财务证据链断裂。
  - 修复方向：到期删除改软删或删前归档账单；收入统计不依赖可被级联删的表。

- **D-005** [M05-01] M05实例生命周期 | 高 — `server/src/routes/instances.ts:3251` · `db/instances.ts:347`
  - 问题：实例所有者可调 `POST /:id/sync-status` 把 suspended 覆写为 stopped，绕过封停（含到期封停）。
  - 影响：欠费/滥用封停可被自助解除，状态机漂移，与到期风控/计费冲突。
  - 修复方向：sync-status 写库前排除 suspended（或对 suspended 实例跳过覆写）。

- **D-006** [M09-01] M09风控 | 高 — `server/src/services/resource-risk.ts:255,492`
  - 问题：风险分自动衰减在 5 分钟调度节奏下 `Math.floor(0.083*3)=0` 恒为 0，自动降级/QoS 恢复整链失效。
  - 影响：一次瞬时峰值把分数抬到限速档后，用户带宽被永久压到 QoS 档且可能长期限单，只能人工 release。
  - 修复方向：衰减基于"自上次有效触发"的累计时长，或改按无触发次数累积扣分。

- **D-007** [M10-01] M10系统配置OTA | 高 — `server/src/routes/system-config.ts:291` · `system-update.ts:43` · `app.ts:442`
  - 问题：OTA/插件/主题/礼品卡等"高危能力白名单"本身是普通配置项，`PUT /admin/system-config` 只需 `authenticateAdmin`，任意管理员可写自己 UID 自提权为 OTA 超管。
  - 影响：普通管理员越权可在生产触发全站更新/回滚（最高危），并能反向把 owner 锁死出 OTA。
  - 修复方向：`*_allowed_admin_ids` 类高危键写入收敛到超管级校验（与 OTA 同门禁）。

- **D-008** [M11-01] M11套餐商城 | 高 — `server/src/routes/packages.ts:882`
  - 问题：公开商城售罄判断只查 CPU/内存，遗漏磁盘容量、实际占用与系统盘池，与统一实现（`db/packages.ts:1438`）不一致。
  - 影响：磁盘不足/无系统盘池的套餐仍显示"有货"，用户进入下单流程才失败。
  - 修复方向：公开接口复用统一批量售罄检查，勿维护第二套容量算法。

- **D-009** [M11-02] M11套餐商城 | 高 — `server/src/routes/packages.ts:2458`
  - 问题：配额释放不要求 `hostIds` 唯一，逐宿主机独立提交 increment，无整体事务。
  - 影响：重复 ID 多次增容；中途失败已处理宿主机不回滚，重试再增容 → 库存误判与资源超卖。
  - 修复方向：入口去重拒绝重复 ID，全部容量变更放入同一事务。

- **D-010** [M12-01] M12秒杀兑换 | 高 — `server/src/routes/checkin.ts:237` · `db/redeem-codes.ts:354`
  - 问题：系统兑换只锁兑换码/批次，读实例算新值前未锁实例；不同码并发应用到同一实例丢失更新。
  - 影响：两码同兑一实例可写入相同目标值，两码均消耗、宿主用量累计两次，实例只加一次资源。
  - 修复方向：实例级分布式锁覆盖"重读实例—Incus 改—DB 提交"整段，持锁后重算目标值。

- **D-011** [M12-02] M12秒杀兑换 | 高 — `server/src/routes/checkin.ts:370,450`
  - 问题：完整系统兑换码被写入成功/资源池/失败日志，而单码可用至多 1000 次，日志中码仍是有效 bearer 凭据。
  - 影响：任何能读业务/资源池日志者可取得并重复使用未耗尽兑换码。
  - 修复方向：日志只记兑换码 ID 或掩码首尾，禁止持久化完整码值。

- **D-012** [M12-03] M12秒杀兑换 | 高 — `server/src/services/flash-sales.ts:523,576`
  - 问题：管理员调库存/改配置在事务外读校 `soldCount+reservedCount`，写入既不取商品锁也无条件更新，与抢购竞态。
  - 影响：校验通过后并发成交可致 `totalStock < soldCount+reservedCount`，负库存语义与错误在售状态。
  - 修复方向：库存/配置更新在同一事务取商品 advisory lock，基于锁后最新计数复校再写。

- **D-013** [M12-04] M12秒杀兑换 | 高 — `server/src/services/flash-sales.ts:793,816`
  - 问题：秒杀交付成功/失败回写非原子状态迁移（先 `findFirst` 再按 id 更新），更新条件不带原状态。
  - 影响：重复成功回调重复计交付；成功/失败竞态致订单先交付后改失败，统计重复累计、`soldCount` 错减。
  - 修复方向：用带当前状态条件的 `updateMany` 状态机式迁移，仅抢占成功方更新统计。

- **D-014** [M13-01] M13网络流量 | 高 — `server/src/services/agent-instance-report.ts:230` · `instance-traffic-collector.ts:73`
  - 问题：Agent 上报与主动采集共用快照但无采样版本判断，迟到旧上报会回退快照造成重复计量。
  - 影响：实例/用户月流量被重复累计，提前预警、限速与计费争议。
  - 修复方向：快照保存并原子校验采样时间/序号，拒绝迟到样本回退基线，统一单一权威采集源。

- **D-015** [M13-02] M13网络流量 | 高 — `server/src/routes/instances.ts:4721,4749`
  - 问题：批量端口映射配额按 `privatePortStart/End` 算，但传 `portMappings` 时直接采用任意长度数组并绕过 NAT 范围校验，schema 无 `maxItems`。
  - 影响：租户声明一个端口却提交大量任意公网端口映射，绕过配额并暴露宿主保留端口。
  - 修复方向：统一校验最终映射数组的数量/唯一性/内外端口范围，按最终创建数计配额。

- **D-016** [M13-03] M13网络流量 | 高 — `server/src/routes/ip-addresses.ts:620` · `db/ipv6-subnets.ts:74`
  - 问题：自定义 IPv6 CIDR 只查是否含于宿主网段与字符串完全重复，不查子网重叠，也不限制 `/112,/120,/124`。
  - 影响：不同实例可能获重叠路由，流量串扰、路由劫持或大范围 IPv6 不可达。
  - 修复方向：规范化 CIDR，按起止地址检查任何区间重叠，强制允许前缀集合。

- **D-017** [M13-04] M13网络流量 | 高 — `server/src/db/traffic.ts:600` · `routes/traffic.ts:451`
  - 问题：月流量重置只清零累计值不刷原始计数器快照，下次采样把重置前后整个窗口计入新周期；付费重置还未持采集锁。
  - 影响：重置后立即重现一段重置前流量，并发付费重置误计窗口更大。
  - 修复方向：同一采集锁内先补采/重建基线，再原子清零周期用量。

- **D-018** [M13-05] M13网络流量 | 高 — `server/src/lib/caddy-client.ts:159`
  - 问题：新增 Caddy 路由把任意 POST 失败都当"服务器不存在"，随后用仅含当前路由的配置 PUT 整个 `sites` 服务器。
  - 影响：短暂网络/认证错误后若 PUT 成功，可覆盖该宿主全部反代路由，所有站点中断。
  - 修复方向：仅在明确 404 时创建服务器，用条件写入/读取合并，禁止盲目全量覆盖。

- **D-019** [M13-06] M13网络流量 | 高 — `server/src/routes/proxy-sites.ts:953`
  - 问题：证书查询直接 `tls.connect` 站点域名 443，不走 outbound-security，未在连接时复限解析结果为宿主公网。
  - 影响：租户改 DNS 到回环/私网/云元数据，后端可被诱导探测内网 443（SSRF/DNS rebinding）。
  - 修复方向：连接前经统一出站安全组件解析并锁定允许地址，禁私网/回环并防重绑定。

- **D-020** [M13-07] M13网络流量 | 高 — `server/src/lib/caddy-client.ts:39,66`
  - 问题：Caddy 管理请求携带 Basic Auth 但 TLS `rejectUnauthorized:false` 关闭证书校验。
  - 影响：宿主与后端链路被劫持时可窃取 Caddy 管理凭证并篡改全部反代配置。
  - 修复方向：受信 CA/证书指纹固定/双向 TLS，禁止对携带管理凭证的连接关闭证书验证。

- **D-021** [M14-01] M14Web终端 | 高 — `server/src/lib/terminal-proxy.ts:501,602,622`
  - 问题：初次连 Incus 期间尚未装客户端 `close/error` 监听，浏览器提前退出则关闭事件永久错过，仍创建活跃会话。
  - 影响：快速关终端后服务端保留最长约 12h 僵尸会话与 Incus WS，占满每用户/实例连接额度。
  - 修复方向：异步建连前先监听客户端关闭并维护取消态，建连完成后复核客户端 OPEN 再登记。

- **D-022** [M14-02] M14Web终端 | 高 — `server/src/lib/terminal-proxy.ts:283`
  - 问题：Incus 重连退避/建连期间不复核会话仍存在，已关闭会话仍可后台完成重连产生无人管理连接。
  - 影响：用户重连提示期间关终端后，异步任务仍新建 Incus 连接且不在 `activeSessions`，无法清理/统计。
  - 修复方向：重连引入可取消代次标识，退避后与建连完成后复核会话/客户端状态，失效即销毁。

- **D-023** [M14-03] M14Web终端 | 高 — `server/src/routes/terminal.ts:418`
  - 问题：终端建成后同步 `await createLog`，日志失败被当连接失败并主动关闭正常会话。
  - 影响：日志库故障/抖动/超时让已连通终端显示"Failed to connect"（与 owner 反馈现象吻合）。
  - 修复方向：审计日志失败与连接生命周期隔离，记录异常但不关闭已建成终端。

- **D-024** [M16-01] M16游戏化 | 高 — `server/prisma/schema.prisma:4175`
  - 问题：删除 VIP 奖励级联删除全部领取记录（`onDelete:Cascade`），领取资格又只按当前 claim 数判断。
  - 影响：调整/误删奖励后幂等凭据消失，重建奖励时已领用户可再次入账（余额/积分）。
  - 修复方向：领取历史用快照并禁级联删除，奖励配置改停用/软删除。

- **D-025** [M16-02] M16游戏化 | 高 — `server/prisma/schema.prisma:4689`
  - 问题：删除抽奖活动/奖品级联删除历史中奖记录，`totalDraws` 又实时 `count`。
  - 影响：中奖记录、待发放实例奖品、通知状态与统计永久消失，库存/概率审计无法追溯。
  - 修复方向：有记录的活动/奖品只允许停用，历史保留奖品快照并用限制删除/软删除。

- **D-026** [M16-03] M16游戏化 | 高 — `server/src/routes/admin-entertainment.ts:446` · `db/lottery.ts:503`
  - 问题：只校验单奖品概率 0–100，不校验奖池总和；抽取累加到 100 后靠后奖品永不命中。
  - 影响：总和超 100% 时靠后奖品被截断甚至归零，UI 仍展示填写概率，公平性与披露不一致。
  - 修复方向：启用奖池前原子校验总概率≤100%，剩余概率对应唯一 `nothing` 奖品。

- **D-027** [M17-02] M17工单AI | 高 — `server/src/services/ai-ticket-auto-reply-scheduler.ts:24,98`
  - 问题：AI 自动回复只靠进程内 `Set`+发送前查询防重，无 DB 抢占/条件写入/幂等键。
  - 影响：多进程、调度器与人工 AI 回复并发、或两 API 并发均可向同一工单发多条 AI 回复，穿透日限/冷却。
  - 修复方向：事务内以"最新消息仍为客户消息"条件原子抢占，一次客户消息建唯一幂等标识。

- **D-028** [M17-03] M17工单AI | 高 — `server/src/routes/tickets.ts:1179,1229`
  - 问题：人工状态更新/关闭"先读后无条件更新"，不比对旧状态/最新消息版本。
  - 影响：客服读取后客户新回复使工单转 in_progress，较晚关闭仍覆盖为 closed，新回复留在已关闭工单；并发关闭重复通知。
  - 修复方向：带预期状态/版本号的条件更新，仅实际完成迁移者发通知。

- **D-029** [M17-04] M17工单AI | 高 — `server/src/routes/tickets.ts:178,984` · `lib/ticket-attachments.ts:48`
  - 问题：单请求允许 6×50MB 图片并 `toBuffer()` 全量常驻内存。
  - 影响：单登录用户即可让单请求占用约 300MB+，少量并发上传可致进程 OOM，API 不可用。
  - 修复方向：显著降低单图/总请求上限，改为有总字节预算的流式上传。

- **D-030** [M19-01] M19邮箱托管 | 高 — `server/src/services/mail-expiry-scheduler.ts:38` · `db/mail.ts:339`
  - 问题：订阅到期只更新本地状态，未暂停 CraneMail 域名；订阅查询仅返回 active，过期无法续费但上游仍运行。
  - 影响：过期用户长期继续用上游邮件，前端显示"无订阅"致重复购买，遗留域名成不可见但仍工作的免费资源。
  - 修复方向：到期建可重试上游暂停任务，订阅查询/续费明确支持 expired 与恢复上游域名。

- **D-031** [M19-02] M19邮箱托管 | 高 — `server/src/routes/mail.ts:775`
  - 问题：管理员退款按当前方案标价计算，不用购买/续费实付金额（购买可经优惠码更低）。
  - 影响：优惠码订单被超额退款，改价后历史订阅多退/少退，直接资金损失与账实不符。
  - 修复方向：持久化每次实付金额与服务区间，退款只依据不可变账单流水计算。

- **D-032** [M19-03] M19邮箱托管 | 高 — `server/src/routes/mail.ts:793`
  - 问题：管理员取消订阅先逐个删上游域名再走本地退款/删除事务，且未取订阅锁。
  - 影响：中途删除失败成部分删除；事务失败留"本地有效、上游已删"；与续费并发致先扣款后按旧快照删退。
  - 修复方向：取消流程用订阅级锁与持久化状态机，远端删除/退款/删除设计为幂等可恢复。

- **D-033** [M19-04] M19邮箱托管 | 高 — `server/src/routes/mail.ts:1223`
  - 问题：后端允许年付方案按任意 1–12 月续费并年价÷12，绕过年付周期（前端固定一年）。
  - 影响：用户直调 API 以年付折算单价只买一个月，破坏计费规则。
  - 修复方向：后端按 `billingCycle` 限制续费月份，年付仅接受完整年度倍数。

- **D-034** [M19-05] M19邮箱托管 | 高 — `server/src/routes/mail.ts:1501,1508`
  - 问题：域名上游创建成功后，本地域名/管理员账号落库失败时无上游删除补偿。
  - 影响：事务回滚后 CraneMail 仍存域名/管理员邮箱但本地不可见，占用唯一性与上游容量，需人工清理。
  - 修复方向：远端域名创建建明确补偿删除及补偿失败告警/待处理记录。

- **D-035** [M20-01] M20Hosting托管 | 高 — `server/src/services/hosting-scheduler.ts:55,114`
  - 问题：解冻任务把所有到期记录放同一事务，任一用户非阻塞余额锁获取失败即回滚全部用户解冻。
  - 影响：整点某机主在提现/扣款/调账时，其他所有机主本小时到期收入无法解冻，持续冲突致全局资金长期延迟。
  - 修复方向：按用户/有限批次独立事务，跳过锁冲突用户并短周期重试。

- **D-036** [M21-02] M21插件平台 | 高 — `server/src/routes/plugins.ts:2325` · `lib/plugin-runtime.ts:205`
  - 问题：通用 action 路由只需 `authenticateUser`，运行时仅验 manifest 是否声明 scope，不按 actor 角色限制支付/交付类高权限 action。
  - 影响：普通用户知 action 名即可绕过 `/gateway-actions`、`/service-actions` 管理员鉴权，发起任意支付/退款/交付/终止。
  - 修复方向：通用 action 按 scope/source 强制 actor 授权，禁用户入口调仅供 gateway/service/system 的 action。

- **D-037** [M21-03] M21插件平台 | 高 — `server/src/lib/plugin-runtime.ts:517` · `plugin-event-retry-scheduler.ts:269`
  - 问题：到期重试"先查后执行再更新"，无抢占/条件更新/事务锁；定时器、手工重试与多进程可同取同一日志重复投递。
  - 影响：同一订单/支付/资源事件被插件 webhook 重复处理，并发失败互相覆盖 `retryCount`。
  - 修复方向：DB 原子 claim 到期记录，用带旧状态/版本条件更新或 `FOR UPDATE SKIP LOCKED`，单进程加运行互斥。

- **D-038** [M21-04] M21插件平台 | 高 — `server/src/lib/plugin-market-publisher.ts:139`
  - 问题：发布市场索引先无条件保留旧索引全部条目再覆盖 listed，`delisted/rejected` 不移除。
  - 影响：管理员下架/拒绝后旧插件仍可见可安装，市场治理失效。
  - 修复方向：以 DB 当前可发布集合为唯一来源，合并旧索引时显式删除不再 listed 的 ID。

- **D-039** [M21-06] M21插件平台 | 高 — `server/src/lib/plugin-package.ts:57,87`
  - 问题：插件包只拒软/硬链接与路径穿越，不限解压总大小/文件数/特殊文件类型，随后直接系统 `tar` 解压。
  - 影响：小包解压占满磁盘（压缩炸弹）；FIFO/设备文件可使后续 `readFile` 阻塞致后台不可用。
  - 修复方向：解压前统计并限制条目数与声明大小，只允许普通文件/目录，受限临时目录按字节配额流式解压。

- **D-040** [M22-01] M22主题平台 | 高 — `server/src/lib/theme-package.ts:382` · `components/theme/ThemeTemplateSlot.vue:70`
  - 问题：模板安全校验用正则匹配原始 HTML，HTML 实体可绕过 `javascript:` 检查，内容经 `v-html` 注入双端页面。
  - 影响：过审/上传启用的恶意主题可在公开页、用户中心乃至账单/OAuth 管理页执行脚本（存储型 XSS）。
  - 修复方向：改用严格白名单 HTML 净化器，URL 属性解码后校验协议，补实体/SVG/样式攻击守卫用例。

- **D-041** [M22-02] M22主题平台 | 高 — `server/src/routes/themes.ts:106` · `db/themes.ts:77`
  - 问题：无鉴权 `/active` 返回完整主题序列化对象，含全部 `configValues`（含 `password` 类型配置）。
  - 影响：任何访客可读取当前主题保存的密码/令牌等敏感配置。
  - 修复方向：公开响应用专用 DTO 彻底移除密码/秘密字段，manifest 默认值勿含秘密。

- **D-042** [M22-03] M22主题平台 | 高 — `server/src/lib/theme-market-publisher.ts:112`
  - 问题：市场发布器先载入旧索引全部条目再仅覆盖 listed，`delisted/rejected`/扫描失败历史条目不删。
  - 影响：管理员下架/撤审后恶意或有漏洞主题仍展示并可安装。
  - 修复方向：发布时以 DB 当前可发布集合重建条目，仅显式合并有独立来源标识的内置主题。

- **D-043** [M22-04] M22主题平台 | 高 — `server/src/db/themes.ts:135` · `routes/admin-themes.ts:281`
  - 问题：安装同主题同版本时先 `rm`/`rename` 替换线上资源目录再更新 DB，已启用主题会在未 enable 时立即加载新文件。
  - 影响：上传/重装短暂绕过"安装后未启用"；DB 更新失败则库显旧主题启用但资源已被永久替换。
  - 修复方向：版本不可变目录 + 原子状态切换，DB 失败回滚文件替换，禁覆盖当前启用版本。

- **D-044** [M22-05] M22主题平台 | 高 — `server/src/lib/theme-package.ts:350,401`
  - 问题：归档校验只拒软/硬链接/危险路径/脚本扩展名，不限解压总大小/文件数，也不拒 FIFO/设备文件；`readFile` 无超时。
  - 影响：小体积压缩炸弹耗尽磁盘，或 FIFO manifest/CSS 使审核扫描长期挂起。
  - 修复方向：解压前校验条目类型/数量/声明尺寸，过程设总量配额，只接受普通文件/目录。

- **D-045** [M23-01] M23PublicAPI | 高 — `server/src/lib/oauth-provider.ts:515,529`
  - 问题：refresh token 轮换非原子"仅未吊销时消费"，update 条件不含 `revokedAt:null`，同一 token 可并发兑换多次。
  - 影响：token 被窃/重复提交时攻击者与合法客户端可同时获多条有效 `poa_`/refresh 链，轮换无法阻止重放。
  - 修复方向：事务内行锁或带 `revokedAt:null` 条件的原子更新消费旧 token，仅更新成功者签发下一组。

- **D-046** [M23-02] M23PublicAPI | 高 — `server/src/app.ts:318`
  - 问题：Public API 写接口 Fastify 限流全部按 IP（`request.ip`），非按 `pat_`/`poa_` token 或用户。
  - 影响：持 token 者可用代理池切 IP 绕过续费/工单/通知配额；共享 NAT 出口用户互相消耗额度。
  - 修复方向：认证后用稳定 token 来源与 token ID（叠加用户 ID）作限流键，IP 仅作附加维度。

- **D-047** [M23-03] M23PublicAPI | 高 — `docs-site/docs/public/sdk/payincus-public-api.ts:178`
  - 问题：SDK 对服务操作/续费成功响应类型定义与后端实际结构完全不同（`{task}` vs 扁平字段）。
  - 影响：按 SDK 类型与官方示例集成时，服务操作成功后因 `task` 为 undefined 崩溃，续费得不存在字段。
  - 修复方向：以 OpenAPI 与真实响应为准统一 SDK 类型、方法返回值与全部示例。

- **D-048** [M24-01] M24管理运营台 | 高 — `server/src/routes/admin-capacity-cost.ts:415` · `db/package-plans.ts:359`
  - 问题：套餐价格以"分"存储却被当"元"算月收入/毛利，收入放大 100 倍。
  - 影响：低毛利/亏损套餐显示成高毛利，亏损预警失效，误导定价与扩容决策。
  - 修复方向：进入容量成本模型前统一将套餐价由分转元，补跨单位口径守卫。

- **D-049** [M24-02] M24管理运营台 | 高 — `server/src/services/auto-policy-scheduler.ts:151,195`
  - 问题：重试范围覆盖创建快照之后的 DB/通知/日志，任何后置失败都再次创建快照。
  - 影响：通知/日志短暂失败即重复快照；达配额时每次重试还删旧快照，可能误删用户保留快照并留 Incus 孤儿。
  - 修复方向：只重试幂等的 Incus 创建阶段并建快照/记录幂等键，后置通知/日志独立失败处理。

- **D-050** [M24-03] M24管理运营台 | 高 — `server/src/routes/batch-config.ts:407,565,630`
  - 问题：单实例批量更新非原子，先改 Incus 后改 DB，失败无补偿/状态标记。
  - 影响：高级配置/DB 更新失败时接口报失败但部分 Incus 已生效，实例资源/宿主台账/运行态永久不一致。
  - 修复方向：每实例用可恢复状态机记录阶段进度，失败补偿或安排强制对账。

- **D-051** [M24-04] M24管理运营台 | 高 — `server/src/routes/batch-config.ts:304` · `db/hosts.ts:485`
  - 问题：宿主机资源用量基于请求开始的旧值绝对覆盖（`host.cpu_used+delta`），并发批量丢失更新。
  - 影响：两并发批量互相覆盖，容量台账少算/多算，错误放行实例或触发错误告警。
  - 修复方向：事务内原子 `increment` 或加宿主机锁并提交前重算用量。

- **D-052** [M24-05] M24管理运营台 | 高 — `server/src/routes/admin-sla-alerts.ts:298`
  - 问题：SLA 规则严重级别/阈值/合并窗口可保存，但扫描执行几乎不读取（固定用 `RECENT_LOOKBACK_HOURS` 等）。
  - 影响：管理员改级别/阈值后界面显示成功但告警行为不变，漏升级事故或持续产生不符配置的告警。
  - 修复方向：扫描/合并以持久化规则为唯一参数来源，每个可编辑字段加行为级守卫。

- **D-053** [M25-02] M25日志审计 | 高 — `server/src/lib/log-sanitizer.ts:85`
  - 问题：自由文本脱敏只识 JWT 与窄字符集 Bearer，识别不了裸 `pat_`/`poa_`/Basic/URL 查询密钥/含特殊字符 Bearer；递归深度>10 原样返回对象。
  - 影响：异常消息/上游响应/深层对象中的 API Token/Cookie/签名/密钥可进 Pino 日志、审计与运维输出。
  - 修复方向：统一覆盖项目全部凭证格式的脱敏器，递归超限整体替换而非返回原值。

- **D-054** [M26-01] M26前端基座 | 高 — `client/src/stores/auth.ts:16` · `router/user.ts:350` · `api/index.ts:502`
  - 问题：跨标签 token 变化只更新 `token` 不清 `user/quota`，路由守卫又只在 `user` 空时重取用户。
  - 影响：一标签切号后其他标签仍显旧账号/角色/配额，但 API 已按新账号执行，存在误操作他人资源风险。
  - 修复方向：token 跨标签变化时原子清空身份态并立即重取当前用户或整页重载。

- **D-055** [M27-01] M27文档运维 | 高 — `scripts/install-panel.sh:1136,828,1174` · `deploy/incudal-backend.service.example:32`
  - 问题：`User=root` 在线更新单元直接执行 `incudal` 用户可写目录中的 JS，且该用户可免密 `systemctl start`。
  - 影响：后端进程/扩展代码/`incudal` 账号被攻破即可替换 root 单元脚本获完整 root（服务用户→root 提权链）。
  - 修复方向：owner 按 OTA 高危流程专项收紧，root helper 只执行 root 拥有且服务用户不可写的固定入口与已验证产物。

- **D-056** [横切:M25-01,M17-01,M17-07,M18-01,M18-04,M19-07,M21-05,M22-09,M24-06,M24-09] 横切/多模块 | 高 — `server/src/lib/outbound-security.ts:149`（+各调用点）
  - 问题：外呼目标仅请求前解析校验一次，连接期防 DNS rebinding 的 `safeOutboundDispatcher` 是可选导出、未被安全 API 强制；AI 地址(M17-01)甚至未校验且默认允许重定向，SMTP(M18-04)完全未校验。
  - 影响：攻击者控制的域名校验时解析公网、连接时改解析内网，使服务端携凭证访问回环/私网/云元数据（SSRF）。
  - 修复方向：封装不可绕过的安全 fetch，所有外呼强制连接期 DNS 复核 + 禁自动重定向 + 超时 + 响应限长；SMTP 保存与每次连接均校验解析结果。

- **D-057** [横切:M27-02,M09-04,M07-05] 横切/多模块 | 高 — `deploy/nginx-split-intranet.conf.example:57` · `server/src/lib/trust-proxy-config.ts:8` · `routes/agent.ts:236`
  - 问题：Nginx 保留/追加客户端转发头，安装脚本固定 `TRUST_PROXY=true` 令 Fastify 全链信任，`request.ip` 与心跳 IP 可伪造。
  - 影响：伪造 IP 绕过全局限流、终端连接限制、登录风控与异地登录告警；若回调端点可直达 Nginx 还可绕过支付回调 IP 白名单。
  - 修复方向：仅信任固定跳数/受信代理网段，最外层代理覆盖而非追加转发头。

### P1（严重）— 中置信度

- **D-058** [M05-02] M05实例生命周期 | 中 — `server/src/workers/restoreTaskWorker.ts:332,412`
  - 问题：恢复流程"删原实例→重命名临时→启动"，删后重命名前抛错则 catch 无条件删临时实例，而此时临时实例是唯一副本。
  - 影响：恢复任务在关键窗口失败=实例数据彻底丢失且无残留可人工恢复。
  - 修复方向：清理临时实例前先确认原实例仍存在；原实例已删则保留临时实例并标记人工介入。

- **D-059** [M06-01] M06资源交付 | 中 — `server/src/db/resource-pool.ts:225` · `routes/resource-pool.ts:184`
  - 问题：资源池申领对主机用量无条件 increment，全程无"是否超主机配额上限"校验（与 `reserveResources` 严重不对称），`amount` 无上限。
  - 影响：用户把签到/抽奖/兑换攒的池资源灌到实例可突破节点内存上限，触发同宿主其他租户 OOM/KVM 失败。
  - 修复方向：申领前同一事务内按 `reserveResources` 同款条件更新校验主机剩余容量，超限拒绝并回滚 Incus patch。

- **D-060** [M12-05] M12秒杀兑换 | 中 — `server/src/services/flash-sales.ts:720,767`
  - 问题：秒杀资格检查得到的价格与最终库存申领间存在价格 TOCTOU，申领事务重读商品后不验证成交金额是否仍符当前秒杀价。
  - 影响：结算期间管理员改价时，用户可按旧价扣款并占新价配置库存，导致少收/多收。
  - 修复方向：价格变更与申领共用商品锁，最终扣款事务内绑定并验证明确价格版本/快照。

- **D-061** [M17-05] M17工单AI | 中 — `server/src/services/ai-ticket-context.ts:346,381,1038`
  - 问题：客户消息作为普通 JSON 直入模型提示，模型自报 `confidence/handoffRequired` 直接作为自动发送依据，输出安全检查仅少量正则。
  - 影响：客户可构造提示注入诱导模型高置信免转人工并自动发送钓鱼链接/错误操作指引。
  - 修复方向：客户内容明确标记为不可信数据，以服务端确定性策略与严格输出结构决定是否自动发送，勿信模型自报安全结论。

- **D-062** [M19-06] M19邮箱托管 | 中 — `server/src/routes/mail.ts:1719`
  - 问题：邮箱账号创建的存在检查、上游创建与本地落库间无同域账号锁，唯一冲突后无条件 `deleteAccount` 补偿。
  - 影响：两同名请求都过前检且上游均成功时，一个本地唯一冲突会删共享远端账号，留另一条本地记录指向不存在邮箱。
  - 修复方向：对"域名+用户名"取事务级锁，用可证明归属本请求的幂等标识后再补偿。

- **D-063** [M20-02] M20Hosting托管 | 中 — `server/src/db/billing-operations.ts:1496`
  - 问题：托管实例退款扣款允许余额不足时只扣到现有余额（`Math.min`），不校验剩余未扣金额也不形成欠款，而买家已被全额加款。
  - 影响：机主提前提现耗尽余额后，买家仍收全额退款，机主只承担部分/零扣款，差额由平台无账务承担。
  - 修复方向：退款事务须保证机主全额扣款，或将未扣差额原子记入明确欠款/负余额账本。

---

## 三、横切主题（归并）

> 反复出现于多个模块的同一类根因，已在台账中合并为独立 `D-` 条目或标注同类模式。每个列出波及模块/原编号。

### 横切-A｜`apiError`/错误响应把内部异常原文返回客户端 → **D-118**
- 根因：`server/src/lib/errors.ts:700` `apiError()` 无条件把 `details` 放入响应，绕过 `app.ts` 对生产 5xx 的统一隐藏；各路由普遍把 `error.message`/上游响应正文传入。
- 波及：M01-06、M11-04、M12-06、M13-10、M15-04、M16-06、M16-07、M19-10、M23-08、M25-03（共 10 处，覆盖 M01/M11/M12/M13/M15/M16/M19/M23/M25）。
- 统一修法：区分内部诊断与公开详情，5xx 只返回稳定错误码 + 通用文案，完整异常仅脱敏落日志并关联 request ID。

### 横切-B｜外呼 `assertSafeHttpUrl` 后未绑 `safeOutboundDispatcher`（连接期 DNS rebinding SSRF） → **D-056**
- 根因：`server/src/lib/outbound-security.ts:149` 校验与连接分离，安全 dispatcher 可选未强制。
- 波及：M25-01(根因)、M17-01(AI 且未校验+允许重定向)、M17-07(附件/Lsky)、M18-01(Webhook)、M18-04(SMTP 未校验)、M19-07(CraneMail/SmarterMail)、M21-05(插件市场扫描)、M22-09(主题市场扫描)、M24-06(监控 webhook)、M24-09(市场健康探测)（覆盖 M17/M18/M19/M21/M22/M24/M25）。
- 统一修法：不可绕过的安全 fetch + 连接期 DNS 复核 + 禁重定向 + 超时 + 响应限长。

### 横切-C｜`trustProxy`/`X-Forwarded-For` 可伪造 → **D-057**（相关 **D-046**）
- 根因：Nginx 追加客户端转发头 + `TRUST_PROXY=true` 全链信任 → `request.ip` 客户端可控。
- 波及：M27-02(根因:Nginx+安装脚本)、M09-04(风控/geoip)、M07-05(心跳 IP)；并放大 M23-02(限流按 IP，见 D-046) 与 M03-04(回调 IP 白名单)。
- 统一修法：仅信任固定跳数/受信代理网段，最外层代理覆盖而非追加转发头；限流键改用 token/用户 ID。

### 横切-D｜check-then-act 非原子竞态（先查后写 / 无锁 / 无条件更新）
- 分布最广的一类。已各自独立立项（多为 P1/P2），共性是缺 advisory lock / 条件 `updateMany` / 唯一约束：
  - 状态机/交付：M12-04(D-013)、M17-03(D-028)、M21-03(D-037)、M23-01(D-045)、M08-03(D-173)、M09-03(D-134)、M05-04(D-126)。
  - 库存/配额/容量：M11-02(D-009)、M12-03(D-012)、M24-04(D-051)、M04-02(D-067)。
  - 计数上限：M14-05(D-081)、M14-06(D-082)、M23-06(D-107)、M09-05(D-163)。
  - 关系/唯一性：M15-02(D-084)、M02-03(D-122)、M19-06(D-062)。
- 统一修法：进入副作用前取按键 advisory lock 或用带原状态/版本条件的 `updateMany`，并补 DB 唯一（部分）约束兜底。

### 横切-E｜事务外 TOCTOU 金额/上限校验（读校在事务外，事务内不复核）
- 波及：M04-04(D-069)、M04-05(D-070)、M04-07(D-072) 管理端计费无 version 锁；M06-01(D-059) 资源池无主机上限；M12-03(D-012)/M12-05(D-060) 秒杀库存/价格；M24-04(D-051) 宿主用量。
- 统一修法：把上限/基准读取移入同一事务基于事务内快照重算，配合实例级/用户级 advisory lock。

### 横切-F｜硬删除级联抹掉财务/审计记录
- 波及：M02-01(D-003) 用户硬删除级联资金/审计；M04-01(D-004) 到期实例硬删除级联账单；M16-01(D-024) VIP 奖励删除级联领取记录；M16-02(D-025) 抽奖删除级联中奖记录。
- 统一修法：财务/审计/领取历史改软删除或快照留存 + 禁级联删除；统计不依赖可被级联删的表。

### 横切-G｜i18n 硬编码中文 / 缺 key（前端多页 + 后端文案） → **D-152**
- 波及：M02-04(后端硬编码)、M02-05(UserLifecycleView)、M11-07(PortalView)、M12-07(FlashSalesView)、M13-11(HostPublicIpv4Tab)、M14-07(TerminalView)、M15-08(InvitesView)、M18-07(TelegramConfigView)、M26-07(三语词典不完整+强制回退简中)。
- 统一修法：抽取 i18n key 补齐 en/zh-TW，后端改错误码，扩展守卫递归比对词典与实际使用 key。

### 横切-H｜内存态（Map）在多进程部署下失效 → **D-167**
- 波及：M01-10(登录锁定/OAuth nonce/登录码去重)、M08-02(交割 finalize 去重)、M10-06(配置缓存)；相关并发缺陷 M17-02(D-027)、M21-03(D-037) 亦部分依赖内存去重。
- 统一修法：确认单实例部署假设并写入架构文档；横向扩容前下沉共享存储或引入变更通知失效。

### 横切-I｜管理端/高危配置写入缺细分权限校验 → **D-007**
- 波及：M10-01(D-007) `*_allowed_admin_ids`（OTA/插件/主题/礼品卡超管白名单）任意管理员可改自提权；同源问题面还包括 M10-02/M10-04(配置项无协议校验致 XSS/客户端 SSRF)、M22-02(公开接口暴露 password 配置)。
- 统一修法：高危能力白名单键写入收敛到超管级门禁；配置写入按键做协议/格式/长度校验。

### 横切-J｜前端异步竞态 / 失败开放（补充）
- 波及：M11-06(D-077 商城加载竞态)、M26-02(D-113 恢复轮询乱序)、M26-03(D-114 配置失败开放)、M26-05(D-139 定时刷新登出后重写 token)。
- 统一修法：请求序号/AbortController/单飞锁；配置显式区分"已加载/失败/启用"，未知态安全降级。

---

## 四、完整台账

> 全部 175 条去重后条目，按 严重度→置信度→模块 排序。`原编号` 列保留合并前来源。

| D-### | 原编号 | 模块 | 严重度 | 置信度 | 问题（一句话） | 文件:行 | 修复方向 |
|-------|--------|------|--------|--------|----------------|---------|----------|
| D-001 | M21-01 | M21 | P0 | 高 | 插件 iframe 同源 + allow-same-origin，可接管当前会话 | client/.../PluginFrame.vue:93 | 独立无凭证域托管 + 去 allow-same-origin + postMessage 桥 |
| D-002 | M01-01 | M01 | P1 | 高 | 开放重定向反斜杠绕过泄漏 OAuth 登录码致账号接管 | lib/redirect-validator.ts:23; routes/oauth.ts:281 | redirect 校验拒 `\`/`%5c`/`/[/\\]` 起始 |
| D-003 | M02-01 | M02 | P1 | 高 | 硬删除用户级联抹资金/审计，RESTRICT 外键抛 500 | routes/users.ts:1124; db/users.ts:697 | 软删除或事务内清理 + 零余额校验 + 捕获外键错误 |
| D-004 | M04-01 | M04 | P1 | 高 | 到期删除硬删实例级联抹全部账单财务史 | services/billing-scheduler.ts:520 | 改软删/删前归档账单，统计不依赖级联表 |
| D-005 | M05-01 | M05 | P1 | 高 | sync-status 可把 suspended 洗回 stopped 绕过封停 | routes/instances.ts:3251 | 写库前排除 suspended 状态 |
| D-006 | M09-01 | M09 | P1 | 高 | 风险分自动衰减恒为 0，自动降级/恢复失效永久误伤 | services/resource-risk.ts:255 | 衰减基于累计时长或按无触发次数扣分 |
| D-007 | M10-01 | M10 | P1 | 高 | 普通管理员可写高危白名单自提权为 OTA 超管 | routes/system-config.ts:291; app.ts:442 | 高危键写入收敛到超管级门禁 |
| D-008 | M11-01 | M11 | P1 | 高 | 公开商城售罄判断只查 CPU/内存遗漏磁盘/盘池 | routes/packages.ts:882 | 复用统一批量售罄检查 |
| D-009 | M11-02 | M11 | P1 | 高 | 配额释放不去重 hostIds、无整体事务，重复增容超卖 | routes/packages.ts:2458 | 入口去重 + 同一事务 |
| D-010 | M12-01 | M12 | P1 | 高 | 系统兑换未锁实例，并发不同码丢失更新消耗两码只生效一次 | routes/checkin.ts:237; db/redeem-codes.ts:354 | 实例锁覆盖重读—Incus—提交整段，持锁后重算 |
| D-011 | M12-02 | M12 | P1 | 高 | 完整可复用兑换码写入日志成有效 bearer | routes/checkin.ts:370 | 日志只记码 ID/掩码 |
| D-012 | M12-03 | M12 | P1 | 高 | 管理员调库存事务外校验无锁与抢购竞态致负库存 | services/flash-sales.ts:523 | 同事务取商品锁 + 锁后复校 |
| D-013 | M12-04 | M12 | P1 | 高 | 秒杀交付成功/失败回写非原子状态迁移 | services/flash-sales.ts:793 | 带原状态条件 updateMany 状态机 |
| D-014 | M13-01 | M13 | P1 | 高 | 流量双通道无采样版本，迟到上报回退快照重复计量 | services/agent-instance-report.ts:230 | 原子校验采样时间/序号，拒回退 |
| D-015 | M13-02 | M13 | P1 | 高 | 批量端口映射绕过端口范围与配额 | routes/instances.ts:4721 | 统一校验数量/唯一/端口范围，按最终数计配额 |
| D-016 | M13-03 | M13 | P1 | 高 | IPv6 CIDR 不检子网重叠、不限前缀 | routes/ip-addresses.ts:620 | 规范化 + 起止地址重叠检查 + 强制前缀集 |
| D-017 | M13-04 | M13 | P1 | 高 | 月流量重置不刷快照致重置前流量串账 | db/traffic.ts:600; routes/traffic.ts:451 | 采集锁内先重建基线再原子清零 |
| D-018 | M13-05 | M13 | P1 | 高 | Caddy 新增路由把 POST 失败当不存在，PUT 覆盖全部路由 | lib/caddy-client.ts:159 | 仅明确 404 时创建，条件写/读合并 |
| D-019 | M13-06 | M13 | P1 | 高 | 证书查询直连 443 不走 outbound-security，DNS 重绑定 SSRF | routes/proxy-sites.ts:953 | 连接前经统一出站安全组件锁定允许地址 |
| D-020 | M13-07 | M13 | P1 | 高 | Caddy 管理请求带 Basic Auth 却关闭 TLS 校验 | lib/caddy-client.ts:39 | 受信 CA/指纹固定/mTLS，禁关证书校验 |
| D-021 | M14-01 | M14 | P1 | 高 | WS 初次建连期未装 close 监听致僵尸会话 | lib/terminal-proxy.ts:501 | 建连前监听关闭 + 完成后复核 OPEN 再登记 |
| D-022 | M14-02 | M14 | P1 | 高 | Incus 重连期不复核会话存在致无人管理连接 | lib/terminal-proxy.ts:283 | 可取消代次标识 + 复核会话/客户端态 |
| D-023 | M14-03 | M14 | P1 | 高 | 审计日志失败被当终端连接失败并关闭正常会话 | routes/terminal.ts:418 | 日志失败与连接生命周期隔离 |
| D-024 | M16-01 | M16 | P1 | 高 | 删 VIP 奖励级联删领取记录，重建可重复领取 | schema.prisma:4175 | 领取历史快照 + 禁级联删 + 奖励软删 |
| D-025 | M16-02 | M16 | P1 | 高 | 删抽奖活动/奖品级联删中奖记录 | schema.prisma:4689 | 有记录只停用，历史快照 + 限制删除 |
| D-026 | M16-03 | M16 | P1 | 高 | 奖池概率无总和约束，靠后奖品永不命中不公平 | routes/admin-entertainment.ts:446; db/lottery.ts:503 | 启用前原子校验总和≤100% |
| D-027 | M17-02 | M17 | P1 | 高 | AI 自动回复只内存防重，多并发重复发送 | services/ai-ticket-auto-reply-scheduler.ts:24 | 事务内"最新为客户消息"条件原子抢占 + 幂等键 |
| D-028 | M17-03 | M17 | P1 | 高 | 人工状态更新先读后无条件更新覆盖新回复 | routes/tickets.ts:1179 | 带预期状态/版本条件更新 |
| D-029 | M17-04 | M17 | P1 | 高 | 6×50MB 图片全量常驻内存致 OOM | routes/tickets.ts:178; lib/ticket-attachments.ts:48 | 降上限 + 有总字节预算的流式上传 |
| D-030 | M19-01 | M19 | P1 | 高 | 订阅到期不停用上游服务，过期仍运行 | services/mail-expiry-scheduler.ts:38 | 可重试上游暂停任务 + 支持 expired 续费/恢复 |
| D-031 | M19-02 | M19 | P1 | 高 | 管理员退款按当前标价非实付致超额退款 | routes/mail.ts:775 | 持久化实付金额，退款依据账单流水 |
| D-032 | M19-03 | M19 | P1 | 高 | 取消订阅先删上游后退款且无锁，部分删除 | routes/mail.ts:793 | 订阅级锁 + 幂等可恢复状态机 |
| D-033 | M19-04 | M19 | P1 | 高 | 年付方案可按任意月续费绕过周期 | routes/mail.ts:1223 | 按 billingCycle 限制，年付仅整年倍数 |
| D-034 | M19-05 | M19 | P1 | 高 | 域名上游创建后本地落库失败无补偿删除 | routes/mail.ts:1501 | 补偿删除 + 补偿失败告警 |
| D-035 | M20-01 | M20 | P1 | 高 | 解冻任务全批同事务，单用户锁冲突回滚全部 | services/hosting-scheduler.ts:55 | 按用户/批次独立事务 + 跳过重试 |
| D-036 | M21-02 | M21 | P1 | 高 | 通用 action 路由只需登录可绕管理员鉴权调支付/交付 | routes/plugins.ts:2325; lib/plugin-runtime.ts:205 | 按 scope/source 强制 actor 授权 |
| D-037 | M21-03 | M21 | P1 | 高 | 到期重试先查后执行无抢占致重复投递 | lib/plugin-runtime.ts:517 | 原子 claim/FOR UPDATE SKIP LOCKED + 运行互斥 |
| D-038 | M21-04 | M21 | P1 | 高 | 发布索引保留旧条目，下架插件仍可见可安装 | lib/plugin-market-publisher.ts:139 | 以 DB 当前可发布集为唯一来源 |
| D-039 | M21-06 | M21 | P1 | 高 | 插件包解压无大小/数量/类型限制，压缩炸弹 | lib/plugin-package.ts:57 | 限条目数/声明尺寸，只允许普通文件，配额流式解压 |
| D-040 | M22-01 | M22 | P1 | 高 | 主题 HTML 净化正则可被实体绕过，v-html 存储型 XSS | lib/theme-package.ts:382; ThemeTemplateSlot.vue:70 | 白名单净化器 + 解码后协议校验 + 攻击守卫 |
| D-041 | M22-02 | M22 | P1 | 高 | 公开 /active 接口返回 password 类型配置 | routes/themes.ts:106; db/themes.ts:77 | 公开专用 DTO 移除密码/秘密字段 |
| D-042 | M22-03 | M22 | P1 | 高 | 主题市场发布保留旧条目，下架主题仍可安装 | lib/theme-market-publisher.ts:112 | 以 DB 当前可发布集重建条目 |
| D-043 | M22-04 | M22 | P1 | 高 | 安装先替换资源后更新 DB，绕过未启用状态 | db/themes.ts:135 | 版本不可变目录 + 原子状态切换 + 失败回滚 |
| D-044 | M22-05 | M22 | P1 | 高 | 主题归档校验无大小/数量限制，压缩炸弹/FIFO | lib/theme-package.ts:350 | 校验条目类型/数量/尺寸，配额解压 |
| D-045 | M23-01 | M23 | P1 | 高 | refresh token 轮换非原子可并发重放多次 | lib/oauth-provider.ts:515 | 行锁或带 revokedAt:null 条件原子消费 |
| D-046 | M23-02 | M23 | P1 | 高 | Public API 写接口限流按 IP 非 token 可绕过 | app.ts:318 | 认证后用 token ID/用户 ID 作限流键 |
| D-047 | M23-03 | M23 | P1 | 高 | SDK 服务操作/续费响应类型与后端不符致示例崩溃 | sdk/payincus-public-api.ts:178 | 以 OpenAPI/真实响应统一类型与示例 |
| D-048 | M24-01 | M24 | P1 | 高 | 套餐收入单位放大 100 倍（分当元） | routes/admin-capacity-cost.ts:415 | 进模型前分转元 + 跨单位守卫 |
| D-049 | M24-02 | M24 | P1 | 高 | 自动快照后置操作失败重试重复创建快照 | services/auto-policy-scheduler.ts:151 | 只重试幂等 Incus 创建 + 幂等键 |
| D-050 | M24-03 | M24 | P1 | 高 | 批量更新非原子先 Incus 后 DB，状态永久分叉 | routes/batch-config.ts:407 | 可恢复状态机 + 补偿/对账 |
| D-051 | M24-04 | M24 | P1 | 高 | 宿主机用量绝对覆盖并发丢失更新 | routes/batch-config.ts:304; db/hosts.ts:485 | 事务内原子 increment 或加锁重算 |
| D-052 | M24-05 | M24 | P1 | 高 | SLA 规则阈值可保存但扫描不读取 | routes/admin-sla-alerts.ts:298 | 扫描以持久化规则为唯一参数 + 行为守卫 |
| D-053 | M25-02 | M25 | P1 | 高 | 自由文本脱敏覆盖不足，pat_/poa_/Basic 进日志 | lib/log-sanitizer.ts:85 | 覆盖全部凭证格式，递归超限整体替换 |
| D-054 | M26-01 | M26 | P1 | 高 | 跨标签 token 变化不清 user/quota 致身份错配 | stores/auth.ts:16; router/user.ts:350 | 原子清空身份态 + 立即重取或整页重载 |
| D-055 | M27-01 | M27 | P1 | 高 | root 单元执行服务用户可写 JS 形成提权链 | scripts/install-panel.sh:1136 | root helper 只执行 root 拥有且不可写的固定产物 |
| D-056 | M25-01,M17-01,M17-07,M18-01,M18-04,M19-07,M21-05,M22-09,M24-06,M24-09 | 横切 | P1 | 高 | 外呼校验后未绑安全 dispatcher，连接期 DNS rebinding SSRF | lib/outbound-security.ts:149 (+调用点) | 不可绕过安全 fetch + 连接期复核 + 禁重定向 |
| D-057 | M27-02,M09-04,M07-05 | 横切 | P1 | 高 | trustProxy 全链信任 + Nginx 追加转发头致 request.ip 可伪造 | nginx-split-intranet.conf.example:57; trust-proxy-config.ts:8 | 仅信任固定跳数/受信网段，最外层覆盖转发头 |
| D-058 | M05-02 | M05 | P1 | 中 | 恢复失败窗口删掉唯一临时副本致实例数据全灭 | workers/restoreTaskWorker.ts:332 | 删临时前确认原实例存在，否则保留并人工介入 |
| D-059 | M06-01 | M06 | P1 | 中 | 资源池申领无主机容量上限校验致超卖 OOM | db/resource-pool.ts:225; routes/resource-pool.ts:184 | 同事务条件更新校验剩余容量，超限回滚 patch |
| D-060 | M12-05 | M12 | P1 | 中 | 秒杀价格 TOCTOU，申领不验证成交价 | services/flash-sales.ts:720 | 价改与申领共用锁 + 绑定价格版本 |
| D-061 | M17-05 | M17 | P1 | 中 | 提示注入 + 信任模型自报 confidence 自动发送 | services/ai-ticket-context.ts:346 | 客户内容标记不可信 + 服务端确定性策略 |
| D-062 | M19-06 | M19 | P1 | 中 | 邮箱账号创建无同域锁致补偿误删他人远端账号 | routes/mail.ts:1719 | 域名+用户名事务锁 + 归属证明幂等标识 |
| D-063 | M20-02 | M20 | P1 | 中 | 托管退款机主余额不足只扣部分仍全额退买家 | db/billing-operations.ts:1496 | 保证机主全额扣款或记欠款账本 |
| D-064 | M01-02 | M01 | P2 | 高 | DANGEROUS_CHARS_REGEX 全局 g 标志有状态致危险字符漏检 | lib/security.ts:214 | 去 g 标志或每次重置 lastIndex |
| D-065 | M01-04 | M01 | P2 | 高 | 邮箱验证码无失败尝试上限可高频撞库 | db/email-verification.ts:94 | 增 attempts 字段与上限，与操作二次验证对齐 |
| D-066 | M02-02 | M02 | P2 | 高 | 管理端用户列表 N+1（逐用户查 2FA/实例/绑定/余额） | routes/users.ts:171 | groupBy/count 批量聚合，实例改计数 |
| D-067 | M04-02 | M04 | P2 | 高 | 到期删除窗口内仍可续费，认领不复核 expiresAt | services/billing-scheduler.ts:468 | 拒 deleted 续费，删除带 version/status 条件 |
| D-068 | M04-03 | M04 | P2 | 高 | 管理员延期日价按 30 天口径与全系统 31 天不一致 | routes/admin-billing.ts:788 | 改用公共 calculateDailyPrice 只舍入一次 |
| D-069 | M04-04 | M04 | P2 | 高 | 管理员延期事务外算基准、更新无 version 锁 | routes/admin-billing.ts:2388 | 基准读取与更新同事务 + version 条件 |
| D-070 | M04-05 | M04 | P2 | 高 | 管理员退款上限事务外 TOCTOU 可超额退款 | routes/admin-billing.ts:2581 | 上限校验移入退款事务 + 实例级锁 |
| D-071 | M04-06 | M04 | P2 | 高 | 删除并退款不回扣托管节点主收入 | routes/admin-billing.ts:2677 | 退款事务复用 deductHostingBalance |
| D-072 | M04-07 | M04 | P2 | 高 | 管理员升级报价事务外、更新无 version 锁 | routes/admin-billing.ts:5383 | 复用 performPlanChange 或补 version 条件 |
| D-073 | M06-02 | M06 | P2 | 高 | 改配绝对覆盖抹掉资源池申领加成致用户资产丢失 | db/billing-operations.ts:906 | 改配并入历史 apply 增量或改配前退回池 |
| D-074 | M08-01 | M08 | P2 | 高 | 转移手续费退款与状态翻转不同事务，失败丢退款 | routes/transfers.ts:763; db/transfers.ts:345 | 退款并入状态翻转同事务或幂等补偿扫描 |
| D-075 | M11-03 | M11 | P2 | 高 | 非所有者可读公开套餐的未启用方案 | routes/packages.ts:2590 | 仅所有者/管理员可读全部，其余强制 isActive |
| D-076 | M11-05 | M11 | P2 | 高 | 无分页公开套餐接口 2N+1 查询 | routes/packages.ts:810 | 批量读取分组 + 公开列表分页/上限 |
| D-077 | M11-06 | M11 | P2 | 高 | 商城加载无请求序号，旧响应覆盖新状态 | MarketView.vue:397 | 递增请求标识/AbortController |
| D-078 | M13-08 | M13 | P2 | 高 | 流量通知发送前占领状态，失败被吞不补发 | services/traffic-scheduler.ts:163 | 带状态租约的通知 outbox，成功后 claim |
| D-079 | M13-09 | M13 | P2 | 高 | 每 CaddyClient 建独立 Agent 无关闭致资源泄漏 | lib/caddy-client.ts:37 | 按宿主缓存复用 Agent 或 finally 关闭 |
| D-080 | M14-04 | M14 | P2 | 高 | 断开审计未捕获异步异常致未处理 rejection | routes/terminal.ts:428 | 关闭回调内显式捕获日志异常 |
| D-081 | M14-05 | M14 | P2 | 高 | 连接上限非原子检查，并发可绕过 | routes/terminal.ts:363 | 建连前原子预留名额，失败路径释放 |
| D-082 | M14-06 | M14 | P2 | 高 | 快捷命令 100 条上限并发竞态 | db/terminal-saved-commands.ts:150 | 事务级用户锁/原子插入条件/DB 约束 |
| D-083 | M15-01 | M15 | P2 | 高 | 实例优惠码验证未检查 enabled，已禁用码仍可用 | db/aff.ts:443 | 所有 AFF 入口统一校验启用状态 |
| D-084 | M15-02 | M15 | P2 | 高 | 双向同时发好友请求竞态创建两条反向关系 | db/friendships.ts:59 | 规范化用户对唯一约束 + 单事务原子 |
| D-085 | M15-03 | M15 | P2 | 高 | 拒绝/删除后重新申请状态机不完整方向错乱 | db/friendships.ts:81 | 重建申请方向 + 定义 removed 复用规则 |
| D-086 | M16-04 | M16 | P2 | 高 | 奖池保存非原子（先删后逐个建）致半成品配置 | EntertainmentView.vue:400 | 后端整池替换事务接口 |
| D-087 | M16-05 | M16 | P2 | 高 | 积分变动未复用上限校验致 Int32 溢出 500 | services/vip-benefits.ts:698; db/checkin.ts:344 | 统一走安全 mutation 校验余额/totalEarned/totalSpent |
| D-088 | M16-08 | M16 | P2 | 高 | 中奖通知 setImmediate 无持久重试易永久丢失 | entertainment.ts:300; lib/lottery-notifier.ts:131 | 抽奖事务写通知 outbox + worker 幂等重试 |
| D-089 | M17-06 | M17 | P2 | 高 | 上传只信 MIME 声明不检查魔数 | lib/ticket-attachments.ts:51; lib/lsky.ts:369 | 验证文件签名 + 受控解码器确认格式 |
| D-090 | M18-02 | M18 | P2 | 高 | Telegram/通知渠道 Bot Token/Webhook 明文落库 | routes/admin-notification-channels.ts:150 | 字段级加密，发送时解密 |
| D-091 | M18-03 | M18 | P2 | 高 | 广播投递与公告记录非同一事务且无幂等 | routes/inbox.ts:221 | 同事务 + 广播幂等键 |
| D-092 | M18-05 | M18 | P2 | 高 | 绑定 Token 消费与 Telegram 绑定写入不同事务 | routes/telegram.ts:960 | 同事务条件消费 + 唯一检查 + upsert |
| D-093 | M18-06 | M18 | P2 | 高 | 全站广播一次性读全部用户无界 createMany | routes/inbox.ts:214 | 游标分批读取与写入 + 进度记录 |
| D-094 | M19-08 | M19 | P2 | 高 | 续费弹窗无条件用 AFF 折扣，后端仅启用时应用致多扣 | MailView.vue:238 | 返回后端计算的当前报价，前端不自行推导 |
| D-095 | M19-09 | M19 | P2 | 高 | SmarterMail 登录响应无大小限制 | services/smartermail.ts:48 | 用统一限长读取后再解析 JSON |
| D-096 | M20-03 | M20 | P2 | 高 | 前后端手续费舍入顺序不同致到账相差 0.01 | HostingWalletView.vue:163; routes/hosting.ts:584 | 统一以分为单位或共享舍入规则 |
| D-097 | M20-04 | M20 | P2 | 高 | 拉黑候选搜索返回其他账户完整邮箱 | routes/hosting.ts:148 | 只返回用户名/UID，邮箱脱敏 |
| D-098 | M20-05 | M20 | P2 | 高 | 托管日志搜索无界查询全部实例 IN | routes/hosting.ts:362 | 关联子查询或分页 + 上限 |
| D-099 | M20-06 | M20 | P2 | 高 | 钱包加载失败吞错显示零值伪装 | HostingWalletView.vue:312 | 保留失败态 + 可重试提示 |
| D-100 | M21-07 | M21 | P2 | 高 | 资源鉴权只匹配入口 HTML，后台 JS 等落公开 | routes/plugins.ts:274 | 按 admin/user 资源根或清单保护整套依赖 |
| D-101 | M21-08 | M21 | P2 | 高 | 多版本字符串排序循环覆盖保留旧版本 | lib/plugin-market-publisher.ts:141 | 按 SemVer 显式选最高版本只写一次 |
| D-102 | M21-09 | M21 | P2 | 高 | 填任意 GitHub 地址即标记 verified | lib/plugin-market-publisher.ts:89 | verified 改独立审核字段 + 所有权证明 |
| D-103 | M22-06 | M22 | P2 | 高 | 启用主题事务无锁致并发多个 enabled=true | db/themes.ts:199 | advisory lock/串行化/唯一约束保证唯一 |
| D-104 | M22-07 | M22 | P2 | 高 | 多版本发布选中最后版本非最新 | lib/theme-market-publisher.ts:114 | 按 SemVer 显式选最高版本 |
| D-105 | M22-08 | M22 | P2 | 高 | 上传/下载包未清理孤儿文件 | routes/admin-themes.ts:138 | finally 清理临时归档 + 定期回收 |
| D-106 | M23-05 | M23 | P2 | 高 | SDK 多核心模型与后端/OpenAPI 契约漂移 | sdk/payincus-public-api.ts:77 | 从 OpenAPI 单源生成/校验 + 逐字段守卫 |
| D-107 | M23-06 | M23 | P2 | 高 | 余额调整 5 个上限 check-then-create 竞态 | routes/public-api.ts:1425 | 用户串行化事务/advisory lock 内复检 |
| D-108 | M23-07 | M23 | P2 | 高 | PAT 创建无用户上限，列表无分页 | routes/api-tokens.ts:70 | 每用户 token 上限 + 有界分页 + 清理 |
| D-109 | M24-07 | M24 | P2 | 高 | 单条告警静默时间扫描不检查 | routes/admin-sla-alerts.ts:766 | 合并前检查事件级 silencedUntil |
| D-110 | M24-08 | M24 | P2 | 高 | 容量概览 GET 含写操作，刷新放大 SLA 触发 | routes/admin-capacity-cost.ts:286 | 快照/同步移入调度任务，GET 只读 |
| D-111 | M25-04 | M25 | P2 | 高 | 审计日志写失败完全吞掉无告警 | db/logs.ts:203 | 事务内审计/outbox + 可监控告警 |
| D-112 | M25-05 | M25 | P2 | 高 | 连接解析固定 ss 列，netstat 回退致错位 | lib/instance-audit.ts:235 | 识别输出来源分别解析 ss/netstat |
| D-113 | M26-02 | M26 | P2 | 高 | 恢复任务轮询无锁致慢请求乱序写回 | stores/restoreTask.ts:91 | 串行递归轮询/单飞锁 + 序号校验 |
| D-114 | M26-03 | M26 | P2 | 高 | 公共配置加载失败保留功能开启默认致失败开放 | stores/config.ts:49 | 区分已加载/失败/启用，未知态安全降级 |
| D-115 | M26-04 | M26 | P2 | 高 | SW 激活删除除当前外全部同源缓存越界 | client/public/sw.js:42 | 只删 incudal-cache- 命名空间旧缓存 |
| D-116 | M26-06 | M26 | P2 | 高 | 全局错误仅写控制台无错误页/提示 | client/src/main.ts:27 | 统一错误边界 + 友好提示 + 受控重试 |
| D-117 | M27-04 | M27 | P2 | 高 | SDK notification template 声明必填但后端允许 title/message | sdk/payincus-public-api.ts:251 | 建模为模板/标题正文的联合类型 |
| D-118 | M25-03,M01-06,M11-04,M12-06,M13-10,M15-04,M16-06,M16-07,M19-10,M23-08 | 横切 | P2 | 高 | apiError 无条件返回 details 泄漏内部异常原文 | lib/errors.ts:700 (+各路由) | 5xx 只返回错误码+通用文案，异常脱敏落日志 |
| D-119 | M23-04,M27-03 | 横切 | P2 | 高 | 余额调整 SDK 暴露后端不识别的 externalReference | sdk/payincus-public-api.ts:116 | 以 OpenAPI/后端为准统一字段 |
| D-120 | M01-03 | M01 | P2 | 中 | verifyRefreshToken 吞异常致 DB 抖动踢用户下线 | lib/security.ts:730; routes/auth.ts:834 | 区分 token 不存在与底层异常 |
| D-121 | M01-05 | M01 | P2 | 中 | 注册先消费验证码后查重名，白耗验证码 | routes/auth.ts:556 | 唯一性预检查移到 verifyCode 之前 |
| D-122 | M02-03 | M02 | P2 | 中 | 邮箱无 DB 唯一约束，应用层先查后写 TOCTOU | routes/users.ts:107; schema.prisma:702 | 加大小写不敏感唯一约束靠 DB 捕获冲突 |
| D-123 | M03-01 | M03 | P2 | 中 | 易支付 verify 金额校验被 paidAmount>0 短路 | routes/recharge.ts:2196 | 与回调一致硬校验，money 缺失/≤0 即拒 |
| D-124 | M03-02 | M03 | P2 | 中 | 兜底验签手写 MD5 非常量时间（死代码/潜伏） | routes/recharge.ts:1216 | 删未实现兜底验签分支或显式抛错 |
| D-125 | M05-03 | M05 | P2 | 中 | 独立 IPv4 预留失败释放分散易漏 | routes/instances.ts:2108 | 收敛到统一补偿函数 |
| D-126 | M05-04 | M05 | P2 | 中 | 端口映射 DB 先于 Incus，依赖唯一约束兜底 | routes/instances.ts:4462 | 自动分配前统一补 checkPortInUse |
| D-127 | M05-05 | M05 | P2 | 中 | 事务后同步步骤抛错无补偿，实例挂 creating | routes/instances.ts:2222 | IP/存储池准备异常纳入即时补偿 |
| D-128 | M05-06 | M05 | P2 | 中 | 销毁后结算抛错丢退款不回滚 | routes/instance-destroy.ts:655 | 结算失败落待补偿队列/告警 |
| D-129 | M05-07 | M05 | P2 | 中 | config 更新 host 资源读旧值覆写致计数漂移 | routes/instances.ts:5301 | 用 calculateHostResourcesFromInstances 重算 |
| D-130 | M07-01 | M07 | P2 | 中 | Agent 自升级允许 http 且响应无签名，MITM 投毒 root 二进制 | config.go:78; upgrade.go:140 | 强制 https 或对升级指令独立签名校验 |
| D-131 | M07-02 | M07 | P2 | 中 | certPath/keyPath 用户任意指定致 SSRF+任意文件读 | routes/hosts.ts:974; incus/certificate-paths.ts:19 | 改服务端内部赋值或白名单目录 |
| D-132 | M07-03 | M07 | P2 | 中 | 恶意宿主机可无上限伪造跨租户流量计费 | services/agent-instance-report.ts:78 | 按心跳间隔/带宽设增量上限，超限丢弃告警 |
| D-133 | M09-02 | M09 | P2 | 中 | 下单限制只在创建实例路径，交易所购买/受让绕过 | services/user-order-restrictions.ts:16 | 交易所购买与受让入口接入限制校验 |
| D-134 | M09-03 | M09 | P2 | 中 | 风险评估先读后写夹带 Incus 调用无锁 TOCTOU | services/resource-risk.ts:429 | 按 instanceId advisory lock 或版本/状态条件 |
| D-135 | M10-02 | M10 | P2 | 中 | footer_telegram_link 无协议校验致存储型 XSS | routes/system-config.ts:401; SideNav.vue:42 | 后端加 http/https 协议白名单校验 |
| D-136 | M17-08 | M17 | P2 | 中 | Lsky providerFileId 为 null 致文件不可回收存储泄漏 | lib/lsky.ts:376 | 无可删标识时拒绝确认成功或保存替代标识 |
| D-137 | M25-06 | M25 | P2 | 中 | CSV 导出无公式注入防护 | routes/logs.ts:35 | 对 =/+/-/@ 起始单元格中和后再转义 |
| D-138 | M25-07 | M25 | P2 | 中 | CORS/Origin 未限协议，null Origin 可放行 | lib/origin-config.ts:8 | 只接受 http/https，拒 null/含凭证来源 |
| D-139 | M26-05 | M26 | P2 | 中 | 六天定时刷新未复用刷新锁，登出后重写 token | client/src/main.ts:115; stores/auth.ts:84 | 刷新统一走单飞服务 + 会话世代校验 |
| D-140 | M04-08 | M04 | P3 | 高 | 订单合并分页 take=page*pageSize 无上限致深分页 | routes/orders.ts:401 | page 设上限或游标/双指针合并分页 |
| D-141 | M04-09 | M04 | P3 | 高 | 订单退款登记不校验状态、上限取请求 amount、查重竞态 | routes/orders.ts:714 | 限定状态 + 上限取 actualAmount + 条件唯一 |
| D-142 | M04-10 | M04 | P3 | 高 | 自动续费预检用原价、实扣折后价致误判失败 | services/billing-scheduler.ts:162 | 预检与实扣统一折后价或去预检 |
| D-143 | M04-12 | M04 | P3 | 高 | 前后端契约不齐，订单页 displayName 后端不返回 | routes/orders.ts:473 | 后端 select 补 displayName 或前端删依赖 |
| D-144 | M05-08 | M05 | P3 | 高 | boost-processes 先写 DB，Incus 失败不抛致漂移 | routes/instances.ts:6001 | Incus 失败回滚 DB 或返回部分失败 |
| D-145 | M07-04 | M07 | P3 | 高 | GET 详情向节点主返回内部证书文件路径 | routes/hosts.ts:2033 | 对齐列表接口去除 certPath/keyPath |
| D-146 | M10-05 | M10 | P3 | 高 | telegram chat_id 脱敏口径不一致明文回管理员 | db/system-config.ts:14; routes/system-config.ts:719 | 纳入 SENSITIVE_CONFIG_KEYS 统一口径 |
| D-147 | M13-12 | M13 | P3 | 高 | 单天历史 X 轴位置计算 NaN% | TrafficStats.vue:341 | 单条记录固定居中位置 |
| D-148 | M15-05 | M15 | P3 | 高 | removed 状态被误显示为"已拒绝" | FriendsView.vue:1056 | 为 removed 增独立文案与时间规则 |
| D-149 | M15-06 | M15 | P3 | 高 | 好友列表资源统计 N+1 | db/friendships.ts:266 | 一次分组聚合批量取实例数 |
| D-150 | M15-07 | M15 | P3 | 高 | 邀请码分页解析不严格（parseInt 宽松） | routes/user-invites.ts:55 | 数字正则 + Number.isSafeInteger + 最大页码 |
| D-151 | M17-09 | M17 | P3 | 高 | 模块加载建永久 setInterval 无句柄/unref | lib/action-ticket.ts:27 | 保存句柄 + 生命周期停止 + unref |
| D-152 | M02-04,M02-05,M11-07,M12-07,M13-11,M14-07,M15-08,M18-07,M26-07 | 横切 | P3 | 高 | i18n 硬编码中文/缺 key/词典不完整强制回退简中 | 各 View + client/src/locales/index.ts:60 | 抽取 i18n key 补齐 en/zh-TW + 守卫递归比对 |
| D-153 | M01-07 | M01 | P3 | 中 | 登录日志打印 password_hash 前缀违反凭证红线 | routes/auth.ts:172 | 移除 hash 相关日志字段 |
| D-154 | M01-08 | M01 | P3 | 中 | 恢复码登录写两条 LOGIN_SUCCESS 致审计重复计数 | routes/auth.ts:288 | 恢复码记为独立事件类型或降级 info |
| D-155 | M02-06 | M02 | P3 | 中 | listLifecycleUsers take:1000 内存过滤分页失真 | db/user-lifecycle.ts:443 | 过滤条件下推查询层 + DB 分页 |
| D-156 | M03-03 | M03 | P3 | 中 | 易支付 V1(MD5) 验签非常量时间 | lib/epay.ts:123 | 等长后 crypto.timingSafeEqual |
| D-157 | M03-04 | M03 | P3 | 中 | 回调 IP 白名单空即全放行、多渠道套同一列表 | routes/recharge.ts:341 | 每渠道独立可配 IP 段，默认不因空放行 |
| D-158 | M04-11 | M04 | P3 | 中 | 过期续费 periodStart 记旧值致账期长于实付天数 | db/billing-operations.ts:352 | periodStart 与 baseDate 同源 |
| D-159 | M04-13 | M04 | P3 | 中 | 降级退款不被 maxRefundable 扣减（埋雷双重套取） | db/billing-operations.ts:870 | 降级账单记 refund/负金额或删不可达分支 |
| D-160 | M05-09 | M05 | P3 | 中 | nat_ipv4 分配失败静默降级动态 IP | routes/instances.ts:2081 | 按网络模式返回明确错误或扩地址池 |
| D-161 | M06-03 | M06 | P3 | 中 | 资源池申领先 patch Incus 后落库，崩溃漂移无对账 | routes/resource-pool.ts:176 | 增轻量对账或纳入可重放任务 |
| D-162 | M07-06 | M07 | P3 | 中 | 一次性口令置 URL 路径 + 同信道明文 secret 日志泄漏面 | routes/agent.ts:1036 | 改 Authorization 头/POST body + 禁访问日志 |
| D-163 | M09-05 | M09 | P3 | 中 | 下单限制非原子、无唯一约束致重复 active | services/user-order-restrictions.ts:57 | advisory lock 或 (userId,active) 部分唯一索引 |
| D-164 | M09-06 | M09 | P3 | 中 | 自动风控动作不写中心审计 Log | services/resource-risk.ts:425 | 自动处置也写中心 Log（actor 记系统） |
| D-165 | M10-03 | M10 | P3 | 中 | OTA /start 不比对版本先后允许降级到旧版本 | lib/system-version.ts:66; routes/system-update.ts:184 | 增"目标≥当前"语义比较，降级走显式确认 |
| D-166 | M10-04 | M10 | P3 | 中 | avatar_api_base 无 URL 校验致客户端 SSRF | routes/system-config.ts:404; UserAvatar.vue:89 | 加 https URL 校验与长度上限 |
| D-167 | M01-10,M08-02,M10-06 | 横切 | P3 | 中 | 内存态 Map（登录锁/nonce/交割去重/配置缓存）多进程失效 | lib/security.ts:30; config-cache.ts:16 | 确认单实例假设或下沉共享存储/变更失效 |
| D-168 | M01-09 | M01 | P3 | 低 | 2FA 加密键非生产回退可预测密钥 | lib/security.ts:1032 | 生产强制独立 ENCRYPTION_KEY，去字面量回退 |
| D-169 | M03-05 | M03 | P3 | 低 | 管理员手动完成充值金额仅校验>0 无上限 | routes/recharge.ts:3021 | 设上限并默认取订单应入账金额 |
| D-170 | M03-06 | M03 | P3 | 低 | 解密失败静默返回原密文致渠道校验被吞 | lib/security.ts:1083 | 区分合法明文旧数据与真实失败并告警 |
| D-171 | M06-04 | M06 | P3 | 低 | /apply amount 无上限致 bigint 溢出/Number 精度丢失 | routes/resource-pool.ts:126; db/resource-pool.ts:32 | amount 加 maximum，余额展示用字符串透传 |
| D-172 | M07-07 | M07 | P3 | 低 | FRONTEND_URL 缺省时 panelUrl 从转发头推导 | routes/agent.ts:325 | 生产强制以 FRONTEND_URL 为唯一可信来源 |
| D-173 | M08-03 | M08 | P3 | 低 | executeTransfer/回滚无条件写不复检状态 | db/transfers.ts:557; routes/transfers.ts:493 | 加 status:processing 条件式更新，超时避开过户中 |
| D-174 | M08-04 | M08 | P3 | 低 | 全链金额用 JS number 精度隐患 | services/exchange.ts:95 | 资金计算尽量在 Prisma.Decimal 层完成 |
| D-175 | M09-07 | M09 | P3 | 低 | applyQosLimit 两步非原子，崩溃污染 originalIngress | services/resource-risk.ts:333 | 限速变更与 original 落库同事务或先持久化 |

---

## 五、建议修复波次

> 结合 `MAINTENANCE_PLAN.md` 风险分档（A 档高危 Claude 定根因+收紧规格→codex 实现→Claude 逐行审+守卫+真机；B 档 codex 端到端+Claude 审；C 档 codex 主力快审）与 `AGENTS.md §7-8`。
> 排序原则：致命/严重先行 → 按模块聚类减少反复打开同一文件 → 横切根因优先（一次修复消灭多处）。**本节仅为建议顺序，未执行任何修复。**

### 波次 0（立即，安全阻断）— A 档
- **D-001（P0 插件 iframe 会话接管）**：单点最高危，先隔离域名/去 allow-same-origin。
- **D-056（横切外呼 SSRF）** + **D-057（横切 trustProxy/XFF）** + **D-053（脱敏不足）**：三条安全基线横切，修根因即批量收敛 M17/M18/M19/M21/M22/M24/M25/M09/M07。
- **D-007（管理员自提权 OTA）** + **D-055（root 提权链）**：击穿"OTA owner-only"边界，需 owner 参与专项收紧。

### 波次 1（横切根因，一改多消）
- **D-118（apiError 泄漏，改 errors.ts 根因 + 9 处调用点）**、**D-152（i18n 横切）**、**D-167（内存态多进程假设文档化）**。
- 硬删除级联族：**D-003 / D-004 / D-024 / D-025**（M02/M04/M16 schema + 调度器，改软删/快照）。

### 波次 2（资金/计费一致性）— A 档，按模块聚类
- M04 计费：**D-067 ~ D-072**（管理端延期/退款/升级事务与 version 锁，同一文件 admin-billing.ts 一次改完）+ **D-159/D-158/D-142/D-141/D-140/D-143**。
- M19 邮箱托管：**D-030 ~ D-034 / D-062 / D-094 / D-095**（mail.ts 集中）。
- M20 Hosting：**D-035 / D-063 / D-096 ~ D-099**。
- M08 转账/M06 资源池：**D-074 / D-073 / D-059 / D-161 / D-171**。

### 波次 3（实例/网络/终端生命周期与竞态）— A/B 档
- M13 网络流量（缺陷密度最高）：**D-014 ~ D-020 / D-078 / D-079 / D-147**（caddy-client.ts、traffic、proxy-sites 聚类）。
- M05 实例：**D-005 / D-058 / D-125 ~ D-129 / D-144 / D-160**。
- M14 终端：**D-021 ~ D-023 / D-080 ~ D-082**（terminal.ts、terminal-proxy.ts 聚类）。
- M09 风控：**D-006 / D-134 / D-133 / D-163 / D-164 / D-175**。

### 波次 4（B 档业务模块）
- M12 秒杀兑换：**D-010 ~ D-013 / D-060**；M16 游戏化：**D-026 / D-086 ~ D-088**。
- M21 插件：**D-036 ~ D-039 / D-100 ~ D-102**；M22 主题：**D-040 ~ D-044 / D-103 ~ D-105**。
- M17 工单：**D-027 ~ D-029 / D-061 / D-089 / D-136 / D-151**；M18 通知：**D-090 ~ D-093**。
- M23 Public API/SDK：**D-045 ~ D-047 / D-106 ~ D-108 / D-119 / D-117**；M24 运营台：**D-048 ~ D-052 / D-109 / D-110**。
- M11 商城：**D-008 / D-009 / D-075 ~ D-077**；M15 邀请好友：**D-083 ~ D-085 / D-148 ~ D-150**。

### 波次 5（C 档打磨 / 低危）
- M26 前端基座：**D-054 / D-113 ~ D-116 / D-139**（注意表格布局守卫红线）。
- M01 认证残项、M03 支付纵深、M07 Agent 硬化、M25 日志、M10 配置校验：**D-064 / D-065 / D-120 ~ D-124 / D-130 ~ D-132 / D-135 / D-137 / D-138 / D-146 / D-153 ~ D-157 / D-162 / D-165 / D-166 / D-168 ~ D-174**。

> **护栏重申（AGENTS.md）**：修复期不做大重构；表格布局守卫清单内的表绝不改横向滚动；UI 仅动样式/文案；每完成一条即跑相关守卫（`test:frontend-route-guards` / `test:frontend-i18n-keys` / 相关后端守卫）；commit/发版/OTA 一律等 owner 明确指令。

---

## 六、真实用户报错补充缺陷（27 模块静态审计未覆盖，由 owner 反馈补入）

| D-### | 模块 | 严重度 | 置信度 | 问题（一句话） | 文件:行 | 状态 |
|-------|------|--------|--------|----------------|---------|------|
| D-176 | M04/M16 | P1 | 高 | 用户级「累计消费」`getUsersTotalConsumeMap` 只 `SUM(type='consume')`、不扣退款，导致「消费→退款→再消费」（如实例创建失败自动退款+重试）累计消费虚高，进而虚增可兑换积分与 VIP 等级 | server/src/db/balance.ts:543 | ✅ **已修复（2026-07-11）** |

**D-176 详情**
- **来源**：owner 反馈真实用户钱包流水（消费 -2.50 → 实例创建失败自动退款 +2.50 → 再消费 -2.50），累计消费被算成 5.00（应为 2.50）。
- **根因**：`getUsersTotalConsumeMap` 的原 SQL `WHERE type = 'consume'` 完全不减退款；而同文件实例级 `getInstanceRefundableAmount`（`consume − refund`）口径正确，用户级漏了这步。
- **影响面**：喂给 ① 可兑换积分 `db/points.ts:111/139`（`convertiblePoints = (totalConsume − 已兑) × 100`，可刷分——`gift-cards.ts:217` 注释已自证担心此处刷分）② VIP 等级 `services/vip-levels.ts:670` ③ 管理端用户列表 `routes/users.ts:212`。
- **修法**：净消费 = `SUM(consume) − SUM(refund WHERE instance_id IS NOT NULL)`，仅扣「挂实例」的退款（实例创建失败/销毁/降级冲正），**不扣**充值退款/管理员调账退款（`type='refund'` 但 `instance_id` 为空），`GREATEST(...,0)` 兜底。与实例级口径一致。
- **验证**：`server type-check` 通过；`test:recharge-accounting-guards`、`test:points-mutation-amount-guards` 通过；真 Postgres 合成数据验证报告场景 5.00→2.50、控制组（充值退款不误减/纯消费回归/全退光归零）全 PASS。
- **存量数据**：owner 决定「向前修正、既往不咎」（装机量小），不回刷历史已多兑积分/已升 VIP 的用户。
- **未做**：完整 app 流程（创建失败→退款→重建）需整套 Incus/宿主机栈,本地不可跑;已用真 Postgres + 守卫验证会计 SQL 本身。
