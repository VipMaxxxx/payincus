# M21 审计报告
## 结论摘要
插件平台具备基础的包路径校验、能力审核和事件去重机制，但浏览器执行隔离与运行时授权边界存在严重缺口。最严重的是同源插件 iframe 可突破沙箱并接管当前会话，以及普通用户可绕过专用管理路由直接调用支付网关、资源交付类 action。

## 发现清单
- [M21-01] P0 | 置信度 高 | client/src/components/plugins/PluginFrame.vue:93
  - 问题:插件 HTML 与主站同源加载，同时 iframe 开启 `allow-scripts allow-same-origin`；恶意插件脚本可以访问父窗口 DOM、存储及同源接口，并可移除 iframe 的 sandbox 后重新加载。
  - 证据:`:src="frameUrl"` 使用 `/api/plugins/assets/...` 同源地址，且 `sandbox="allow-forms allow-scripts allow-same-origin"`。
  - 影响:已启用的恶意插件可窃取用户或管理员前端凭证、读取页面数据、冒用当前会话执行敏感操作；后台插件可能导致管理员会话完全失陷。
  - 修复建议:将插件页面托管到独立无凭证域并移除 `allow-same-origin`，仅通过严格校验的 `postMessage` 能力桥通信。

- [M21-02] P1 | 置信度 高 | server/src/routes/plugins.ts:2325
  - 问题:通用 action 路由只要求普通用户登录，能够直接调用 manifest 中任意 action；运行时仅验证 manifest 自己是否声明了 scope，没有根据 actor 角色限制支付网关或资源交付类高权限 action。
  - 证据:`onRequest: [fastify.authenticateUser]` 后直接调用 `executePluginAction`；`plugin-runtime.ts:205-214` 的 `assertActionPermissions` 只检查 `permissions.has(scope)`。与此同时，`plugin-manifest.ts:93-125` 定义了 `service-extension:provision`、`gateway-extension:create-payment`、`gateway-extension:refund` 等高权限 scope，而专用路由使用的是 `authenticateAdmin`。
  - 影响:普通用户只要知道 action 名称，就可能绕过 `/gateway-actions`、`/service-actions` 的管理员鉴权，向插件 webhook 发起任意支付、退款、交付或终止请求。
  - 修复建议:通用 action 路由按 scope/source 强制 actor 授权，并禁止用户入口调用仅供 gateway/service/system dispatcher 使用的 action。

- [M21-03] P1 | 置信度 高 | server/src/lib/plugin-runtime.ts:517
  - 问题:到期重试采用“先查询、后执行、再更新”，没有抢占状态、条件更新、事务锁或 advisory lock；定时器、手工重试及多个进程可同时取得同一日志并重复投递。
  - 证据:`findMany` 在 518-527 行选出所有 `retry_pending`，随后 532-533 行直接 `replayPluginEventLog(log.id)`；重放在 423 行仅 `findUnique`，直到 webhook 执行完成后才于 454 行更新。`plugin-event-retry-scheduler.ts:269-276` 的 `setInterval` 也没有防止上一次批次仍在运行。
  - 影响:同一订单、支付或资源事件可能被插件 webhook 重复处理；并发失败还会互相覆盖 `retryCount`、提前死信或产生错误重试统计。
  - 修复建议:在数据库中原子 claim 到期记录，使用带旧状态/版本条件的更新或 `FOR UPDATE SKIP LOCKED`，并为单进程调度增加运行中互斥。

- [M21-04] P1 | 置信度 高 | server/src/lib/plugin-market-publisher.ts:139
  - 问题:发布市场索引时先无条件保留旧索引中的全部条目，再覆盖当前已列出的提交；已被 `delisted` 或 `rejected` 的插件不会从索引移除。
  - 证据:151-154 行把 `existingEntries` 全部写入 `entriesById`，155-157 行只覆盖 `listedSubmissions`，最终 160、174 行将整个 Map 重新发布。
  - 影响:管理员执行下架或拒绝后，旧插件仍对用户可见且可继续安装，市场治理操作失效。
  - 修复建议:以数据库当前可发布集合为唯一来源，或在合并旧索引时显式删除不再 listed 的插件 ID。

