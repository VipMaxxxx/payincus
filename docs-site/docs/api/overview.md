# API 参考

PayIncus API 分为同源内部 API、Public API、Agent API、OAuth Provider 和 WebSocket。第三方开发者、扩展后端和自动化系统应优先使用稳定的 `/api/v1` Public API；管理后台和用户端内部接口不作为第三方稳定契约。

<div class="api-reference-hero">
  <div>
    <strong>OpenAPI 3.1</strong>
    <span>Public API 已提供机器可读文档，可用于生成 SDK、导入调试工具或对接自动化测试。</span>
  </div>
  <a href="/api/v1/openapi.json">下载 JSON</a>
  <a href="/api/v1/openapi.yaml">下载 YAML</a>
</div>

```text
https://panel.example.com/api
https://admin.example.com/api
https://panel.example.com/api/v1
```

## 鉴权

| Token | 来源 | 用途 |
| --- | --- | --- |
| `pat_` | 用户在 PayIncus 创建的 API Token | 服务端集成、自动化脚本、扩展后端 |
| `poa_` | OAuth Provider authorization code 流程换取的 access token | 第三方应用代表当前授权用户访问资源 |
| Session JWT | 浏览器登录会话 | 用户端、管理后台和 OAuth 授权确认页面 |

Public API 使用 `Authorization: Bearer <token>`，并按 scope、过期时间、撤销状态、用户状态和资源归属逐层校验。浏览器登录 JWT 不应被第三方当作长期凭据保存。

## 通用规则

| 规则 | 当前标准 |
| --- | --- |
| 基础路径 | `/api/v1` |
| 分页 | `page`、`pageSize`，最大 `pageSize = 100` |
| 排序 | 常用 `createdAt`、`-createdAt`，部分资源支持 `updatedAt`、`displayOrder` |
| 响应 | 成功响应使用 `data`，列表额外返回 `meta` |
| 错误 | `400`、`401`、`403`、`404`、`409`、`422`、`429` 按业务边界返回 |
| 高风险写入 | 服务操作、续费、工单写入、通知发送和扩展 action 有更严格限流 |

Public API 不开放直接支付建单、支付回调、退款、直接余额写入、服务创建/删除/迁移、敏感资料修改、后台管理和扩展/主题管理。需要这些能力时，应通过 PayIncus 内部状态机、后台审核或受控扩展机制完成。

## 用户资料

### GET /api/v1/me {#get-api-v1-me}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method get">GET</span><code>/api/v1/me</code></div>
  <p>读取当前 token 用户的安全资料摘要。</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>profile:read</code></td></tr>
    <tr><th>Auth</th><td><code>pat_</code> 或 <code>poa_</code> Bearer token</td></tr>
    <tr><th>返回</th><td>用户 ID、用户名、邮箱摘要、角色、状态、头像样式和 token 元信息。</td></tr>
    <tr><th>边界</th><td>只返回当前 token 用户，不返回安全设置、密码、余额或其他用户资料。</td></tr>
  </tbody></table>
</div>

### PATCH /api/v1/me {#patch-api-v1-me}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method patch">PATCH</span><code>/api/v1/me</code></div>
  <p>更新当前用户低风险展示字段。</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>profile:write</code></td></tr>
    <tr><th>Body</th><td>当前仅接受 <code>avatarStyle</code>。</td></tr>
    <tr><th>返回</th><td>更新后的当前用户资料。</td></tr>
    <tr><th>边界</th><td>不能修改邮箱、密码、角色、状态、余额和双因素设置。</td></tr>
  </tbody></table>
</div>

## 余额

### GET /api/v1/balance {#get-api-v1-balance}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method get">GET</span><code>/api/v1/balance</code></div>
  <p>读取当前用户账户余额。</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>balance:read</code></td></tr>
    <tr><th>返回</th><td>当前结算币种下的账户余额。</td></tr>
    <tr><th>边界</th><td>不提供充值、扣款、退款、调整或跨用户余额操作。</td></tr>
  </tbody></table>
</div>

### GET /api/v1/balance/logs {#get-api-v1-balance-logs}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method get">GET</span><code>/api/v1/balance/logs</code></div>
  <p>分页读取当前用户余额流水。</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>balance:read</code></td></tr>
    <tr><th>Query</th><td><code>page</code>、<code>pageSize</code>、<code>sort</code>、<code>type</code>、<code>lotteryGift</code></td></tr>
    <tr><th>返回</th><td><code>data</code> 流水列表和 <code>meta</code> 分页信息。</td></tr>
    <tr><th>边界</th><td>不返回支付渠道 payload、调整对象、托管余额或其他用户流水。</td></tr>
  </tbody></table>
