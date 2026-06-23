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
