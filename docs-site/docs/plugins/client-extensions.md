# 客户端扩展点

插件只能挂载到 PayIncus 允许的扩展点，不能直接修改主前端代码。

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

插件页面使用 iframe sandbox 加载。插件可以读取自己的公有配置，但不能绕过权限访问后台 API。
