# M23 审计报告
## 结论摘要
Public API 的资源归属校验整体较完整，多数查询都绑定了 token 的 `userId`，插件外呼也使用了 outbound-security。主要风险集中在 OAuth refresh token 并发重放、写接口限流可绕过，以及 SDK 与真实响应严重漂移；其中官方服务操作示例会在成功响应后直接崩溃。

## 发现清单
- [M23-01] P1 | 置信度 高 | server/src/lib/oauth-provider.ts:515
  - 问题:refresh token 轮换不是原子“仅未吊销时消费”，同一个 refresh token 可被并发兑换多次。
  - 证据:事务先执行 `findUnique` 并检查 `if (refreshToken.revokedAt)`，随后使用 `update({ where: { id: refreshToken.id }, data: { revokedAt: ... } })`；更新条件没有包含 `revokedAt: null`，也没有检查条件更新计数。两个并发事务可同时读到未吊销状态，依次更新同一行，并各自创建新的 access/refresh token（第 529-559 行）。
  - 影响:refresh token 被窃取或重复提交时，攻击者与合法客户端可能同时获得不同且均有效的 `poa_`/refresh token 链，轮换机制无法阻止重放。
  - 修复建议:在事务内通过行锁或带 `revokedAt: null` 条件的原子更新消费旧 token，并且只有更新成功者可以签发下一组 token。

- [M23-02] P1 | 置信度 高 | server/src/app.ts:318
  - 问题:Public API 写接口的 Fastify 限流全部按 IP，而不是按 `pat_`/`poa_` token 或用户计数。
  - 证据:`keyGenerator` 只返回 `${request.ip}:${rule.path}` 或 `request.ip`；例如续费、工单、通知和服务操作虽然配置了独立 `rateLimit`（`public-api.ts` 第 41-51、1902-1904、1999-2001 行），仍复用该 IP 键。
  - 影响:持有 token 的调用方可通过代理池切换 IP 绕过续费、工单和通知等写接口配额；反过来，共享 NAT 出口的不同用户会互相消耗额度。插件 action 的数据库动态配额不受此问题影响，但其他写接口没有第二层 token 配额。
  - 修复建议:Public API 在认证后使用稳定的 token 来源与 token ID（必要时叠加用户 ID）作为限流键，IP 仅作为额外防滥用维度。

- [M23-03] P1 | 置信度 高 | docs-site/docs/public/sdk/payincus-public-api.ts:178
  - 问题:SDK 对服务操作和续费成功响应的类型定义与后端实际结构完全不同。
  - 证据:SDK 将操作结果定义为 `{ task: PayIncusServiceTask }`，将续费结果定义为 `{ service, billingRecord? }`；后端操作响应实际是扁平的 `{ serviceId, action, taskId, taskType, status }`（`public-api.ts` 第 1972-1979 行），续费响应是 `{ serviceId, months, amount, discountAmount, newExpiresAt }`（第 2077-2084 行）。官方示例还直接执行 `queued.data.task.id`（`examples/service-power-task.ts` 第 34 行）。
  - 影响:按 SDK 类型和官方示例集成时，服务操作成功后会因 `task` 为 `undefined` 而崩溃；续费调用方也会得到不存在的 `service` 和 `billingRecord`。
  - 修复建议:以 OpenAPI 和真实响应为准统一 SDK 类型、方法返回值及全部示例。

- [M23-04] P2 | 置信度 高 | docs-site/docs/public/sdk/payincus-public-api.ts:116
  - 问题:SDK 暴露并在官方示例中发送 `externalReference`，但后端不识别该字段。
  - 证据:SDK 输入类型只有 `amount`、`reason`、`externalReference`；示例发送 `externalReference`（`examples/balance-adjustment-request.ts` 第 12-16 行）。后端实际读取的是 `requestType` 和 `orderNo`（`public-api.ts` 第 1411-1414、1437-1445 行），OpenAPI 同样只声明 `orderNo` 且设置 `additionalProperties: false`。
  - 影响:SDK 用户以为外部关联号已被保存，实际字段被静默忽略，后续无法用该引用对账或追踪申请。
  - 修复建议:统一字段为 `orderNo` 或明确映射 `externalReference`，并使 SDK、示例和 OpenAPI 使用同一名称。

- [M23-05] P2 | 置信度 高 | docs-site/docs/public/sdk/payincus-public-api.ts:77
  - 问题:SDK 多个核心数据模型与后端/OpenAPI 契约漂移。
  - 证据:SDK 声明 profile 必有 `status`，但 `/me` 不返回该字段；声明余额、流水、调账和订单金额为 `string`，后端通过 `toMoney()` 返回 `number`；订单声明 `type`，后端返回 `sourceType`；`getPluginActions()` 声明 `data` 是 action 数组，后端实际返回包含 `pluginId/name/version/description/actions` 的对象（`public-api.ts` 第 2816-2823 行）；scope metadata 的 `notes` 也被 SDK 声明为字符串，而实现返回字符串数组。
  - 影响:TypeScript 会错误放行不存在字段和错误类型，调用方可能出现 `undefined`、字符串方法异常或无法读取插件 action。
  - 修复建议:从 OpenAPI 单一来源生成或校验 SDK 类型，并增加逐字段响应契约守卫，而非只检查方法名称是否存在。

- [M23-06] P2 | 置信度 高 | server/src/routes/public-api.ts:1425
  - 问题:每用户最多 5 个待审批余额调整申请的限制存在检查后创建竞态。
  - 证据:代码先独立执行 `count()`，仅在 `pendingCount >= 5` 时拒绝，随后在事务外调用 `createBalanceAdjustmentRequest()`；数据库模型没有约束能够保证该上限。
  - 影响:多个并发请求都可能观察到相同的低计数并全部创建成功，突破待审批上限，造成后台审批队列滥用；结合按 IP 限流还可通过多出口放大。
  - 修复建议:将计数与创建放入按用户串行化的事务或 advisory lock 中，并在锁内重新检查上限。

- [M23-07] P2 | 置信度 高 | server/src/routes/api-tokens.ts:70
  - 问题:PAT 创建数量没有用户级上限，列表接口也没有分页或数量限制。
  - 证据:创建路由每次都直接 `publicApiToken.create()`，未统计现有 token；列表使用 `findMany({ where: { userId } })`，没有 `take`、游标或过期/吊销过滤。Prisma 模型仅对 token hash 唯一，没有用户数量约束。
  - 影响:任意已登录用户可持续制造 token 记录，使 token 列表响应和数据库索引无限增长，形成持久化存储及查询放大。
  - 修复建议:设置每用户 active/总 token 上限，并为列表增加有界分页及历史 token 清理策略。

- [M23-08] P2 | 置信度 中 | server/src/routes/public-api.ts:983
  - 问题:Public API 服务任务和部分写接口会把底层异常原文直接暴露给 token 调用方。
  - 证据:任务序列化直接返回 `error: task.error`；worker 将捕获到的原始 `err.message` 写入该字段（`instanceTaskWorker.ts` 第 671-680 行）。续费和插件 action 也分别将捕获的 `message` 直接放入响应（`public-api.ts` 第 2086-2096、2890-2893 行）。
  - 影响:Incus、数据库、网络或插件运行时异常可能泄露内部主机名、调用细节或配置状态，同时向用户暴露不稳定且不友好的错误文本。
  - 修复建议:对外只返回稳定错误码和脱敏文案，原始异常仅写入受控内部日志并关联 request ID。
