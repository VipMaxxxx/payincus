# Public API SDK

PayIncus Public API SDK 是给第三方扩展后端和外部集成使用的轻量 TypeScript 客户端。SDK 不依赖 PayIncus 内部前后台接口，只调用 `/api/v1` 和 Bearer token。

当前下载地址：

```text
https://payincus.com/sdk/payincus-public-api.ts
```

可直接下载的示例：

```text
https://payincus.com/sdk/examples/service-power-task.ts
https://payincus.com/sdk/examples/service-renew.ts
https://payincus.com/sdk/examples/flash-sale-action.ts
https://payincus.com/sdk/examples/balance-adjustment-request.ts
https://payincus.com/sdk/examples/billing-records.ts
https://payincus.com/sdk/examples/oauth-authorization-code.ts
```

也可以在本仓库直接查看：

```text
docs-site/docs/public/sdk/payincus-public-api.ts
docs-site/docs/public/sdk/examples/service-power-task.ts
docs-site/docs/public/sdk/examples/service-renew.ts
docs-site/docs/public/sdk/examples/flash-sale-action.ts
docs-site/docs/public/sdk/examples/balance-adjustment-request.ts
docs-site/docs/public/sdk/examples/billing-records.ts
docs-site/docs/public/sdk/examples/oauth-authorization-code.ts
```

## 使用方式

```ts
import { readFile } from 'node:fs/promises'
import { PayIncusPublicApiClient } from './payincus-public-api'

const client = new PayIncusPublicApiClient({
  baseUrl: 'https://panel.example.com',
  token: process.env.PAYINCUS_API_TOKEN!
})

const profile = await client.getProfile()
const scopes = await client.listOAuthScopes()
const balance = await client.getBalance()
const balanceLogs = await client.listBalanceLogs({ page: 1, pageSize: 20, sort: '-createdAt' })
const billingRecords = await client.listBillingRecords({ page: 1, pageSize: 20, sort: '-createdAt' })
const products = await client.listProducts({ page: 1, pageSize: 20, sort: '-createdAt' })
const orders = await client.listOrders({ status: 'completed' })
const order = orders.data[0] ? await client.getOrder(orders.data[0].id) : null
const unread = await client.getUnreadNotificationCount()
const pluginActions = await client.listPluginActions({ page: 1, pageSize: 20, sort: 'pluginId' })

const ticket = await client.createTicket({
  subject: '秒杀订单咨询',
  category: 'billing',
  priority: 'normal',
  content: '我需要确认这次秒杀订单的支付状态。'
})

const screenshot = new Blob([await readFile('./proof.png')], { type: 'image/png' })
await client.replyToTicket(ticket.data.id, {
  content: '补充一张支付截图。',
  attachments: [{ blob: screenshot, filename: 'proof.png' }]
})

await client.replyToTicket(ticket.data.id, '已经收到，我会等待处理结果。')
await client.updateTicketStatus(ticket.data.id, 'close')

await client.sendNotification({
  template: 'flash_sale_reminder',
  variables: {
    campaignName: '夏季秒杀',
    startsAt: '20:00',
    productName: 'LXC 4G 套餐'
  },
  source: 'Flash Sale Extension'
})
```

## 示例代码

`service-power-task.ts` 演示第三方系统如何用 `services:read` 和 `services:operate` scope 读取当前 token 用户自己的服务、排队 `restart` 电源任务，并通过 `getServiceTask()` 轮询任务直到完成或失败。示例只使用 `start`、`stop`、`restart` 公开电源任务，不开放暂停、恢复、重装、删除、迁移或资源交付。需要续费时使用 `services:billing` scope 和 SDK 的 `renewService(id, months)`，平台会复用内部续费事务，不接受任意金额或直接余额扣款。

`service-renew.ts` 演示第三方系统如何用 `services:billing` scope 续费当前 token 用户自己的付费服务。示例需要显式传入 `PAYINCUS_SERVICE_ID`，会触发真实余额扣款和续费账单，不用于试探任意金额、跨用户服务或资源交付。

