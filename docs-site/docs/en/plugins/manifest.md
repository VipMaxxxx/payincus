# Extension Manifest

Every extension must provide `payincus.plugin.json`.

```json
{
  "id": "com.example.coupon",
  "name": "Coupon Extension",
  "version": "1.0.0",
  "payincus": ">=0.0.12",
  "description": "Adds coupon support for renewals",
  "author": "Example",
  "entrypoints": {
    "adminPages": [
      {
        "slot": "admin.plugins.settings",
        "title": "Coupon Settings",
        "entry": "dist/admin/settings.html"
      }
    ],
    "userPages": [
      {
        "slot": "user.sidebar.extra",
        "title": "My Coupons",
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
      "label": "Enable extension",
      "group": "General",
      "order": 10,
      "required": false,
      "default": true
    },
    "apiKey": {
      "type": "password",
      "label": "API Key",
      "group": "Credentials",
      "order": 20,
      "required": true,
      "secret": true
    }
  },
  "templates": []
}
```

Rules:

- `id` must use reverse-domain format, such as `com.vendor.plugin`.
- `version` must be semver.
- `entry` must be a relative path inside the package.
- `userPages.path` must be under `/plugins/`.
- User entries cannot point to `dist/admin/`.
- Entries cannot be remote URLs.

## Current Capability Manifest

The PayIncus manifest is already capability-driven. Page entries, admin configuration, webhook actions, event subscriptions, notification templates, service extensions, gateway extensions and extension storage must all be declared in `payincus.plugin.json`. PayIncus validates these declarations before installation, review, runtime dispatch and Public API exposure.

The example below shows an end-to-end flash-sale style extension:

```json
{
  "id": "com.example.flash-sale",
  "name": "Flash Sale Extension",
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
        "title": "Flash Sale Settings",
        "entry": "dist/admin/settings.html"
      }
    ],
    "userPages": [
      {
        "slot": "user.sidebar.extra",
        "title": "Flash Sale",
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
        "name": "Flash Sale VPS Provisioning",
        "productId": "vps-basic",
        "hooks": {
          "provision": "reserveStock"
        }
      }
    ],
    "gatewayExtensions": [
      {
        "key": "flash-sale-gateway",
        "name": "Flash Sale Gateway",
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
        "title": "Flash sale reminder",
        "message": "Campaign {{campaignName}} starts at {{startsAt}}.",
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
      "label": "Enable extension",
      "group": "General",
      "order": 10,
      "required": false,
      "default": true
    },
    "apiKey": {
      "type": "password",
      "label": "API Key",
      "group": "Credentials",
      "order": 20,
      "required": true,
      "secret": true
    },
    "mode": {
      "type": "select",
      "label": "Mode",
      "group": "General",
      "order": 30,
      "required": true,
      "default": "sync",
      "options": [
        { "label": "Sync", "value": "sync" },
        { "label": "Async", "value": "async" }
      ]
    }
  }
}
```

PayIncus currently validates `configSchema`, `actions`, `events`, `notificationTemplates`, `serviceExtensions`, `gatewayExtensions` and `storage`.

Standard `configSchema` fields generate admin forms and support `group` and `order` sorting. Saves are validated by field type, required flags, select options, email, color, file, number ranges and secret/password rules. Extension and theme `file` fields use controlled admin uploads and store PNG, JPEG or WebP image URLs.

Actions can declare `requestSchema` and `responseSchema` for review, documentation and SDK generation. Schemas must be JSON objects, are limited to 16KB each, and cannot contain `$ref`, `$id` or prototype-polluting keys. `runtime = webhook` actions can be dispatched through `/api/plugins/:pluginId/actions/:action`.

`notificationTemplates` only allow plain-text title and message strings, up to 10 variables and `{{variable}}` placeholders. Public API calls to `plugin:<pluginId>:<templateId>` also require the extension to be enabled and to declare `notifications:send`.

User KV storage is available through `/api/plugins/:pluginId/storage/:key`. Scoped KV storage is available through `/api/plugins/:pluginId/scoped-storage/:scope/:key`. Platform-managed private tables are available through `/api/plugins/:pluginId/table-storage/:scope/:table/:rowKey`, with migration ledgers under `/api/plugins/:pluginId/table-storage/:table/migrations`. This is not arbitrary SQL execution.

Service extension hooks are called through controlled admin/platform entries under `/api/plugins/:pluginId/service-actions/:hook`. The hook must reference a declared action, and the action scopes must include the matching `service-extension:*` scope. Gateway extension hooks follow the same pattern under `/api/plugins/:pluginId/gateway-actions/:hook` and require the matching `gateway-extension:*` scope.

The event dispatcher can invoke subscribed handler actions, persist success/failure logs, retry failed deliveries, mark dead letters, replay events manually, deduplicate by `dedupeKey`, expose last-attempt monitoring, and send developer event-delivery alerts with configurable preferences. Extension install/enable/disable/uninstall lifecycle events, orders, payments, services, service tasks, resource rollback, notifications, tickets, ticket status and user lifecycle events are already connected.

## Theme Manifest

Theme packages use a separate `payincus.theme.json`, so visual themes stay separate from business extensions:

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
      "title": "Home hero",
      "entry": "templates/public/home-hero.html"
    }
  ],
  "configSchema": {}
}
```

Theme manifests may only declare visual tokens, controlled layout slots, controlled HTML template fragments and local static assets. Template fragments can only use allowlisted slots and package-local `.html` files. The server blocks scripts, forms, remote URLs, inline event handlers and `javascript:` URLs. Themes cannot declare scripts, backend runtimes, capabilities, entrypoints or backend actions, and they cannot change payment, authentication, authorization, risk-control or resource-delivery logic.
