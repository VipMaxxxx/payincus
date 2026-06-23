# 插件开发指南

插件包必须是 `.tar.gz`，根目录包含：

```text
payincus.plugin.json
README.md
dist/
  admin/
  user/
templates/
docs/
```

最小打包命令：

```bash
tar -czf my-plugin.tar.gz payincus.plugin.json README.md dist templates docs
```

## 后台页面

后台页面通过 `adminPages` 声明，并在插件中心中以 sandbox iframe 打开。

```json
{
  "slot": "admin.plugins.settings",
  "title": "设置",
  "entry": "dist/admin/settings.html"
}
```

## 用户端页面

用户端页面通过 `userPages` 声明。启用插件后，用户端会从 `/api/plugins/enabled-client-extensions` 获取可展示入口。

```json
{
  "slot": "user.sidebar.extra",
  "title": "我的插件",
  "path": "/plugins/my-plugin",
  "entry": "dist/user/index.html",
  "requiresAuth": true
}
```

## 配置

后台插件配置保存到插件中心。插件静态页可以读取非敏感公有配置：

```text
GET /api/plugins/:pluginId/config/public
```

带有 `token`、`secret`、`password`、`key` 等名称的配置会按敏感配置处理，不会在公有配置接口返回。
