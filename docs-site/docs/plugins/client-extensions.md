# 客户端扩展点

扩展只能挂载到 PayIncus 允许的扩展点，不能直接修改主前端代码。

## 用户端扩展点

```text
user.sidebar.extra
user.dashboard.cards
user.instance.detail.panels
user.instance.renew.widgets
user.wallet.extra
user.ticket.extra
public.market.cards
```

## 后台扩展点

```text
admin.plugins.settings
admin.sidebar.extra
admin.dashboard.widgets
admin.instance.detail.panels
admin.user.detail.panels
admin.billing.extra
admin.ticket.extra
```

`admin.plugins.settings` 用于后台左侧菜单中的扩展设置入口，并打开独立的插件设置路由。`admin.sidebar.extra` 会显示为后台侧边栏入口，并打开平台生成的 `/admin/plugins/:pluginId/pages/<entry>` 页面。后台扩展入口只通过 `/api/plugins/enabled-admin-client-extensions` 暴露给管理员。

`user.dashboard.cards` 会挂载到用户端仪表盘，`admin.dashboard.widgets` 会挂载到后台统计页。页面内扩展点会直接渲染 sandbox iframe，适合状态卡片、活动摘要、运营小组件和只读报表，不应用来绕过平台业务 API。

扩展页面使用 iframe sandbox 加载。扩展可以读取自己的公有配置，但不能绕过权限访问后台 API。