- [M21-05] P1 | 置信度 高 | server/src/lib/plugin-market-submission-scan.ts:74
  - 问题:提交扫描下载仅在请求前调用 `assertSafeHttpUrl`，实际 `fetch` 未使用连接阶段复核地址的 `safeOutboundDispatcher`，存在 DNS rebinding 的 SSRF 窗口。
  - 证据:75 行执行 `assertSafeHttpUrl`，80-88 行直接 `fetch(safeUrl, ...)`，没有 dispatcher；相对地，`plugin-runtime.ts:278-280` 明确使用 `dispatcher: safeOutboundDispatcher` 消除同类窗口。
  - 影响:提交者可借扫描任务访问本机、内网或云元数据地址，并通过 HTTP 状态、响应内容和扫描结果探测内部服务。
  - 修复建议:所有市场 manifest/package 下载统一走 outbound-security 的安全 dispatcher，并在每次连接及重定向时复核目标地址。

- [M21-06] P1 | 置信度 高 | server/src/lib/plugin-package.ts:57
  - 问题:插件包校验只拒绝软链接、硬链接和路径穿越，没有限制解压后总大小、文件数量或特殊文件类型；随后直接调用系统 `tar` 解压。
  - 证据:63 行只禁止 `l`、`h` 类型，69-75 行仅遍历列表校验路径，87 行执行 `tar -xzf`，未设置展开大小/文件数配额，也未拒绝 FIFO、设备文件等类型。
  - 影响:很小的压缩包可展开占满磁盘；特殊文件还可能使后续 `readFile` 或资源请求阻塞，造成后台服务不可用。
  - 修复建议:解压前统计并限制条目数与声明大小，只允许普通文件和目录，并在受限临时目录中按总字节配额流式解压。

- [M21-07] P2 | 置信度 高 | server/src/routes/plugins.ts:274
  - 问题:资源鉴权只匹配 manifest 中入口 HTML 的精确路径，后台入口引用的 JS、JSON、source map 等同目录资源会落入公开策略。
  - 证据:`getProtectedAssetPolicy` 在 278-288 行仅比较 `page.entry === assetPath`，其他路径于 290 行返回 `{ requiresAuth: false, adminOnly: false }`；资产路由 2412-2426 行据此跳过鉴权并直接发送文件。
  - 影响:未登录用户可下载后台插件客户端代码和静态数据，造成 client-boundary 泄漏；若包内误带配置、调试文件或 source map，泄漏范围进一步扩大。
  - 修复建议:按 admin/user 资源根或构建清单保护整套依赖资源，而不是只保护入口 HTML。

- [M21-08] P2 | 置信度 高 | server/src/lib/plugin-market-publisher.ts:141
  - 问题:同一插件存在多个 listed 版本时，查询按版本字符串降序排列，但循环不断覆盖 Map，最终保留的是最后一条，即通常更旧的版本；字符串排序也不符合语义化版本顺序。
  - 证据:146 行使用 `orderBy: [{ pluginId: 'asc' }, { version: 'desc' }]`，155-157 行对每个提交执行 `entriesById.set(submission.pluginId, ...)`。
  - 影响:发布索引可能把插件回退到较旧版本，例如 `1.10.0` 与 `1.9.0` 的选择结果错误，用户无法获得预期的新版本。
  - 修复建议:按解析后的语义化版本显式选出每个 pluginId 的最高版本，并只写入一次。

- [M21-09] P2 | 置信度 高 | server/src/lib/plugin-market-publisher.ts:89
  - 问题:只要提交者填写任意非空 GitHub HTTPS 地址，发布器就把开发者标记为 `verified`，没有账号归属验证或审核字段。
  - 证据:102 行设置 `trustLevel: submission.developerGithub ? 'verified' : 'third_party'`，107 行设置 `verified: Boolean(submission.developerGithub)`；提交路由仅在 `plugin-market-submissions.ts:231-232` 校验其为 HTTPS URL。
  - 影响:攻击者可填写他人的 GitHub 地址，在市场中获得“已验证开发者”标识，误导管理员和用户信任恶意插件。
  - 修复建议:将验证状态改为独立、仅审核方可写且带所有权证明的字段，不能从自报链接推导。
