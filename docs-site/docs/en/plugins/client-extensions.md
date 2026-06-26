# Client Extensions

Plugins can only mount into PayIncus-approved extension slots. They cannot directly modify the main frontend source code.

## User Slots

```text
user.sidebar.extra
user.dashboard.cards
user.instance.detail.panels
user.instance.renew.widgets
user.wallet.extra
user.ticket.extra
public.market.cards
```

## Admin Slots

```text
admin.plugins.settings
admin.sidebar.extra
admin.dashboard.widgets
admin.instance.detail.panels
admin.user.detail.panels
admin.billing.extra
admin.ticket.extra
```

Plugin pages are loaded in sandboxed iframes. A plugin can read its own public config, but it cannot bypass permissions or call admin APIs from the user portal.

`admin.plugins.settings` is used for extension settings entries in the admin sidebar and opens a standalone plugin settings route. `admin.sidebar.extra` appears in the admin sidebar and opens a platform-generated `/admin/plugins/:pluginId/pages/<entry>` page. Admin extension entries are only exposed through `/api/plugins/enabled-admin-client-extensions` for authenticated administrators.

`user.dashboard.cards` mounts into the user dashboard. `admin.dashboard.widgets` mounts into the admin statistics dashboard. Page-level slots render sandboxed iframes directly in the host page and are intended for status cards, campaign summaries, operational widgets, and read-only reports.
