# 扩展 Manifest

扩展必须提供 `payincus.plugin.json`。

```json
{
  "id": "com.example.coupon",
  "name": "优惠券扩展",
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
  "permissions": ["plugin:config:read", "plugin-storage:read", "plugin-storage:write"],
  "capabilities": {
    "storage": {
      "kind": "kv",
      "maxKeys": 100,
      "tables": [
        {
          "name": "coupon_claims",
          "scopes": ["user"],
          "maxRows": 10000,
          "migrations": [
            { "version": "1.0.0", "name": "Create coupon claim row shape" }
          ]
        }
      ]
    }
  },
  "configSchema": {
    "enabled": {
      "type": "checkbox",
      "label": "启用扩展",
      "group": "基础配置",
      "order": 10,
      "required": false,
      "default": true
    },
    "apiKey": {
      "type": "password",
      "label": "API Key",
      "group": "接口凭据",
      "order": 20,
      "required": true,
      "secret": true
    }
  },
  "templates": []
}
```

规则：

- `id` 必须是反向域名格式，例如 `com.vendor.plugin`。
- `version` 必须是 semver。
- `entry` 必须是扩展包内相对路径。
- `userPages.path` 必须位于 `/plugins/` 下。
- 用户端 entry 不能指向 `dist/admin/`。
- entry 不能是远程 URL。

## Manifest 当前能力

PayIncus manifest 已经是 capability-driven 格式。页面入口、后台配置、webhook action、事件订阅、通知模板、服务扩展、支付网关扩展和插件存储都必须在 `payincus.plugin.json` 中显式声明，平台会在安装、审核、运行和 Public API 暴露前做白名单校验。

下面是一个秒杀类扩展的完整声明示例：

```json
{
  "id": "com.example.flash-sale",
  "name": "秒杀扩展",
  "version": "1.0.0",
  "payincus": ">=1.0.0",
  "permissions": [
    "plugin-action:run",
    "orders:create",
    "service-extension:provision",
    "gateway-extension:create-payment",
    "plugin-storage:read",
    "plugin-storage:write"
  ],
  "entrypoints": {
    "adminPages": [
      {
        "slot": "admin.plugins.settings",
        "title": "秒杀设置",
        "entry": "dist/admin/settings.html"
      }
    ],
    "userPages": [
      {
        "slot": "user.sidebar.extra",
        "title": "限时秒杀",
        "path": "/plugins/flash-sale",
        "entry": "dist/user/index.html",
        "requiresAuth": true
      }
    ]
  },
  "capabilities": {
    "actions": [
      {
        "name": "reserveStock",
        "method": "POST",
        "path": "/reserve-stock",
        "runtime": "webhook",
        "url": "https://extension.example.com/payincus/actions/reserve-stock",
        "scopes": ["orders:create", "service-extension:provision"],
        "requestSchema": {
          "type": "object",
          "required": ["campaignId", "sku"],
          "properties": {
            "campaignId": { "type": "string" },
            "sku": { "type": "string" }
          }
        },
        "responseSchema": {
          "type": "object",
          "required": ["reserved"],
          "properties": {
            "reserved": { "type": "boolean" }
          }
        },
        "idempotency": "required",
        "rateLimit": "strict"
      },
      {
        "name": "createGatewayPayment",
        "method": "POST",
        "path": "/gateway/create-payment",
        "runtime": "webhook",
        "url": "https://extension.example.com/payincus/gateway/create-payment",
        "scopes": ["gateway-extension:create-payment"],
        "idempotency": "required",
        "rateLimit": "strict"
      }
    ],
    "serviceExtensions": [
      {
        "key": "flash-sale-vps",
        "name": "秒杀 VPS 交付",
        "productId": "vps-basic",
        "hooks": {
          "provision": "reserveStock"
        }
      }
    ],
    "gatewayExtensions": [
      {
        "key": "flash-sale-gateway",
        "name": "秒杀支付网关",
        "providerCode": "flashpay",
        "hooks": {
          "createPayment": "createGatewayPayment"
        }
      }
    ],
    "events": [
      {
        "event": "order.paid",
        "handler": "confirmOrder"
      },
      {
        "event": "payment.failed",
        "handler": "releaseStock"
      }
    ],
    "notificationTemplates": [
      {
        "id": "reservation_reminder",
        "title": "秒杀预约提醒",
        "message": "活动「{{campaignName}}」将在 {{startsAt}} 开始。",
        "variables": ["campaignName", "startsAt"]
      }
    ],
    "storage": {
      "kind": "kv",
      "maxKeys": 200,
      "scopes": ["user", "global", "service"],
      "retention": "keep",
      "tables": [
        {
          "name": "campaign_reservations",
          "scopes": ["global", "user"],
          "maxRows": 100000,
          "migrations": [
            { "version": "1.0.0", "name": "Create reservation row shape" }
          ]
        }
      ]
    }
  },
  "configSchema": {
    "enabled": {
      "type": "checkbox",
      "label": "启用扩展",
      "group": "基础配置",
      "order": 10,
      "required": false,
      "default": true
    },
    "apiKey": {
      "type": "password",
      "label": "API Key",
      "group": "接口凭据",
      "order": 20,
      "required": true,
      "secret": true
    },
    "mode": {
      "type": "select",
      "label": "运行模式",
      "group": "基础配置",
      "order": 30,
      "required": true,
      "default": "sync",
      "options": [
        { "label": "同步", "value": "sync" },
        { "label": "异步", "value": "async" }
      ]
    }
  }
}
```

