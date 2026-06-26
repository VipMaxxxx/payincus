# 扩展中心方案

## 目标

PayIncus 扩展中心要从“可安装页面扩展”升级为“第三方开发平台 + 实时扩展市场 + 主题系统”。最终目标是第三方开发者可以在受控权限内开发完整业务功能，运营方可以审核、上架、下架、安装、启用、回滚和审计扩展或主题。

这套方案不以任意代码执行作为能力边界。扩展必须通过平台 API、扩展 action、事件系统、扩展存储和受控 UI 扩展进入业务系统，不能绕过认证、支付、订单、风控、权限、资源交付和审计链路。

代码目录、环境变量和旧接口仍可沿用 `plugins` 命名以保持兼容；产品、文档和运营口径统一称为“扩展中心”。

## 当前状态

已具备：

- 后台上传 `.tar.gz` 扩展包。
- 受信在线扩展市场安装。
- 扩展启用、禁用、卸载。
- 扩展安装任务和日志。
- 扩展 manifest 校验。
- 后台设置页和用户端页面 iframe 扩展。
- 后台侧边栏扩展入口、通用后台扩展页面路由、用户仪表盘卡片 slot 和后台统计 widget slot 首版。
- 扩展配置保存和敏感配置加密。
- 扩展市场治理字段：审核状态、可信来源、开发者资料、权限声明、兼容范围、SHA256、评分、安装量和商业化预留。
- 文档站稳定在线扩展市场目录首版。
- 第三方投稿审核队列首版。
- 开发者投稿入口和管理员审核后台 UI 首版。
- 第三方扩展包托管上传首版：开发者上传 `.tar.gz` 到 `PLUGIN_DATA_DIR/submission-uploads/plugins`，平台校验包结构、解析 manifest、计算 SHA256 并生成待审核下载 URL。
- 投稿自动扫描首版：HTTPS/SSRF 校验、manifest 校验、包结构校验、SHA256 校验和权限风险分级。
- 文档站市场目录发布首版：从 listed 且扫描通过/警告的投稿生成 `plugin-market/index.json`。
- manifest capability 声明校验：actions、events、storage。
- 用户级 KV 存储首版。
- 全局/服务级 scoped KV 存储、平台托管私有表空间、migration ledger、后台只读存储用量/配额观测、卸载保留/清理策略、带 `contentSha256` 的完整备份导出、服务器本地归档、差异归档、S3-compatible/WEBDAV/FTP/SFTP 远端归档、定时归档调度器、替换式恢复和恢复 dry-run 演练记录首版。
- Webhook action runtime 首版。
- Action request/response schema 契约声明首版。
- 事件 dispatcher 首版。
- 扩展安装、启用、停用和卸载 lifecycle 事件自动接入 dispatcher 首版；payload 只包含扩展 ID、版本、来源和时间，不包含安装路径、配置值、secret、下载密钥或 webhook URL，投递失败不会阻止主操作。
- 订单、支付、服务、服务任务、资源回滚、通知、工单和用户生命周期业务事件接入 dispatcher 首版；服务任务已覆盖公共电源任务以及重装、克隆、重建、迁移等后台实例任务的排队、取消、完成、失败和超时清理失败，资源回滚已覆盖实例交付失败后的宿主机资源释放成功/失败。
- Gateway Extension 支付 lifecycle 自动派发首版：充值建单生成支付链接后派发 `createPayment`，主动验单终态和管理员人工完成/失败派发 `verifyPayment`，支付回调终态派发 `webhook`；扩展失败只写审计失败日志，不回滚或覆盖 PayIncus 内部订单、余额、回调幂等或人工操作结果。后台支付渠道已支持 `plugin_gateway` 首版，可绑定已启用插件的 `pluginId + gatewayExtensionKey + providerCode`，同步调用 `createPayment` 返回 HTTPS 支付跳转地址，并通过受控 `webhook` 回调归一化支付结果；原路退款已有独立 `RechargeRefundRequest` 状态机，管理员触发后先预扣余额，再调用绑定插件 `refund` hook，只有插件确认完成后才标记退款完成并按累计完成金额更新充值单退款状态。
- 事件投递可靠性和审计筛选首版：成功/失败日志、失败进入 `retry_pending`、自动重试、死信 `dead_letter`、`dedupeKey` 数据库唯一锁去重、后台事件列表、按扩展/事件名/handler/结果筛选、投递统计、最后尝试时间、手动重放，以及开发者事件健康只读监控、最近 24 小时窗口、成功率、`eventName + handler` 明细、开发者事件投递告警通知和管理员 critical 升级首版。
- /api/v1 公共 API 首版：`GET /api/v1/me`。
- OpenAPI 3.1 基础契约首版：`GET /api/v1/openapi.json` 和 `GET /api/v1/openapi.yaml`。
- API token/scope 基础能力首版：创建、列表、吊销、过期时间、最后使用时间和审计日志。
- 资源 API 只读首版：`GET /api/v1/balance`、`GET /api/v1/balance/logs`、`GET /api/v1/billing-records`、`GET /api/v1/billing-records/:id`、`GET /api/v1/products`、`GET /api/v1/products/:id`、`GET /api/v1/services`、`GET /api/v1/services/:id`、`GET /api/v1/orders`、`GET /api/v1/orders/:id`、`GET /api/v1/tickets`、`GET /api/v1/tickets/:id`、`GET /api/v1/notifications` 和 `GET /api/v1/notifications/unread-count`；服务、订单、账单和工单列表已支持白名单安全过滤，所有公开列表已支持统一 `page`、`pageSize` 和白名单 `sort`，订单和账单详情只读取当前 token 用户自己的公共数据。
- 写入型资源 API 首版：`PATCH /api/v1/me`，只允许当前 token 用户更新低风险头像资料字段；`GET /api/v1/balance/adjustment-requests` 和 `POST /api/v1/balance/adjustment-requests` 只允许当前 token 用户读取和提交自己通过 Public API 发起的待审批余额调整申请，不直接写余额、余额流水、支付或充值订单；`POST /api/v1/services/:id/actions`，只允许当前 token 用户给自己的服务排队 `start`、`stop`、`restart` 任务，`GET /api/v1/services/:id/tasks/:taskId` 只允许轮询这些公开电源任务状态，`DELETE /api/v1/services/:id/tasks/:taskId` 只允许取消仍在等待中的公开电源任务；`POST /api/v1/services/:id/renew`，只允许当前 token 用户通过 `services:billing` scope 续费自己的付费服务，并复用内部续费事务完成余额锁、扣款、账单、AFF 折扣、托管收入和到期封停解封；`POST /api/v1/tickets`，只允许当前 token 用户给自己创建公开工单并通过 `multipart/form-data` 上传受控图片附件；`POST /api/v1/tickets/:id/replies`，只允许当前 token 用户给自己的未关闭工单追加公开回复并上传受控图片附件；`PATCH /api/v1/tickets/:id/status`，只允许当前 token 用户关闭自己的工单或重新打开自己的已关闭工单；`POST /api/v1/notifications`，只允许当前 token 用户给自己发送短文本通知、使用平台白名单通知模板或使用已启用扩展 manifest 声明的受控通知模板；`GET /api/v1/plugins` 和 `GET /api/v1/plugins/:pluginId/actions` 只读发现已启用扩展的公开 action 契约；`POST /api/v1/plugins/:pluginId/actions/:action`，只允许当前 token 用户触发已启用扩展声明过的受控公开 webhook action；Public API 写入面已按操作类型挂载独立限流，扩展 action dispatch 另有数据库持久化、后台可配置、按 token + 扩展 + action 维度共享的动态配额，触发后返回 `429`，不会进入后续支付、余额、任务、通知或 webhook 执行链路。
- Public API TypeScript SDK 和示例首版：文档站稳定下载 `sdk/payincus-public-api.ts`、`sdk/examples/service-power-task.ts`、`sdk/examples/service-renew.ts`、`sdk/examples/flash-sale-action.ts`、`sdk/examples/balance-adjustment-request.ts`、`sdk/examples/billing-records.ts` 和 `sdk/examples/oauth-authorization-code.ts`，覆盖当前 `/api/v1` profile、余额/余额流水只读、余额调整申请、账单读取、产品、服务读取/电源任务入队/受控续费、订单列表/详情、工单、通知只读/自通知发送、扩展 action 发现/触发能力、OAuth authorization code 换 token 和 refresh token 轮换示例，以及服务/订单/账单/工单白名单过滤和列表排序。
- 官方扩展和主题模板首版：basic admin、user sidebar、admin/user mixed、AI 工单助手、秒杀扩展和 clean theme 均可按文档打包，并通过平台扩展/主题包校验器。
- 主题包安装、市场安装、投稿审核/扫描/发布器、预览、启用、回滚、配置表单和受控模板片段首版：`payincus.theme.json`、CSS/HTML 资产校验、后台主题页、`/api/themes/active`、主题资产服务、公共首页、认证页、用户/后台 shell 品牌、用户仪表盘、实例详情页、钱包页、工单页、后台扩展中心、后台统计页横幅/运营 widget、后台计费/支付渠道/OAuth Provider banner 和共享页脚受控模板 slot 渲染、`theme-market/index.json`、`configValues` 和 `templateUrls`。
- 官方主题样例首版：`theme-templates/clean-theme` 覆盖 CSS、tokens、configSchema、file 字段和公共/用户/后台/共享受控模板片段。
- OAuth Provider 首版：后台创建 OAuth App、client secret 只显示一次、浏览器授权确认页、用户端授权记录、后台授权审计筛选、授权码换取 `poa_` access token 和 `por_` refresh token、refresh token 轮换、token/授权撤销、scope 校验、OAuth/Public API scope 元数据目录、scope/resource 映射和 `/api/v1` Bearer 访问。