</div>

### GET /api/v1/balance/adjustment-requests {#get-api-v1-balance-adjustment-requests}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method get">GET</span><code>/api/v1/balance/adjustment-requests</code></div>
  <p>读取当前 token 用户通过 Public API 提交过的余额调整申请。</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>balance:write</code></td></tr>
    <tr><th>Query</th><td><code>page</code>、<code>pageSize</code>、<code>sort</code>、<code>status</code></td></tr>
    <tr><th>返回</th><td>待审批、已通过或已拒绝的申请摘要。</td></tr>
    <tr><th>边界</th><td>不暴露其他用户、管理员内部审批细节或支付渠道数据。</td></tr>
  </tbody></table>
</div>

### POST /api/v1/balance/adjustment-requests {#post-api-v1-balance-adjustment-requests}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method post">POST</span><code>/api/v1/balance/adjustment-requests</code></div>
  <p>创建一个待后台审批的余额调整申请。</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>balance:write</code></td></tr>
    <tr><th>Body</th><td>正数金额、原因和可选外部引用。</td></tr>
    <tr><th>返回</th><td><code>202</code>，申请已进入后台审批。</td></tr>
    <tr><th>边界</th><td>不会直接改余额、写余额流水、创建支付或退款。</td></tr>
  </tbody></table>
</div>

## 产品

### GET /api/v1/products {#get-api-v1-products}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method get">GET</span><code>/api/v1/products</code></div>
  <p>分页读取已启用的公开套餐和计划。</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>products:read</code></td></tr>
    <tr><th>Query</th><td><code>page</code>、<code>pageSize</code>、<code>sort</code></td></tr>
    <tr><th>返回</th><td>启用状态的产品和启用状态的 plan。</td></tr>
  </tbody></table>
</div>

### GET /api/v1/products/:id {#get-api-v1-products-id}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method get">GET</span><code>/api/v1/products/:id</code></div>
  <p>读取单个已启用产品。</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>products:read</code></td></tr>
    <tr><th>Path</th><td><code>id</code> 为产品 ID。</td></tr>
    <tr><th>返回</th><td>产品详情和启用状态的计划。</td></tr>
    <tr><th>错误</th><td>不存在或未启用时返回 <code>404</code>。</td></tr>
  </tbody></table>
</div>

## 服务

### GET /api/v1/services {#get-api-v1-services}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method get">GET</span><code>/api/v1/services</code></div>
  <p>分页读取当前用户服务摘要。</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>services:read</code></td></tr>
    <tr><th>Query</th><td><code>page</code>、<code>pageSize</code>、<code>status</code>、<code>include=product,plan</code>、<code>sort</code></td></tr>
    <tr><th>返回</th><td>服务列表和安全 include 摘要。</td></tr>
    <tr><th>边界</th><td>不返回 root 密码、Incus ID、宿主机内部配置或敏感连接材料。</td></tr>
  </tbody></table>
</div>

### GET /api/v1/services/:id {#get-api-v1-services-id}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method get">GET</span><code>/api/v1/services/:id</code></div>
  <p>读取当前用户单个服务。</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>services:read</code></td></tr>
    <tr><th>Query</th><td><code>include=product,plan</code></td></tr>
    <tr><th>返回</th><td>服务摘要、状态、到期时间和安全关联信息。</td></tr>
  </tbody></table>
</div>

### POST /api/v1/services/:id/actions {#post-api-v1-services-id-actions}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method post">POST</span><code>/api/v1/services/:id/actions</code></div>
  <p>为当前用户服务排队执行受控电源任务。</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>services:operate</code></td></tr>
    <tr><th>Body</th><td><code>action</code> 只接受 <code>start</code>、<code>stop</code>、<code>restart</code>。</td></tr>
    <tr><th>返回</th><td>已排队的服务任务。</td></tr>
    <tr><th>边界</th><td>不开放删除、挂起、发货、迁移、重装、宿主机操作或连接密钥。</td></tr>
  </tbody></table>
</div>

### POST /api/v1/services/:id/renew {#post-api-v1-services-id-renew}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method post">POST</span><code>/api/v1/services/:id/renew</code></div>
  <p>通过内部账务状态机续费当前用户付费服务。</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>services:billing</code></td></tr>
    <tr><th>Body</th><td>续费周期和幂等键。</td></tr>
    <tr><th>返回</th><td>续费后的服务和账务结果。</td></tr>
    <tr><th>边界</th><td>余额扣减、账单、AFF 折扣和托管节点限制由内部事务处理，不暴露直接扣款接口。</td></tr>
  </tbody></table>
