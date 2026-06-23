# Plugin Manifest

Every plugin must provide `payincus.plugin.json`.

```json
{
  "id": "com.example.coupon",
  "name": "Coupon Plugin",
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
  "permissions": ["plugin:config:read"],
  "configSchema": {},
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
