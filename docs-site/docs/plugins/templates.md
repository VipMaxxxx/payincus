# 扩展模板

仓库内提供五个扩展模板：

```text
plugin-templates/basic-admin-plugin
plugin-templates/user-sidebar-plugin
plugin-templates/admin-user-mixed-plugin
plugin-templates/ai-ticket-agent-plugin
plugin-templates/flash-sale-plugin
```

打包示例：

```bash
cd plugin-templates/admin-user-mixed-plugin
tar -czf coupon-plugin.tar.gz payincus.plugin.json README.md dist templates docs
```

然后在后台「扩展中心」上传 `.tar.gz` 安装并启用。

`plugin-templates/basic-admin-plugin` 同时演示 `admin.plugins.settings`、`admin.sidebar.extra` 和 `admin.dashboard.widgets`：设置页会出现在后台左侧菜单的扩展设置入口，侧边栏入口会打开受保护的后台扩展页面，dashboard widget 会嵌入后台统计页。

`plugin-templates/admin-user-mixed-plugin` 同时演示 `user.sidebar.extra` 和 `user.dashboard.cards`：前者出现在用户端侧边栏，后者嵌入用户端仪表盘。

## 秒杀完整样板

`plugin-templates/flash-sale-plugin` 是完整第三方功能扩展示例，用来证明扩展中心可以承载“前台页面 + 后台设置 + webhook action + 事件订阅 + scoped KV 存储”的业务形态。

它包含：

- 后台设置页：`admin.plugins.settings`，并通过 `configSchema` 声明活动开关、活动 ID、商品 SKU、开始/结束时间、库存、单用户限购和 webhook secret。
- 前台活动页：`/plugins/flash-sale`，用于展示活动并调用声明过的 action。
- Action：`reserveStock`、`confirmPaidReservation`、`releaseReservation`，都要求幂等键并声明 schema。
- 事件订阅：`order.paid` 确认库存，`payment.failed` 释放库存。
- 存储声明：global/user/service scoped KV，用于保存活动、用户预约和服务关联状态。

打包示例：

```bash
cd plugin-templates/flash-sale-plugin
tar -czf flash-sale-plugin.tar.gz payincus.plugin.json README.md dist templates docs
```

## 官方主题样板

`theme-templates/clean-theme` 是真正主题系统的官方样板，用来证明主题包可以通过受控方式提供 CSS、设计 token、后台配置字段和安全模板片段。

它包含：

- `payincus.theme.json`：声明主题 ID、版本、兼容范围、CSS 入口、tokens、layoutSlots、templates 和 configSchema。
- `dist/theme.css`：本地 CSS 入口，不使用远程 import。
- `tokens/colors.json`：设计 token 示例。
- 安全模板片段：`public.home.hero`、`public.market.banner`、`user.dashboard.banner`、`user.instance.detail.extra`、`user.wallet.banner`、`user.tickets.banner`、`user.extensions.banner`、`user.orders.banner`、`user.profile.banner`、`user.invites.banner`、`user.hosts.banner`、`user.host.create.banner`、`admin.extensions.header`、`admin.extensions.market.banner`、`admin.extensions.theme.banner`、`admin.dashboard.banner`、`admin.dashboard.widgets`、`admin.billing.banner`、`admin.payment.providers.banner`、`admin.oauth.banner` 和 `shared.footer`。
- 主题配置字段：color、select、text、file 和 placeholder，支持分组和排序。

打包示例：

```bash
cd theme-templates/clean-theme
tar -czf payincus-clean-theme.tar.gz payincus.theme.json README.md dist tokens templates docs
```