</div>

### GET /api/v1/services/:id/tasks/:taskId {#get-api-v1-services-id-tasks-taskid}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method get">GET</span><code>/api/v1/services/:id/tasks/:taskId</code></div>
  <p>查询当前用户服务的公开电源任务状态。</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>services:operate</code></td></tr>
    <tr><th>返回</th><td>任务状态、进度和安全错误摘要。</td></tr>
    <tr><th>边界</th><td>只返回 Public API 创建的 start、stop、restart 任务。</td></tr>
  </tbody></table>
</div>

### DELETE /api/v1/services/:id/tasks/:taskId {#delete-api-v1-services-id-tasks-taskid}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method delete">DELETE</span><code>/api/v1/services/:id/tasks/:taskId</code></div>
  <p>取消仍处于 pending 状态的公开电源任务。</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>services:operate</code></td></tr>
    <tr><th>返回</th><td>取消后的任务状态。</td></tr>
    <tr><th>边界</th><td>处理中、已完成或非 Public API 任务不能取消。</td></tr>
  </tbody></table>
</div>

## 订单与账单

### GET /api/v1/orders {#get-api-v1-orders}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method get">GET</span><code>/api/v1/orders</code></div>
  <p>分页读取当前用户充值订单和实例账务订单。</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>orders:read</code></td></tr>
    <tr><th>Query</th><td><code>page</code>、<code>pageSize</code>、<code>sort</code>、<code>status</code></td></tr>
    <tr><th>边界</th><td>不返回支付回调、provider 配置快照、原始查询结果或完整交易号。</td></tr>
  </tbody></table>
</div>

### GET /api/v1/orders/:id {#get-api-v1-orders-id}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method get">GET</span><code>/api/v1/orders/:id</code></div>
  <p>读取当前用户单个公共订单。</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>orders:read</code></td></tr>
    <tr><th>Path</th><td><code>recharge:123</code> 或 <code>instance_billing:456</code>。</td></tr>
    <tr><th>边界</th><td>只读当前用户订单，交易号脱敏。</td></tr>
  </tbody></table>
</div>

### GET /api/v1/billing-records {#get-api-v1-billing-records}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method get">GET</span><code>/api/v1/billing-records</code></div>
  <p>分页读取当前用户服务账务记录。</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>billing:read</code></td></tr>
    <tr><th>Query</th><td><code>page</code>、<code>pageSize</code>、<code>sort</code>、<code>type</code>、<code>serviceId</code></td></tr>
    <tr><th>边界</th><td>不返回余额流水对象、支付渠道 payload 或内部对账数据。</td></tr>
  </tbody></table>
</div>

### GET /api/v1/billing-records/:id {#get-api-v1-billing-records-id}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method get">GET</span><code>/api/v1/billing-records/:id</code></div>
  <p>读取当前用户单条服务账务记录。</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>billing:read</code></td></tr>
    <tr><th>Path</th><td><code>id</code> 为账务记录 ID。</td></tr>
    <tr><th>错误</th><td>非当前用户记录或不存在时返回 <code>404</code>。</td></tr>
  </tbody></table>
</div>

## 工单

### GET /api/v1/tickets {#get-api-v1-tickets}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method get">GET</span><code>/api/v1/tickets</code></div>
  <p>分页读取当前用户工单摘要。</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>tickets:read</code></td></tr>
    <tr><th>Query</th><td><code>page</code>、<code>pageSize</code>、<code>status</code>、<code>category</code>、<code>priority</code>、<code>sort</code></td></tr>
    <tr><th>边界</th><td>不返回内部备注和其他用户工单。</td></tr>
  </tbody></table>
</div>

### POST /api/v1/tickets {#post-api-v1-tickets}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method post">POST</span><code>/api/v1/tickets</code></div>
  <p>为当前 token 用户创建公开工单。</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>tickets:write</code></td></tr>
    <tr><th>Body</th><td>JSON 文本工单，或 <code>multipart/form-data</code> 上传最多 6 张图片。</td></tr>
    <tr><th>限制</th><td>附件支持 JPG、PNG、WebP、GIF、AVIF，单张最大 50MB。</td></tr>
    <tr><th>边界</th><td>不允许内部备注、任意状态覆盖、目标用户覆盖、任意文件或存储 provider ID。</td></tr>
  </tbody></table>
