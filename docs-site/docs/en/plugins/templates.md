# Extension Templates

The repository includes five extension templates:

```text
plugin-templates/basic-admin-plugin
plugin-templates/user-sidebar-plugin
plugin-templates/admin-user-mixed-plugin
plugin-templates/ai-ticket-agent-plugin
plugin-templates/flash-sale-plugin
```

Example packaging:

```bash
cd plugin-templates/admin-user-mixed-plugin
tar -czf coupon-plugin.tar.gz payincus.plugin.json README.md dist templates docs
```

Upload the `.tar.gz` package from the admin Extension Center, then enable it.

`plugin-templates/basic-admin-plugin` demonstrates `admin.plugins.settings`, `admin.sidebar.extra`, and `admin.dashboard.widgets`: the settings entry appears in the admin sidebar, the sidebar entry opens a protected admin extension page, and the dashboard widget embeds into the admin statistics dashboard.

`plugin-templates/admin-user-mixed-plugin` demonstrates `user.sidebar.extra` and `user.dashboard.cards`: the first appears in the user sidebar, and the second embeds into the user dashboard.

## Flash Sale Complete Sample

`plugin-templates/flash-sale-plugin` is a full third-party feature example. It proves the Extension Center can support a business shape with a user-facing page, admin settings, webhook actions, event subscriptions, and scoped KV storage.

It includes:

- Admin settings page: `admin.plugins.settings`, with `configSchema` fields for campaign enablement, campaign ID, product SKU, start/end time, inventory, per-user limit, and webhook secret.
- User campaign page: `/plugins/flash-sale`, used to show the campaign and call declared actions.
- Actions: `reserveStock`, `confirmPaidReservation`, and `releaseReservation`, all designed around idempotency and declared schemas.
- Event subscriptions: `order.paid` confirms inventory, and `payment.failed` releases inventory.
- Storage declaration: global/user/service scoped KV for campaign, user reservation, and service-linked state.

Packaging example:

```bash
cd plugin-templates/flash-sale-plugin
tar -czf flash-sale-plugin.tar.gz payincus.plugin.json README.md dist templates docs
```

## Official Theme Sample

`theme-templates/clean-theme` is the official sample for the real theme system. It proves that a theme package can provide CSS, design tokens, admin config fields, and safe template fragments through controlled rules.

It includes:

- `payincus.theme.json`: declares theme ID, version, compatibility range, CSS entry, tokens, layout slots, templates, and `configSchema`.
- `dist/theme.css`: local CSS entry without remote imports.
- `tokens/colors.json`: design token example.
- Safe template fragments for public, user, admin, and shared slots such as `public.home.hero`, `public.market.banner`, `user.dashboard.banner`, `admin.extensions.header`, `admin.dashboard.widgets`, `admin.oauth.banner`, and `shared.footer`.
- Theme config fields: `color`, `select`, `text`, `file`, and `placeholder`, with grouping and ordering.

Packaging example:

```bash
cd theme-templates/clean-theme
tar -czf payincus-clean-theme.tar.gz payincus.theme.json README.md dist tokens templates docs
```