当前已校验 `configSchema`、`actions`、`events`、`notificationTemplates`、`serviceExtensions`、`gatewayExtensions` 和 `storage` 声明。标准 `configSchema` 会在后台设置页生成表单，支持用 `group` 和 `order` 分组排序，保存时按字段类型、必填、select options、email、color、file、number 范围和 secret/password 规则校验；扩展和主题的 `file` 字段首版都通过后台受控上传保存 PNG、JPEG 或 WebP 图片 URL。action 可声明 `requestSchema` 和 `responseSchema`，用于审核、文档和 SDK 生成；schema 必须是 JSON 对象，单个 schema 不超过 16KB，不能包含 `$ref`、`$id` 或原型相关危险键。`notificationTemplates` 只允许纯文本 title/message、最多 10 个变量名和 `{{variable}}` 占位符；Public API 调用 `plugin:<pluginId>:<templateId>` 时还要求扩展已启用并声明 `notifications:send` 权限。用户级 KV 存储可通过 `/api/plugins/:pluginId/storage/:key` 使用，scoped KV 可通过 `/api/plugins/:pluginId/scoped-storage/:scope/:key` 使用。平台托管私有表可通过 `/api/plugins/:pluginId/table-storage/:scope/:table/:rowKey` 使用，并通过 `/api/plugins/:pluginId/table-storage/:table/migrations` 记录 manifest 声明过的 migration ledger；这不是任意 SQL 执行能力。`runtime = webhook` 的 action 可通过 `/api/plugins/:pluginId/actions/:action` 执行。服务扩展 hook 可通过后台受控入口 `/api/plugins/:pluginId/service-actions/:hook` 调用，hook 必须引用已声明 action，且 action scopes 必须包含对应的 `service-extension:*` scope。支付网关扩展 hook 可通过后台受控入口 `/api/plugins/:pluginId/gateway-actions/:hook` 调用，hook 必须引用已声明 action，且 action scopes 必须包含对应的 `gateway-extension:*` scope。事件 dispatcher 已具备按订阅调用 handler action、成功/失败日志、重试、死信、手动重放、`dedupeKey` 去重、最后尝试时间监控、开发者事件投递告警通知和告警偏好配置的能力；扩展安装/启用/停用/卸载 lifecycle、订单、支付、服务、服务任务、资源回滚、通知、工单、工单状态和用户生命周期业务事件已接入。

## 主题 Manifest

主题包已经使用独立 `payincus.theme.json`，避免和普通业务扩展混在一起：

```json
{
  "id": "com.example.theme.clean",
  "name": "Clean Theme",
  "version": "1.0.0",
  "payincus": ">=0.6.0",
  "css": "dist/theme.css",
  "previewImage": "dist/assets/preview.png",
  "tokens": {
    "colorPrimary": "#111827",
    "radius": "8px"
  },
  "layoutSlots": [
    "public.home",
    "user.shell",
    "admin.shell"
  ],
  "templates": [
    {
      "slot": "public.home.hero",
      "title": "首页首屏",
      "entry": "templates/public/home-hero.html"
    }
  ],
  "configSchema": {}
}
```

主题 manifest 必须只声明视觉 token、受控布局区块、受控 HTML 模板片段和本地静态资源。模板片段只能使用白名单 slot 和包内 `.html` 文件，服务端会禁止脚本、表单、远程 URL、内联事件和 `javascript:`。主题不能声明 scripts、backend、capabilities、entrypoints 或后端 action，不能改变支付、认证、权限、风控和资源交付逻辑。
