# PayIncus Clean Theme

This is the official theme sample for the PayIncus theme system.

It demonstrates:

- `payincus.theme.json` manifest validation.
- Local CSS entrypoint.
- Design tokens.
- `configSchema` groups, ordering, color/select/text/file/placeholder fields.
- Safe template fragments for public, market, user dashboard/wallet/tickets, extension center, admin dashboard banner/widgets, and shared slots.
- A visual-only package boundary: no scripts, backend actions, plugin capabilities, forms, iframes, or remote URLs.

Package it with:

```bash
cd theme-templates/clean-theme
tar -czf payincus-clean-theme.tar.gz payincus.theme.json README.md dist tokens templates docs
```

Then upload it in the admin Extension Center theme tab, preview it, enable it, and roll back to the default theme when needed.