```bash
PAYINCUS_BASE_URL=https://panel.example.com \
PAYINCUS_API_TOKEN=pat_xxx \
tsx service-power-task.ts
```

`flash-sale-action.ts` 演示秒杀类扩展后端如何调用已启用扩展的公开 action：先读取当前 token 用户 profile，生成稳定 `idempotencyKey`，再调用 `dispatchPluginAction(pluginId, 'reserveStock', input)`，成功后给当前用户发送受控站内通知；如果 action 失败，示例会创建一条当前用户自己的公开工单。示例不会指定其他用户、不会调用 `/api/admin/*`，也不会直接写订单、支付、余额或实例状态。

```bash
PAYINCUS_BASE_URL=https://panel.example.com \
PAYINCUS_API_TOKEN=pat_xxx \
FLASH_SALE_PLUGIN_ID=com.example.flash-sale \
FLASH_SALE_CAMPAIGN_ID=summer-2026 \
FLASH_SALE_SKU=vps-basic \
tsx flash-sale-action.ts
```

`balance-adjustment-request.ts` 演示第三方系统如何用 `balance:write` scope 给当前 token 用户提交待审批余额调整申请，并只读取自己通过 Public API 提交的待处理申请。示例不会直接改余额、余额流水、支付或充值订单。

```bash
PAYINCUS_BASE_URL=https://panel.example.com \
PAYINCUS_API_TOKEN=pat_xxx \
PAYINCUS_ADJUSTMENT_AMOUNT=10 \
PAYINCUS_ADJUSTMENT_REASON="Flash sale compensation review request." \
tsx balance-adjustment-request.ts
```

`billing-records.ts` 演示第三方系统如何用 `billing:read` scope 读取当前 token 用户自己的实例计费记录，并按可选 `serviceId` 过滤。示例不会读取余额流水对象、支付回调、provider payload 或其他用户账单。

```bash
PAYINCUS_BASE_URL=https://panel.example.com \
PAYINCUS_API_TOKEN=pat_xxx \
PAYINCUS_SERVICE_ID=123 \
tsx billing-records.ts
```

`oauth-authorization-code.ts` 演示第三方服务端如何生成 OAuth 授权 URL、校验 `state`、用 authorization code 换取 `poa_` access token 和 `por_` refresh token、调用 Public API SDK 读取当前授权用户资料，并执行 refresh token 轮换。该示例必须运行在第三方后端，`PAYINCUS_OAUTH_CLIENT_SECRET` 不应放进浏览器、移动端或扩展 iframe。

```bash
PAYINCUS_BASE_URL=https://panel.example.com \
PAYINCUS_OAUTH_CLIENT_ID=pocli_xxx \
PAYINCUS_OAUTH_CLIENT_SECRET=posec_xxx \
PAYINCUS_OAUTH_REDIRECT_URI=https://example.com/oauth/callback \
PAYINCUS_OAUTH_STATE_SECRET="$(openssl rand -base64 32)" \
tsx oauth-authorization-code.ts
```

## Token 来源

SDK 接受两类 Bearer token：

- `pat_`：用户在 PayIncus 后台创建的 API Token。
- `poa_`：OAuth Provider authorization code 流程换取的 access token。

Token 需要声明最小 scope。当前 SDK 覆盖的 scope：

- `profile:read`
- `profile:write`
- `balance:read`
- `balance:write`
- `billing:read`
- `products:read`
- `services:read`
- `services:operate`
- `services:billing`
- `orders:read`
- `tickets:read`
- `tickets:write`
- `notifications:read`
- `notifications:send`
- `plugins:action`

`listOAuthScopes()` 会读取 `GET /api/oauth-provider/scopes`，返回 `scope`、`title`、`description`、`risk`、`access`、`resources`、`implemented` 和 `notes`。第三方应用可以用它生成授权申请说明或内部权限审核清单，不需要在客户端硬编码 scope 描述。

