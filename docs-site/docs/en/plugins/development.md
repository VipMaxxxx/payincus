# Plugin Development

A plugin package must be a `.tar.gz` archive with this root structure:

```text
payincus.plugin.json
README.md
dist/
  admin/
  user/
templates/
docs/
```

Minimal packaging command:

```bash
tar -czf my-plugin.tar.gz payincus.plugin.json README.md dist templates docs
```

## Admin Pages

Declare admin pages with `adminPages`. PayIncus renders them in the plugin center with a sandboxed iframe.

```json
{
  "slot": "admin.plugins.settings",
  "title": "Settings",
  "entry": "dist/admin/settings.html"
}
```

## User Pages

Declare user pages with `userPages`. After the plugin is enabled, the user portal reads visible entries from `/api/plugins/enabled-client-extensions`.

```json
{
  "slot": "user.sidebar.extra",
  "title": "My Plugin",
  "path": "/plugins/my-plugin",
  "entry": "dist/user/index.html",
  "requiresAuth": true
}
```

## Configuration

Plugin config is managed from the admin plugin center. Static plugin pages can read non-secret public config:

```text
GET /api/plugins/:pluginId/config/public
```

Config keys containing names such as `token`, `secret`, `password`, or `key` are treated as secret and are not returned by the public config API.