仍缺少或刻意不在 Public API 首版开放：

- 写入型和高风险资源 API：邮箱/密码等敏感用户资料变更、服务创建/暂停/恢复/重装/删除/迁移、直接余额充值/扣款/退款或绕过审批的调账、支付和扩展管理。这些项目是有意保留在 PayIncus 内部状态机或后台审核流里的高风险边界，不是当前 Public API 首版未完成的阻塞项；新增前必须先补 scope 元数据、OpenAPI、SDK、审计日志、限流、幂等、状态机回滚和生产 proof。低风险头像资料、余额/余额流水读取、余额调整申请提交和申请列表读取、账单读取、服务读取、服务 `start`/`stop`/`restart` 任务入队、状态轮询和等待中任务取消、受控服务续费、工单创建/回复/关闭/重新打开、工单图片附件上传、站内信读取、自通知发送、白名单通知模板、扩展 manifest 受控通知模板、Public API 写入面独立限流和扩展 action 按 token/扩展/action 数据库持久化动态配额、后台全局/扩展/action 覆盖策略已完成受控首版。
- 更多资源交付细分事件接入 dispatcher 首版已经覆盖公开服务电源任务以及重装、克隆、重建、迁移等后台实例任务的入队、取消、完成、失败、超时清理失败，以及实例交付失败后的资源回滚成功/失败；开发者事件健康已经具备只读告警提示、基于现有通知渠道的开发者告警通知、外部通知订阅和升级策略、管理员 critical 升级，以及告警开关、最低级别、冷却时间、成功率阈值和统计窗口配置首版，后续仍需补齐更完整的事件去重策略。
- 扩展任意 SQL 表空间仍不开放；平台托管私有表空间、migration ledger、后台只读存储用量/配额观测、80%/100% 阈值告警、管理员完整备份、服务器本地归档、差异归档、S3-compatible/WEBDAV/FTP/SFTP 远端归档、环境变量启用的定时归档调度器、替换式恢复、`contentSha256` 指纹和恢复 dry-run 演练记录已有首版；差异归档需要匹配 base 完整归档，远端差异恢复同样依赖本地 base。
- 更深层的受控模板/布局覆盖。
- OAuth 更完整的 scope/resource API 覆盖；后台授权审计筛选和 Public API SDK 示例已完成首版。

