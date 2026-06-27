# 全站能力矩阵

本页用于对齐 PayIncus 当前架构、后台入口、用户入口、开放接口、文档和验证守卫。它不是发布承诺，而是判断一个能力是否已经形成产品闭环的验收表。

状态说明：

- 已闭环：已有核心代码、可见入口、文档和守卫测试。
- 基础可用：核心能力已存在，但运营入口、失败补偿、生产验收或文档还需要增强。
- 规划增强：已有方向或部分基础，仍需要专门开发。

| 能力 | 当前状态 | 后台入口 | 用户入口/API | 主要代码来源 | 验证与缺口 |
| --- | --- | --- | --- | --- | --- |
| 前后台分离 | 已闭环 | `/admin/*` | 用户端独立路由 | `client/src/router/admin.ts`、`client/src/router/user.ts` | 路由守卫和构建边界已覆盖；继续防止用户自助能力进入 admin bundle。 |
| OTA 在线更新 | 已闭环 | `/admin/system-update` | 无用户入口 | `server/src/routes/system-update.ts`、`server/src/scripts/run-system-update-task.ts` | 已覆盖 release artifact、SHA256、回滚和运行目录保留；生产执行仍需看任务日志。 |
| 实例购买与交付 | 基础可用 | `/admin/delivery`、`/admin/instances/create` | `/instances/create`、`/instances/:id` | `server/src/routes/instances.ts`、`server/src/db/hosts.ts` | 购买前会校验节点、库存和存储池；仍需扩展更完整的生产验收矩阵。 |
| 存储池绑定 | 已闭环 | 节点详情存储页、套餐绑定 | 创建实例自动选择 | `server/src/routes/hosts.ts`、`server/src/db/storage-pools.ts` | 已阻止无系统盘池节点上架/售卖；后续可增加更细的健康检查和告警。 |
| 实例方案升级 | 基础可用 | `/admin/billing` 升级弹窗、`/admin/delivery` 修复队列 | 实例详情变更方案 | `server/src/routes/instance-billing.ts`、`server/src/routes/admin-billing.ts`、`server/src/services/plan-upgrade-sync-repair.ts` | 已做容量、余额、售罄、带宽同步和 Incus 同步；同步失败会写入交付保障修复队列，可在后台重试或人工结案；后续补更完整的回滚预案。 |
| 带宽与流量 | 基础可用 | 套餐/方案设置、流量同步 | 实例列表、详情、重置流量 | `server/src/db/traffic.ts`、`server/src/services/traffic-scheduler.ts` | 已支持方案级流量重置价格和限速；后续需把异常同步和超限状态纳入统一运营台。 |
| 资源风控 | 已闭环 | `/admin/resource-risk` | 限单用户可发起审核工单 | `server/src/services/resource-risk.ts`、`server/src/routes/resource-risk.ts` | 已有实例评分、QoS、CPU/带宽/PPS、小包比例、人工封禁、专用处置弹窗、原因模板、按来源实例限单、证据详情、24 小时/7 天趋势和 JSON 导出；后续可增强更长周期图表和批量证据导出。 |
| 支付与账务 | 基础可用 | `/admin/billing`、`/admin/orders` | 钱包、订单、充值 | `server/src/routes/admin-billing.ts`、`server/src/routes/orders.ts` | 已有在线充值、人工充值、余额流水、调账审批、对账、脱敏导出、插件支付网关原路退款状态机和原路退款工作台；人工充值会创建待支付订单并展示付款说明，管理员在订单中心人工确认入账；原路退款会在创建申请前校验渠道能力，日对账已覆盖退款卡住和失败返还缺失差异；仍缺更多内置渠道原路退款适配和更完整的 provider 状态同步。 |
| 礼品卡 | 已闭环 | `/admin/gift-cards` | `/gift-cards` | `server/src/routes/gift-cards.ts` | 已覆盖生成、兑换、白名单和 Turnstile；生产仍需配置对应管理员白名单和验证密钥。 |
| 通知、工单与帮助 | 基础可用 | `/admin/tickets`、`/admin/help`、`/admin/inbox`、`/admin/integrations` | `/tickets`、帮助中心、站内信 | `server/src/routes/tickets.ts`、`server/src/lib/notifier.ts` | 工单上下文和内部备注已做 admin-only；集成中心已汇总通知渠道和外部服务配置状态，支持 SMTP、Lsky、Telegram、支付渠道、全局通知渠道、默认远程存储、Agent/Incus、OTA 和市场源一键测试与真实外部健康探测，保存最近异常和 7 天成功率。 |
| Telegram 集成 | 基础可用 | `/admin/integrations`、`/admin/settings/telegram` | 个人资料绑定 | `server/src/routes/telegram.ts`、`client/src/views/admin/TelegramConfigView.vue` | 已有 Bot、Webhook、绑定用户和群准入；集成中心已提供总览入口。 |
| 邮件与 Lsky 附件 | 基础可用 | `/admin/integrations`、`/admin/settings/mail`、`/admin/settings/tickets` | 注册验证、工单附件 | `server/src/routes/system-config.ts`、`server/src/lib/lsky.ts` | SMTP/Lsky 已有配置、预检和集成中心一键健康探测；健康检测历史会保存最近异常和 7 天成功率。 |
| 扩展中心 | 基础可用 | `/admin/plugins` | `/extensions`、扩展页面 | `server/src/lib/plugin-manifest.ts`、`server/src/routes/admin-plugins.ts` | 已支持配置、页面、事件、action、存储、市场投稿、任务和 capability 审核；高风险 action、服务扩展、支付网关和存储能力会生成审核记录，未批准不能启用扩展；后续补运行期更细粒度 enforcement 和回滚 playbook。 |
| 主题中心 | 已闭环 | `/admin/themes` | `/api/themes/active` | `server/src/lib/theme-package.ts`、`server/src/routes/admin-themes.ts` | 已有上传、在线市场、投稿审核、扫描发布、预览、启用、配置和回滚；主题只能改视觉，不能改认证、支付、权限、风控或资源交付逻辑。 |
| Public API / OAuth | 基础可用 | `/admin/oauth` | `/api/v1/*`、OAuth Provider | `server/src/routes/public-api.ts`、`server/src/lib/public-api-openapi.ts` | 已有 token、scope、分页、排序、错误模型和 SDK；服务创建、退款、余额直写、迁移等高风险能力仍保持关闭。 |
| 托管与资源池 | 基础可用 | `/admin/hosting`、资源页 | 我的节点、我的套餐、托管收益 | `server/src/routes/hosting.ts`、`server/src/routes/packages.ts` | 已有托管专区、收益、套餐和节点绑定；需要继续完善商业运营验收和异常通知。 |
| 娱乐、签到与会员权益 | 基础可用 | `/admin/entertainment` | `/entertainment`、签到/权益入口 | `server/src/routes/admin-entertainment.ts`、`server/src/routes/checkin.ts` | 基础能力存在；需要明确产品定位、入口可见性和配置边界。 |

