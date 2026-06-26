# Extension Templates

The repository includes three templates:

```text
plugin-templates/basic-admin-plugin
plugin-templates/user-sidebar-plugin
plugin-templates/admin-user-mixed-plugin
```

Example packaging:

```bash
cd plugin-templates/admin-user-mixed-plugin
tar -czf coupon-plugin.tar.gz payincus.plugin.json README.md dist templates docs
```

Upload the `.tar.gz` package from the admin Extension Center, then enable it.