## 竞品目录对比

Paymenter 的开发文档把能力拆成 Extensions、Configuration、Event list、Server Extension、Gateway Extension、Themes、OAuth 和 API Reference。PayIncus 扩展中心应按同一层级补齐，而不是只做页面型扩展。

参考目录：

- [Paymenter Extensions](https://paymenter.org/development/extensions/)
- [Paymenter Configuration](https://paymenter.org/development/extensions/configuration)
- [Paymenter Event list](https://paymenter.org/development/event-list)
- [Paymenter Server Extension](https://paymenter.org/development/extensions/server)
- [Paymenter Gateway Extension](https://paymenter.org/development/extensions/gateway)
- [Paymenter Theme](https://paymenter.org/development/theme/)
- [Paymenter OAuth](https://paymenter.org/development/OAuth)
- [Paymenter API Reference](https://paymenter.org/api/)

| Paymenter 目录 | 竞品能力 | PayIncus 当前状态 | 扩展中心目标 |
| --- | --- | --- | --- |
| Extensions | 可创建扩展，支持网关、服务和其他扩展；有启停命令、后台页面、配置和生命周期 hooks。 | 已有安装、启停、卸载、后台设置页、后台侧边栏页面、用户端页面扩展、用户仪表盘卡片、后台统计 widget、配置、官方模板、受控 action runtime、扩展安装/启用/停用/卸载 lifecycle 事件、业务事件和存储首版。 | 建立扩展类型、生命周期、action runtime、事件和存储，形成完整扩展平台。 |
| Configuration | 扩展和主题可声明字段，支持 text、textarea、markdown、password、email、number、select、tags、checkbox、color、file、placeholder、group 和 order 等。 | 已有标准扩展 `configSchema` 校验、后台自动表单、secret/password 加密保存、字段分组排序、扩展和主题 file 图片受控上传、扩展 iframe 公有配置实时更新、主题配置表单、配置变更 key 级脱敏审计和公开 API SDK 示例首版。 | 继续补齐更多资源 SDK 示例；配置值仍不允许进入日志或公共配置接口。 |
| Event list | 支持模型事件、导航、首页区域、head/body/footer 注入。 | 已有白名单事件、业务 dispatcher、webhook handler、签名、成功/失败日志、失败重试、死信、`dedupeKey` 数据库唯一锁去重、后台审计筛选、投递统计、最后尝试时间、手动重放、开发者事件健康只读监控、最近 24 小时窗口、最近 7 日趋势、成功率、只读告警提示、开发者事件投递告警通知、告警订阅偏好、`eventName + handler` 明细、用户/后台导航入口和 dashboard 页面 slot 首版；订单、支付、服务、公共电源任务、重装、克隆、重建、迁移、资源回滚、通知、工单和用户生命周期已接入。 | 扩展更多模型事件、导航扩展点、页面 slot 和多级告警升级策略。 |
| Server Extension | 支持产品配置、结账配置、创建/暂停/恢复/终止/升级服务、服务详情 action。 | 已有服务扩展类型声明、后台受控 dispatch、标准结果契约、可复用内部 dispatch 服务层、公开套餐 `checkoutConfig` 目标展示和服务详情 `servicePanel` 目标展示；hook 通过 webhook action 执行，并要求 `service-extension:*` scope，可按 `hook + productId` 发现已启用目标；实例交付成功、封停、解封、删除和套餐升级后已自动异步派发 `provision`、`suspend`、`unsuspend`、`terminate` 和 `upgrade` lifecycle hook。暂未让扩展返回值直接驱动实例创建/暂停/恢复/终止/升级状态机。 | 继续补齐更深的产品配置、结账配置、回滚和资源交付审计；高风险状态写入仍由 PayIncus 内部状态机接管。 |
| Gateway Extension | 支持支付网关可用性判断和支付处理。 | 已有支付网关扩展类型声明、后台受控 dispatch、标准结果契约和可复用内部 dispatch 服务层；hook 通过 webhook action 执行，并要求 `gateway-extension:*` scope，可按 `hook + providerCode` 发现已启用目标；充值建单、主动验单、支付回调和管理员人工完成/失败路径已在 PayIncus 内部状态机完成后异步派发 `createPayment`、`verifyPayment` 和 `webhook` lifecycle hook；后台支付渠道支持 `plugin_gateway` 首版，启用时校验已启用插件目标，用户建单时同步执行 `createPayment` 并只接受 HTTPS 支付跳转 URL；支付回调会调用绑定插件的 `webhook` hook 归一化结果，用户主动验单和管理员后台手动同步会调用绑定插件的 `verifyPayment` hook 归一化结果，然后由 PayIncus 校验订单号、providerId、金额、过期状态、订单状态和幂等后再入账/失败/取消；后台原路退款会通过独立 `RechargeRefundRequest` 状态机预扣余额、调用绑定插件 `refund` hook、失败返还预扣、完成后记录 provider refund 并按累计完成退款金额更新充值单。 | 继续补齐更完整资金审计、退款 UI 细节和多渠道内置退款适配；高风险资金写入仍由 PayIncus 内部状态机接管。 |
| Themes | 支持创建主题、主题配置、覆盖扩展视图和构建资源。 | 已有主题包安装、主题市场安装、主题投稿审核/扫描/发布器、预览、启用、回滚、CSS/HTML 资产校验、配置表单、受控模板片段、active theme 加载和公共首页、认证页、用户/后台 shell 品牌、用户仪表盘、实例详情页、钱包页、工单页、后台扩展中心、后台统计页、后台计费、支付渠道、OAuth Provider、共享页脚渲染首版。 | 建立更完整主题 token、布局区块和扩展视图覆盖。 |
| OAuth | 后台创建 OAuth App，第三方应用通过 authorization code 获取 token 并访问 `/api/me`。 | 已有 OAuth Provider 首版：OAuth App、授权确认页、authorization code、access token、refresh token 轮换、revoke、用户端授权记录、后台授权审计筛选、scope 校验、OAuth/Public API scope 元数据目录、scope/resource 映射和 `/api/v1` Bearer 访问；仍缺更完整写入型 scope/resource API 覆盖。 | 增加更多高风险资源 API、授权审计能力和更完整 SDK 示例。 |
| API Reference | OpenAPI 3.1、`/api/v1`、Bearer token、JSON:API 风格响应和客户端示例。 | 已有 `/api/v1`、OpenAPI 3.1 JSON/YAML、API token/scope、OAuth Bearer、profile 读取和低风险头像资料写入、余额/余额流水只读、余额调整申请提交/列表、账单读取、产品/服务/订单/工单/通知只读资源、统一分页、白名单排序、白名单过滤、服务 include、错误模型、工单创建/回复/图片附件、工单关闭/重新打开、自通知发送、平台白名单通知模板、扩展 manifest 受控通知模板、扩展 action 发现/触发、Public API TypeScript SDK 和服务任务/秒杀 action/余额申请/账单读取示例首版；仍缺完整写入型资源。 | 继续扩大资源覆盖，并逐步开放敏感用户资料、服务操作、受审批资金流程、支付和扩展管理资源。 |

## 总体架构

```text
第三方开发者
  -> GitHub Release / 扩展包 / manifest / SHA256
  -> 扩展投稿审核
  -> 文档站扩展市场目录
  -> PayIncus 后台扩展市场
  -> 安装任务 / SHA256 校验 / manifest 校验
  -> 扩展运行时
  -> API / action / event / storage / UI slots
```

核心组件：

- 文档站扩展目录：负责展示和提供机器可读市场索引。
- 扩展审核系统：负责审核第三方提交。
- 后台扩展市场：负责读取市场索引和安装扩展。
- 扩展运行时：负责页面、配置、后端 action、事件和存储。
- 主题系统：负责主题包安装、预览、启用和回滚。
- 开发者 API：负责第三方能力的稳定契约。

## 实时扩展市场

扩展市场不应绑定 PayIncus 某个版本的 Release 链接。市场目录应该是稳定在线地址，由文档站或独立 CDN 提供。

当前稳定地址：

```text
https://payincus.com/plugins/market
https://payincus.com/plugin-market/index.json
```

生产环境固定配置：

```text
PLUGIN_MARKET_INDEX_URL=https://payincus.com/plugin-market/index.json
```

文档站负责：

- 提供人类可读的扩展目录页。
- 提供机器可读的 `index.json`。
- 展示扩展详情、截图、权限、版本、开发者、兼容范围和更新日志。
- 发布官方扩展包或引用审核后的第三方 GitHub Release artifact。

后台扩展中心负责：

- 实时读取 `PLUGIN_MARKET_INDEX_URL`。
- 默认只展示 `reviewStatus = listed` 的扩展。
- 安装前展示来源、权限、SHA256、兼容范围和风险提示。
- 安装时重新下载 artifact 并校验 SHA256。

## 市场索引格式

```json
{
  "version": 1,
  "updatedAt": "2026-06-25T00:00:00.000Z",
  "plugins": [
    {
      "id": "com.payincus.ai-ticket-agent",
      "name": "AI 工单助手",
      "latest": "1.0.0",
      "repo": "payincus/plugins",
      "manifestUrl": "https://payincus.com/plugin-market/manifests/com.payincus.ai-ticket-agent/1.0.0.json",
      "downloadUrl": "https://payincus.com/plugin-market/packages/com.payincus.ai-ticket-agent/1.0.0/plugin.tar.gz",
      "sha256": "64-character-sha256",
      "reviewStatus": "listed",
      "trustLevel": "official",
      "developer": {
        "name": "PayIncus",
        "homepage": "https://payincus.com",
        "github": "https://github.com/payincus",
        "verified": true,
        "contact": "plugins@payincus.com"
      },
      "permissions": {
        "adminPages": ["admin.plugins.settings"],
        "userPages": [],
        "api": ["ticket:ai:read-context", "ticket:ai:generate-draft"],
        "storage": ["plugin-config"]
      },
      "compatibility": {
        "minPayincus": "0.6.0"
      },
      "security": {
        "checksumPinned": true,
        "signature": {
          "status": "unsigned"
        },
        "notes": ["No backend arbitrary code execution"]
      },
      "pricing": {
        "type": "free"
      },
      "rating": {
        "average": 0,
        "count": 0
      },
      "installCount": 0,
      "releaseNotes": "Initial release",
      "upgradeNotes": "No special steps",
      "rollbackNotes": "Disable or uninstall from extension center"
    }
  ]
}
```

## 下载源策略

官方扩展：

- 可以放在文档站静态目录或 CDN。
- 下载 URL 使用稳定路径。
- 包名和版本路径不可覆盖。
- SHA256 写入 `index.json`。

第三方扩展：

- 推荐开发者使用 GitHub Release artifact。
- 市场索引记录 Release 下载地址和固定 SHA256。
- 后台安装时必须重新校验 SHA256。
- 如果开发者重传同名 artifact 导致 SHA256 变化，安装必须失败。

## 第三方上传与审核

第三方扩展不直接上传到生产后台公共市场。标准流程：

1. 开发者上传 `.tar.gz` 到 PayIncus 待审核上传入口，或发布 GitHub Release / 对象存储 HTTPS artifact。
2. 平台托管上传会保存到 `PLUGIN_DATA_DIR/submission-uploads/plugins`，并返回 `manifestUrl`、`packageUrl`、SHA256、manifest 基础信息和权限快照；外部 HTTPS artifact 需要开发者自行填写这些字段。
3. 开发者提交审核资料：仓库、Release artifact、manifest、SHA256、截图、权限说明、兼容范围、更新说明、回滚说明、联系方式和定价信息。
4. 审核系统生成 `pending` 记录，只进入审核队列。
5. 自动校验包结构、manifest、路径安全、入口文件、SHA256、兼容范围和权限字段。
6. 人工审核权限是否最小化，是否触碰支付、订单、余额、实例交付、认证、风控、文件上传和通知。
7. 审核通过后写入文档站市场目录，状态为 `listed`。
8. 拒绝、漏洞、违规或兼容风险使用 `rejected` 或 `delisted`。

审核记录必须保存：

- 开发者和联系方式。
- 扩展 ID 和版本。
- 提交时间、审核人、审核时间。
- 审核结论和风险等级。
- SHA256、权限快照、兼容范围。
- 拒绝、下架、复审原因。

## 私有上传通道

后台上传 `.tar.gz` 是超级管理员私有安装通道：

- 适合自用、内测、线下交付和临时验证。
- 包进入 `plugin-staging`，校验通过后安装到 `plugins`。
- 不代表通过公共市场审核。
- 不应出现在公共扩展市场。

公共市场扩展必须走审核和 `listed` 状态。

## 扩展运行时

第一阶段运行时：

- 静态后台页面。
- 静态用户端页面。
- sandbox iframe。
- 扩展配置。
- 安装、启用、禁用、卸载任务。

第二阶段运行时：

- 扩展 webhook action runtime。
- 扩展私有存储。
- 事件订阅。
- Webhook 投递。
- API token/scope。
- 开发者 SDK。

扩展不得：

- 执行第三方 shell 脚本。
- 在主进程加载任意 Node.js 代码。
- 直接连接生产数据库写内部表。
- 从用户端访问 `/api/admin/*`。
- 绕过订单、支付、权限、资源交付和审计链路。

## 开发者 API

要达到第三方开发完整功能，必须建立 `/api/v1` 公共 API：

- 当前已落地首版：用户可通过后台认证创建和吊销 API token，token 只返回一次，数据库只保存 SHA256 hash；`GET /api/v1/me` 支持 `Authorization: Bearer pat_...` 或 OAuth `poa_...` 并要求 `profile:read` scope，`PATCH /api/v1/me` 要求 `profile:write` scope 且只允许更新低风险头像资料字段，余额、余额流水、账单、产品、服务、订单、工单和站内信已提供读取 API，`GET /api/v1/balance/adjustment-requests` 和 `POST /api/v1/balance/adjustment-requests` 已提供当前 token 用户自己的待审批余额调整申请读取/提交能力，服务已提供受控 `start`/`stop`/`restart` 任务入队、任务状态轮询、等待中任务取消和受控续费 API，工单已提供受控公开创建、回复、图片附件、关闭和重新打开 API，通知已提供受控自通知发送和白名单模板 API，扩展已提供受控 action 发现和触发 API，OAuth/Public API scope 元数据目录已经提供 `risk`、`access`、`resources` 和 `notes`，文档站已提供 Public API TypeScript SDK、服务电源任务轮询示例、服务续费示例、秒杀扩展 action 示例、余额调整申请示例和账单读取示例首版。
- API token/scope 基础能力首版已经具备：scope 白名单、scope 元数据目录、过期时间、吊销、最后使用时间和安全审计。
- 后续仍需补齐写入型和高风险资源 API、更完整 include 和更完整资源覆盖；统一分页、白名单排序、服务/订单/账单/工单列表白名单过滤、订单/账单详情读取、服务 `include=product,plan`、受控服务续费已完成首版，服务任务 SDK 示例、服务续费 SDK 示例、秒杀 action SDK 示例、余额调整申请 SDK 示例、账单读取 SDK 示例、OAuth authorization code 示例和扩展受控通知模板也已完成首版。

- OpenAPI 3.1 JSON/YAML。
- API 文档页。
- Bearer API token。
- scope 权限模型。
- 统一错误码。
- 已落地统一分页、白名单排序、白名单过滤和服务 include 首版。
- 资源模型：用户、产品、订单、服务、余额、账单、支付、工单、通知、扩展。

扩展 action 当前已支持声明：

- action 名称。
- 请求 schema。
- 响应 schema。
- 所需 scope。
- 幂等策略。
- 限流策略。
- 审计策略。

其中 `requestSchema` 和 `responseSchema` 是受控 JSON 对象，主要用于审核、文档和 SDK 生成；当前不支持远程 `$ref`，运行时完整 schema 校验仍由扩展服务端自行完成。

## 事件系统

扩展可以订阅平台事件，但必须通过白名单声明：

- `order.created`
- `order.paid`
- `payment.failed`
- `service.provisioned`
- `service.suspended`
- `service.unsuspended`
- `service.deleted`
- `ticket.created`
- `ticket.replied`
- `user.registered`
- `user.login`
- `user.profile.updated`
- `user.status.changed`
- `notification.sent`

事件系统要求：

- 签名。
- 重试。
- 死信队列。
- 去重。
- 审计日志。
- 手动重放。

当前已具备事件 dispatcher、webhook handler、订单/支付/服务/服务任务/资源回滚/通知/工单/用户生命周期业务事件、成功/失败日志、失败重试、死信、`dedupeKey` 数据库唯一锁去重、并发投递中去重、后台审计筛选、投递统计、最后尝试时间、手动重放和开发者事件健康只读监控首版，并在开发者投稿页按 `eventName + handler` 展示投递健康明细、最近 24 小时窗口、最近 7 日趋势、成功率和开发者告警提示。服务任务事件首版覆盖公共 API 的 `start`、`stop`、`restart` 入队和取消，也覆盖实例详情页发起的 `start`、`stop`、`restart`、`rebuild`、`clone`、`recreate`、`change_host` 排队、取消、worker 完成、worker 失败和超时清理失败；资源回滚事件首版覆盖实例交付失败后宿主机资源释放成功/失败。事件重试调度器会把仍处于死信、到期重试或最近成功率低于阈值的扩展事件通过现有站内信/用户通知渠道告警给投稿开发者本人，并按开发者和扩展读取告警开关、最低级别、冷却时间、成功率阈值和统计窗口配置；存在死信或到期重试时会同步通过 `plugin.event.alert_escalate` 冷却日志升级通知活跃管理员，避免开发者关闭告警或缺少投稿人时平台运营侧失明；告警不暴露 payload、actor、原始错误正文、webhook URL、secret 或配置值。

## 服务扩展

服务扩展把第三方 webhook action 映射到资源交付 lifecycle。当前已落地 `capabilities.serviceExtensions` manifest 声明、hook 白名单、action 引用校验、`service-extension:*` scope 约束、标准结果契约、后台受控调用入口 `/api/plugins/:pluginId/service-actions/:hook` 和实例 lifecycle 自动派发首版。

当前支持的 hook 包括 `checkoutConfig`、`provision`、`suspend`、`unsuspend`、`terminate`、`upgrade` 和 `servicePanel`。调用入口只允许管理员或平台内部 lifecycle 使用，会写入 `plugin.service-extension.dispatch` 审计日志，并复用 webhook runtime 的 HTTPS、SSRF、签名、超时和 payload 大小限制。实例 lifecycle 首版会在 `service.provisioned`、`service.suspended`、`service.unsuspended`、`service.deleted` 和套餐升级成功后按 `productId` 自动异步派发 `provision`、`suspend`、`unsuspend`、`terminate` 和 `upgrade` hook，并使用 `service-lifecycle:*` 幂等键。扩展响应会被标准化为 `{ accepted, status, message, externalReference, metadata }`，用于审计和后续编排判断；首版不会让扩展 webhook 返回值直接改实例、订单、支付、余额、套餐或计费记录，真实资源交付仍需要 PayIncus 内部状态机接管幂等、回滚、权限和审计。

## 支付网关扩展

支付网关扩展把第三方 webhook action 映射到支付 lifecycle。当前已落地 `capabilities.gatewayExtensions` manifest 声明、hook 白名单、action 引用校验、`gateway-extension:*` scope 约束、标准结果契约和后台受控调用入口 `/api/plugins/:pluginId/gateway-actions/:hook` 首版。

当前支持的 hook 包括 `availability`、`createPayment`、`verifyPayment`、`refund` 和 `webhook`。调用入口只允许管理员或平台内部支付 lifecycle 使用，会写入 `plugin.gateway-extension.dispatch` 审计日志，并复用 webhook runtime 的 HTTPS、SSRF、签名、超时和 payload 大小限制。充值建单生成支付链接后会按 `providerCode` 异步派发 `createPayment`，主动验单终态和管理员人工完成/失败会派发 `verifyPayment`，支付回调终态会派发 `webhook`，并使用 `gateway-lifecycle:*` 幂等键。payload 只包含订单号、金额摘要、支付方式、状态、来源、脱敏外部交易引用和受控支付详情摘要，不包含支付渠道配置快照、原始回调 payload、密钥或完整交易号。扩展响应会被标准化为 `{ accepted, status, message, externalReference, metadata }`，用于审计和后续支付编排判断；扩展 webhook 返回值不能直接改订单、支付、余额或用户资产状态，真实资金链路仍由 PayIncus 内部状态机接管回调验签、金额币种校验、幂等入账、退款预扣、失败返还、风控拦截和资金审计。扩展 webhook 失败只会写入扩展事件失败日志，不会回滚或覆盖 PayIncus 已完成的订单、余额、回调幂等或人工操作结果。

后台支付渠道新增 `plugin_gateway` 首版：管理员配置 `pluginId`、`gatewayExtensionKey` 和 `providerCode` 后，启用时会校验插件已安装启用、manifest 中存在匹配的 Gateway Extension，并声明 `createPayment` hook。用户创建或重新支付充值订单时，PayIncus 同步执行该 hook，扩展必须通过标准契约返回 `metadata.payUrl`、`metadata.paymentUrl`、`metadata.redirectUrl` 或 `metadata.checkoutUrl` 中的 HTTPS 公网跳转地址；PayIncus 只把它作为支付跳转链接返回给用户，不会据此入账。

`plugin_gateway` 通用回调入口首版已开放，但不是“插件说成功就入账”。支付平台回调必须带 PayIncus 订单号，PayIncus 会调用绑定插件的 `webhook` hook，让插件完成网关验签和结果归一化；随后 PayIncus 校验订单号匹配、providerId 匹配、支付金额等于应付金额、订单未过期、订单状态仍可处理，并通过 `payment_callbacks` 做幂等，才会执行内部 `completeRecharge`、`failRecharge` 或 `cancelRecharge`。插件返回的金额只用于实付校验，到账金额仍使用订单创建时确定的 `actualAmount`。用户主动验单和管理员后台手动同步首版也已开放，都会调用绑定插件的 `verifyPayment` hook，并复用同样的订单号、金额、过期、状态和幂等校验。

`plugin_gateway` 原路退款通过 `RechargeRefundRequest` 独立建模。后台创建退款请求后，平台按 `pending -> processing -> completed | failed | cancelled` 处理：进入 `processing` 前先使用余额锁预扣用户余额，随后调用绑定插件 `refund` hook；插件返回失败、取消或 dispatch 异常时返还预扣并记录失败原因；插件返回完成时记录 `providerRequestId`、`providerRefundId`、provider 状态、消息和脱敏 metadata，并按累计已完成退款金额决定是否把充值单标记为 `refunded`。退款 hook 使用 `plugin-gateway-refund:*` 幂等键，扩展不能直接改余额、订单或用户资产。

## 扩展存储

扩展需要私有存储，不能直接写内部业务表。

当前已落地用户级 KV、全局 scoped KV、服务级 scoped KV、平台托管私有表空间、migration ledger、后台只读存储用量/配额观测、80%/100% 阈值告警、管理员备份、本地完整归档、本地差异归档、S3-compatible/WEBDAV/FTP/SFTP 远端归档上传、远端归档 dry-run/恢复、定时归档、替换式恢复、恢复 dry-run 和卸载 retention 首版。扩展可在 `capabilities.storage.scopes` 声明 `user`、`global`、`service`，也可以在 `capabilities.storage.tables` 声明私有表、表级 scope、`maxRows` 和可应用 migration。私有表以 JSON 行保存，不开放任意 SQL；`global` 表写入、删除和 migration 应用只允许管理员。`GET /api/plugins/:pluginId/storage-usage` 只返回 key/row/migration 数量、声明状态、`maxKeys`、`maxRows`、retention 和阈值告警，不返回 value、row payload、用户 ID 或服务 ID。`GET /api/plugins/:pluginId/storage-backup` 可导出绑定 `pluginId` 的 JSON 备份，`POST /api/plugins/:pluginId/storage-backup/restore` 会校验 schema、格式、重复键、引用、大小和总项数后替换该扩展当前存储；`/storage-backup/archives` 可在 `PLUGIN_DATA_DIR/storage-backups/plugins/<pluginId>` 创建、列出、下载、演练恢复、正式恢复、删除本地完整或差异归档，`POST /archives?mode=differential` 会基于最近完整归档生成差异包，恢复时先校验 `baseBackupId` 和 `baseContentSha256` 并合成完整备份；有差异归档依赖的 base 完整归档不能删除，定时清理也会跳过这些 base。归档可通过当前管理员的 S3-compatible/WEBDAV/FTP/SFTP 远程存储配置上传远端副本、记录 `plugin_storage_backup_remote_archives` 元数据、从远端下载后校验 `contentSha256` 再演练或正式恢复；远端差异归档恢复仍要求本地存在匹配 base 完整归档。`PLUGIN_STORAGE_BACKUP_SCHEDULE_ENABLED=true` 后会按 `PLUGIN_STORAGE_BACKUP_INTERVAL_HOURS` 周期生成本地完整归档，并按 `PLUGIN_STORAGE_BACKUP_RETENTION_COUNT` 保留最近归档，内容未变化时只写入 skip 审计事件。这些接口只允许管理员使用。`retention = keep` 会保留 scoped KV 和私有表数据，`delete_on_uninstall` 会清理 scoped KV、私有表行和 migration ledger。

后续建议能力：

- 更完整的受控数据模型。
- 备份和恢复。
- 异常写入告警和更细粒度趋势观测。
- 跨扩展隔离。

## 主题系统

主题是独立系统，不等同于普通页面扩展。

当前已落地主题包上传安装、主题市场安装、主题投稿审核/扫描/发布器、预览、启用、回滚、配置表单和受控模板片段首版。后台扩展中心的“主题”页可以上传 `.tar.gz` 主题包，也可以读取 `THEME_MARKET_INDEX_URL` 指向的稳定 `theme-market/index.json`，只安装 `listed` 且固定 SHA256 的主题。主题投稿审核会保存开发者资料、Release artifact、manifest URL、包 SHA256、兼容范围、token 和布局区块声明；扫描器会执行 HTTPS/SSRF、manifest、SHA256、CSS/HTML 安全和包结构校验；发布器只把 listed 且扫描 passed/warning 的主题写入 `theme-market/index.json`。服务端会校验 `payincus.theme.json`、包路径、脚本类文件、CSS 入口、远程 CSS import 和模板 HTML 片段；启用后用户端通过 `/api/themes/active` 加载当前主题 CSS、`configValues` 和 `templateUrls`，并在公共首页、套餐市场页、认证页、用户/后台 shell 品牌、用户仪表盘、实例详情页、钱包页、工单页、后台扩展中心、后台统计页横幅/运营 widget、后台计费/支付渠道/OAuth Provider banner 和共享页脚渲染受控模板片段。管理员可以打开静态预览页、填写 `configSchema` 生成的主题配置，也可以回滚到默认主题。`theme-templates/clean-theme` 已提供官方主题样例，用于证明 CSS、tokens、配置字段和安全模板片段可以被打包、预览、启用和回滚。

主题包应包含：

```text
payincus.theme.json
README.md
dist/
  theme.css
  assets/
tokens/
templates/
  public/
  user/
  admin/
preview/
```

主题能力：

- 主题上传。
- 主题市场安装。
- 主题投稿审核。
- 主题预览。
- 主题启用。
- 主题回滚。
- 主题配置表单。
- 主题兼容范围。
- 主题资产 SHA256 校验。
- 主题 token：颜色、字体、圆角、间距、阴影、状态色和品牌资源。
- 受控布局区块：公共首页、登录注册、用户端 shell、后台 shell、产品市场、工单、钱包、实例详情。

主题不得：

- 注入未授权远程脚本。
- 修改登录、支付、权限、风控和资源交付逻辑。
- 覆盖安全页面的业务判断。
- 绕过 CSP、鉴权和审计。

## 秒杀扩展验收样例

秒杀扩展必须证明平台能力完整：

- 后台活动设置页。
- 前台活动页。
- 活动时间、商品、库存、限购、价格、风控和通知模板。
- 后端 action 原子扣库存。
- 幂等键防重复下单。
- 支付成功确认库存。
- 支付失败释放库存。
- 高并发限流。
- 审计日志覆盖下单、支付、库存释放和通知。
- 权限声明覆盖 `orders:create`、`payments:create`、`plugin-storage:write`、`notifications:send`。

## 里程碑

第一阶段：稳定在线市场

- 文档站扩展目录页。
- 文档站 `plugin-market/index.json`。
- 后台扩展市场读取稳定 URL。
- index 域名白名单和下载域名白名单。
- 官方扩展包发布到稳定路径。

第二阶段：投稿审核

- 第三方投稿模型。
- 审核队列后台。
- 自动包校验。
- 审核记录。
- `pending/listed/rejected/delisted` 全流程。

第三阶段：公共 API

- `/api/v1`。
- OpenAPI 3.1。
- API token/scope。
- API 审计日志。

第四阶段：扩展后端能力

- webhook action runtime。
- 扩展私有存储。
- 事件订阅。
- Webhook。
- SDK 和示例扩展。

第五阶段：主题系统

- 主题 manifest。
- 主题上传和审核。
- 主题预览。
- 主题启用和回滚。
- 官方主题样例：`theme-templates/clean-theme`。

第六阶段：商业化

- 付费扩展和主题。
- 授权校验。
- 开发者资料。
- 安装量、评分和反馈。
- 漏洞下架和强制禁用。

## 验收标准

- PayIncus 版本升级后，扩展市场目录仍从稳定文档站 URL 实时读取。
- 未审核扩展不会进入默认市场。
- 市场安装必须校验 SHA256。
- 扩展包不能包含危险路径、软链接或硬链接。
- 用户端扩展不能访问后台接口。
- 扩展 action 不能越权调用高风险业务。
- 主题不能注入未授权远程脚本。
- 扩展安装、启用、禁用、卸载、审核、下架都有审计日志。
- 秒杀扩展样例能证明 action、存储、事件、支付和通知链路。
- 官方主题样例能证明主题预览、启用和回滚。

## 建议验证命令

```bash
pnpm verify:extension-platform
git diff --check
```