## 当前能力

SDK 当前封装：

- `listOAuthScopes()`
- `getProfile()`
- `updateProfile({ avatarStyle })`
- `getBalance()`
- `listBalanceLogs()`
- `listBalanceAdjustmentRequests()` / `createBalanceAdjustmentRequest(input)`
- `listBillingRecords()` / `getBillingRecord(id)`
- `listProducts()` / `getProduct(id)`
- `listServices()` / `getService(id)`
- `queueServiceAction(id, action)`，`action` 只支持 `start`、`stop`、`restart`
- `getServiceTask(id, taskId)`
- `cancelServiceTask(id, taskId)`
- `listOrders()`
- `getOrder(id)`
- `listTickets()` / `getTicket(id)`
- `createTicket(input)`
- `replyToTicket(id, content)`
- `updateTicketStatus(id, action)`
- `listNotifications()`
- `getUnreadNotificationCount()`
- `sendNotification(input)`
- `listPluginActions()`
- `getPluginActions(pluginId)`
- `dispatchPluginAction(pluginId, action, input)`

这些方法只覆盖已经开放的稳定 Public API。SDK 不会调用 `/api/admin/*`，不会访问内部数据库，也不会绕过扩展 manifest、权限、审计、支付、余额、实例交付或风控链路。所有列表方法都支持统一 `page`、`pageSize` 和白名单 `sort`；响应的 `meta.sort` 会返回实际采用的排序。通用时间排序只接受 `createdAt` 或 `-createdAt`，工单列表额外支持 `updatedAt` / `-updatedAt`，服务列表额外支持 `displayOrder` / `-displayOrder`，扩展 action 目录额外支持 `pluginId` / `-pluginId`。`getBalance()` 和 `listBalanceLogs()` 只读取当前 token 用户自己的账户余额和余额流水，不包含充值、扣款、退款、调账或跨用户余额能力。`createBalanceAdjustmentRequest()` 只提交当前 token 用户自己的待审批余额调整申请，状态固定进入后台审批，不会直接写余额、余额流水、支付或充值订单；`listBalanceAdjustmentRequests()` 只读取当前 token 用户通过 Public API 提交的申请。`listBillingRecords()` 和 `getBillingRecord(id)` 只读取当前 token 用户自己的实例计费记录，支持白名单 `type` 和 `serviceId` 过滤，不返回余额流水对象、支付回调、provider payload、内部对账数据或其他用户账单。`listServices({ status, include: ['product', 'plan'], sort: 'displayOrder' })` 和 `getService(id, { include: 'product' })` 只支持平台白名单过滤和 include，include 只返回当前用户服务已关联的产品/套餐摘要；`listOrders({ status, sort: '-createdAt' })` 只传递平台白名单过滤参数，`getOrder(id)` 只读取当前 token 用户自己的单条公共订单，订单 ID 形如 `recharge:123` 或 `instance_billing:456`，不返回支付回调数据、provider 配置快照、原始查询结果或完整交易号；`listTickets({ status, category, priority, sort: '-updatedAt' })` 只传递平台白名单过滤参数，不接受任意 where/include。`createTicket()` 和 `replyToTicket()` 支持通过 `attachments` 上传受控图片附件，最多 6 张，单张最大 50MB，仅支持 JPG、PNG、WebP、GIF 和 AVIF；返回值只包含安全附件元数据，不返回存储 provider 文件 ID 或原始 provider URL。`sendNotification()` 只允许给当前 token 用户自己发送通知，可使用 `title`/`message`、平台白名单模板 `flash_sale_reminder`、`service_action_update`、`billing_notice`，或已启用扩展 manifest 声明的 `plugin:<pluginId>:<templateId>` 受控模板；模板变量只允许短标量值，不接受 HTML、未声明模板、群发或任意渠道选择。`queueServiceAction()` 只允许为当前 token 用户自己的服务排队 `start`、`stop`、`restart` 任务；`getServiceTask()` 只读取这些公开电源任务的状态；`cancelServiceTask()` 只取消仍处于 `PENDING` 的公开电源任务；`renewService()` 只允许续费当前 token 用户自己的付费服务，并复用内部续费事务处理余额扣款、账单、AFF 折扣、用户托管节点续费限制和到期封停解封；响应不返回余额流水 ID、支付回调或 provider payload，也不开放任意金额、创建、暂停、恢复、重装、删除、迁移、资源交付或宿主机操作。`updateTicketStatus(id, action)` 只允许当前 token 用户关闭自己的工单或重新打开自己的已关闭工单，不接受任意 status、优先级、分类、内部备注、负责人或跨用户状态修改。`listNotifications()` 和 `getUnreadNotificationCount()` 只读取当前 token 用户自己的站内信展示字段和未读数量，不返回通知渠道配置、发送日志、原始事件 payload 或其他用户消息。`listPluginActions()` 和 `getPluginActions(pluginId)` 只返回已启用扩展的公开 webhook action 契约，包括 name、method、path、scope、幂等策略、限流策略和 request/response schema；不会返回 webhook URL、secret、配置值，也不会展示 service-extension 或 gateway-extension 内部 lifecycle action。