</div>

### GET /api/v1/tickets/:id {#get-api-v1-tickets-id}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method get">GET</span><code>/api/v1/tickets/:id</code></div>
  <p>读取当前用户工单详情、公开消息和安全附件元信息。</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>tickets:read</code></td></tr>
    <tr><th>边界</th><td>不返回内部备注、原始 provider URL 或其他用户消息。</td></tr>
  </tbody></table>
</div>

### POST /api/v1/tickets/:id/replies {#post-api-v1-tickets-id-replies}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method post">POST</span><code>/api/v1/tickets/:id/replies</code></div>
  <p>给当前用户未关闭工单添加公开回复。</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>tickets:write</code></td></tr>
    <tr><th>Body</th><td>文本回复，或最多 6 张受控图片附件。</td></tr>
    <tr><th>边界</th><td>不允许内部备注、跨用户回复或任意文件上传。</td></tr>
  </tbody></table>
</div>

### PATCH /api/v1/tickets/:id/status {#patch-api-v1-tickets-id-status}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method patch">PATCH</span><code>/api/v1/tickets/:id/status</code></div>
  <p>关闭或重新打开当前用户自己的工单。</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>tickets:write</code></td></tr>
    <tr><th>Body</th><td><code>status</code> 只接受 <code>close</code> 或 <code>reopen</code>。</td></tr>
    <tr><th>边界</th><td>不允许改优先级、分类、指派人、内部状态或其他用户工单。</td></tr>
  </tbody></table>
</div>

## 通知

### GET /api/v1/notifications {#get-api-v1-notifications}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method get">GET</span><code>/api/v1/notifications</code></div>
  <p>分页读取当前用户站内通知。</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>notifications:read</code></td></tr>
    <tr><th>Query</th><td><code>page</code>、<code>pageSize</code>、<code>status</code>、<code>sort</code></td></tr>
    <tr><th>边界</th><td>不暴露通道配置、外部投递日志、原始事件 payload 或广播目标。</td></tr>
  </tbody></table>
</div>

### POST /api/v1/notifications {#post-api-v1-notifications}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method post">POST</span><code>/api/v1/notifications</code></div>
  <p>向当前 token 用户自己发送受控短通知。</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>notifications:send</code></td></tr>
    <tr><th>Body</th><td><code>title</code>/<code>message</code>，或平台白名单模板、已启用扩展 manifest 声明的 <code>plugin:&lt;pluginId&gt;:&lt;templateId&gt;</code> 模板。</td></tr>
    <tr><th>边界</th><td>不支持广播、HTML、任意通道选择或内部事件类型覆盖。</td></tr>
  </tbody></table>
</div>

### GET /api/v1/notifications/unread-count {#get-api-v1-notifications-unread-count}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method get">GET</span><code>/api/v1/notifications/unread-count</code></div>
  <p>读取当前用户未读通知数量。</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>notifications:read</code></td></tr>
    <tr><th>返回</th><td>当前用户未读数量。</td></tr>
  </tbody></table>
</div>

## 扩展 Action

### GET /api/v1/plugins {#get-api-v1-plugins}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method get">GET</span><code>/api/v1/plugins</code></div>
  <p>列出已启用并允许 Public API 调用的扩展 action 目录。</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>plugins:action</code></td></tr>
    <tr><th>边界</th><td>不暴露 webhook URL、secret、配置值、服务扩展 hook 或支付网关 hook。</td></tr>
  </tbody></table>
</div>

### GET /api/v1/plugins/:pluginId/actions {#get-api-v1-plugins-pluginid-actions}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method get">GET</span><code>/api/v1/plugins/:pluginId/actions</code></div>
  <p>读取单个已启用扩展的 Public API action contract。</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>plugins:action</code></td></tr>
    <tr><th>返回</th><td>action 名称、输入 schema、输出 schema、幂等和限流声明。</td></tr>
  </tbody></table>
</div>

### POST /api/v1/plugins/:pluginId/actions/:action {#post-api-v1-plugins-pluginid-actions-action}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method post">POST</span><code>/api/v1/plugins/:pluginId/actions/:action</code></div>
  <p>以当前 token 用户身份执行已启用扩展声明的公开 action。</p>
  <table><tbody>
    <tr><th>Scope</th><td><code>plugins:action</code>，并满足 action 自身要求的 scope。</td></tr>
    <tr><th>Body</th><td>JSON payload，可携带可选幂等键。</td></tr>
    <tr><th>限流</th><td>默认普通 action 每 token/plugin/action 每分钟 30 次，严格 action 每分钟 10 次，管理员可覆盖。</td></tr>
    <tr><th>边界</th><td>服务扩展和支付网关 lifecycle action 不能通过此接口触发。</td></tr>
  </tbody></table>
