# Flash Sale Example

This template demonstrates a complete PayIncus extension shape:

- Admin settings page mounted at `admin.plugins.settings`.
- User campaign page mounted at `/plugins/flash-sale`.
- `configSchema` fields rendered by the PayIncus admin settings form.
- Webhook actions with request/response schemas, strict idempotency, and rate limits.
- `order.paid` and `payment.failed` event subscriptions.
- Plugin-declared notification templates for reservation reminders and results.
- Scoped KV storage declaration for campaign, user, and service reservation state.

The template intentionally keeps business writes inside an external extension service. PayIncus only dispatches declared webhook actions and exposes scoped storage/API boundaries.

Package it with:

```bash
cd plugin-templates/flash-sale-plugin
tar -czf flash-sale-plugin.tar.gz payincus.plugin.json README.md dist templates docs
```

Then upload `flash-sale-plugin.tar.gz` in the admin Extension Center.