## 下一批必须补齐的闭环

- 集成中心：已统一展示 SMTP、Lsky、Telegram、支付渠道、通知渠道、远程存储、Agent/Incus、OTA、市场源和 Webhook 配置状态，提供 SMTP、Lsky、Telegram、支付渠道、全局通知渠道、默认远程存储、Agent/Incus、OTA、扩展市场和主题市场一键测试，并保存最近异常记录和 7 天成功率。
- 实例升级补偿：扣费/数据库已成功但 Incus 同步失败时已进入交付保障修复队列，并提供重试和人工结案；下一步补回滚预案和更细的修复审计。
- 风控工作台：人工封禁、解除、限速、限单已改为专用处置弹窗，并已提供原因模板、证据详情、24 小时/7 天趋势、最近样本、风险事件时间线、处置审计、关联限单和 JSON 导出；下一步可增强更长周期图表和批量证据导出。
- 扩展高风险能力：已建立 capability 审核、管理员处理、启用拦截和审计记录；下一步补运行期细粒度 enforcement、批量审计导出和回滚 playbook。
- 支付退款生命周期：插件支付网关原路退款已有状态机、创建前能力预检、退款生命周期对账和后台原路退款工作台；下一步补内置 provider refund adapter 和更完整的 provider 状态同步。

## 更新规则

改动后台入口、用户入口、公开 API、OAuth scope、扩展 capability、主题 slot、资源交付、支付账务、风控或 OTA 时，必须同步更新本页，并运行对应守卫测试。