</div>

## OAuth

### GET /api/oauth-provider/scopes {#get-api-oauth-provider-scopes}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method get">GET</span><code>/api/oauth-provider/scopes</code></div>
  <p>读取 OAuth 和 Public API 使用的 canonical scope metadata。</p>
  <table><tbody>
    <tr><th>Auth</th><td>公开读取。</td></tr>
    <tr><th>返回</th><td>scope、标题、风险等级、访问类型、资源和说明。</td></tr>
  </tbody></table>
</div>

### POST /api/oauth-provider/token {#post-api-oauth-provider-token}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method post">POST</span><code>/api/oauth-provider/token</code></div>
  <p>使用 authorization code 或 refresh token 换取 OAuth access token。</p>
  <table><tbody>
    <tr><th>Grant</th><td><code>authorization_code</code>、<code>refresh_token</code></td></tr>
    <tr><th>返回</th><td><code>poa_</code> access token、refresh token、有效期和授权 scope。</td></tr>
    <tr><th>边界</th><td>refresh token 会轮换并以 SHA256 hash 存储。</td></tr>
  </tbody></table>
</div>

### GET /api/oauth-provider/authorize/consent {#get-api-oauth-provider-authorize-consent}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method get">GET</span><code>/api/oauth-provider/authorize/consent</code></div>
  <p>浏览器会话读取 OAuth 授权确认信息。</p>
  <table><tbody>
    <tr><th>Auth</th><td>用户 Session JWT。</td></tr>
    <tr><th>返回</th><td>应用、redirect URI、请求 scope、已有授权和是否需要确认。</td></tr>
  </tbody></table>
</div>

### POST /api/oauth-provider/authorize/confirm {#post-api-oauth-provider-authorize-confirm}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method post">POST</span><code>/api/oauth-provider/authorize/confirm</code></div>
  <p>用户确认或拒绝 OAuth 授权。</p>
  <table><tbody>
    <tr><th>Auth</th><td>用户 Session JWT。</td></tr>
    <tr><th>返回</th><td><code>redirectTo</code>，携带 code 或 <code>access_denied</code>。</td></tr>
  </tbody></table>
</div>

### GET /api/oauth-provider/authorizations {#get-api-oauth-provider-authorizations}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method get">GET</span><code>/api/oauth-provider/authorizations</code></div>
  <p>读取当前用户已有 OAuth 授权列表。</p>
  <table><tbody>
    <tr><th>Auth</th><td>用户 Session JWT。</td></tr>
    <tr><th>返回</th><td>授权应用、scope、创建时间、最后使用时间和状态。</td></tr>
  </tbody></table>
</div>

### DELETE /api/oauth-provider/authorizations/:id {#delete-api-oauth-provider-authorizations-id}

<div class="api-endpoint">
  <div class="api-endpoint-title"><span class="api-method delete">DELETE</span><code>/api/oauth-provider/authorizations/:id</code></div>
  <p>撤销当前用户一个 OAuth 授权，并撤销关联 access/refresh token。</p>
  <table><tbody>
    <tr><th>Auth</th><td>用户 Session JWT。</td></tr>
    <tr><th>返回</th><td>撤销后的授权对象。</td></tr>
  </tbody></table>
</div>

## API Token 管理

这些接口由用户端登录会话调用，不属于 `/api/v1` 第三方 Bearer token 入口，但 OpenAPI 文档会列出它们，方便用户端和 SDK 工具理解 token 生命周期。

| Method | Path | 用途 |
| --- | --- | --- |
| `GET` | `/api/api-tokens` | 列出当前登录用户 API Token |
| `POST` | `/api/api-tokens` | 创建 API Token，明文 token 只返回一次 |
| `DELETE` | `/api/api-tokens/:id` | 撤销 API Token |

## WebSocket 和内部 API

终端 WebSocket 使用同源 `/api/ws`。用户端内部 API、管理后台 API、Agent API 和支付回调都有独立鉴权模型，不应被第三方扩展绕过 Public API 直接调用。

```text
wss://panel.example.com/api/ws/...
wss://admin.example.com/api/ws/...
```
