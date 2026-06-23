# 插件 Manifest

插件必须提供 `payincus.plugin.json`。

```json
{
  "id": "com.example.coupon",
  "name": "优惠券插件",
  "version": "1.0.0",
  "payincus": ">=0.0.12",
  "description": "为用户续费提供优惠券能力",
  "author": "Example",
  "entrypoints": {
    "adminPages": [
      {
        "slot": "admin.plugins.settings",
        "title": "优惠券设置",
        "entry": "dist/admin/settings.html"
      }
    ],
    "userPages": [
      {
        "slot": "user.sidebar.extra",
        "title": "我的优惠券",
        "path": "/plugins/coupons",
        "entry": "dist/user/coupons.html",
        "requiresAuth": true
      }
    ]
  },
  "permissions": ["plugin:config:read"],
  "configSchema": {},
  "templates": []
}
```

规则：

- `id` 必须是反向域名格式，例如 `com.vendor.plugin`。
- `version` 必须是 semver。
- `entry` 必须是插件包内相对路径。
- `userPages.path` 必须位于 `/plugins/` 下。
- 用户端 entry 不能指向 `dist/admin/`。
- entry 不能是远程 URL。