写入型 SDK 方法会受到平台 Public API 独立限流保护。余额调整申请、服务电源任务、工单写入、通知发送和扩展 action dispatch 触发限流时会抛出 `PayIncusPublicApiError`，`status = 429`，调用方应按 `retryAfter` 或退避策略重试。扩展 action dispatch 还会按 token + 扩展 + action 套用数据库持久化动态配额：`rateLimit = normal` 默认每分钟 30 次，`rateLimit = strict` 默认每分钟 10 次；后台可按全局、扩展或 action 覆盖策略，同一数据库下多实例共享计数窗口，超过时错误码为 `PUBLIC_PLUGIN_ACTION_RATE_LIMITED`。

## 错误处理

请求失败时 SDK 会抛出 `PayIncusPublicApiError`：

```ts
try {
  await client.sendNotification({
    title: '秒杀提醒',
    message: '活动即将开始。',
    source: 'Flash Sale Extension'
  })
} catch (error) {
  if (error instanceof PayIncusPublicApiError) {
    console.log(error.status, error.code, error.message, error.details)
  }
}
```

常见错误：

- `PUBLIC_API_TOKEN_REQUIRED`
- `PUBLIC_API_TOKEN_INVALID`
- `PUBLIC_API_TOKEN_REVOKED`
- `PUBLIC_API_TOKEN_EXPIRED`
- `PUBLIC_API_SCOPE_REQUIRED`
- `INVALID_TICKET_CREATE_PAYLOAD`
- `INVALID_TICKET_REPLY_CONTENT`
- `PUBLIC_PLUGIN_ACTION_FAILED`

## 边界

首版 SDK 不包含以下能力。这些不是 SDK 的遗漏，而是 Public API 的高风险准入边界：

- 直接余额充值、扣款、退款或绕过审批的调账。
- 支付建单、支付回调处理、主动验单、退款执行或 provider payload 读取。
- 实例创建、暂停、恢复、重装、删除、迁移、资源交付或宿主机操作。
- 邮箱、密码、2FA、角色、状态等敏感用户资料修改。
- 工单任意文件上传、内部备注、负责人修改或任意状态流转。
- HTML 通知、未声明通知模板、群发或任意渠道选择。
- 扩展安装、启用、停用、卸载、市场发布或主题启用。
- 任意管理员 API 或跨用户数据访问。

这些能力需要等对应 `/api/v1` 资源和 scope 按高风险标准开放后再加入 SDK。新增前必须先有公开资源设计、独立 scope、OpenAPI 契约、审计日志、限流、幂等、防跨用户校验、状态机回滚和生产 proof。
