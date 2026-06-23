# Plugin Center

The PayIncus plugin center installs and manages third-party plugins. A plugin can provide admin settings pages and user-facing pages through controlled extension slots.

Plugins do not modify PayIncus source code directly. Installed runtime files are stored under:

```text
/opt/incudal/plugins
/opt/incudal/plugin-data
/opt/incudal/plugin-logs
/opt/incudal/plugin-staging
```

These directories are preserved across OTA updates and rollbacks.

## Capabilities

- Install uploaded `.tar.gz` plugin packages
- Install from a GitHub plugin market
- Enable, disable, and uninstall plugins
- Inspect plugin task logs
- Manage plugin config from `configSchema`
- Render plugin pages in sandboxed iframes

## Admin UI

The plugin center is split into three internal pages:

- Installed: upload plugin packages, inspect plugins, enable/disable/uninstall plugins and edit plugin configuration.
- Plugin Market: open a dedicated GitHub market index page, refresh the market and install market plugins.
- Install Tasks: inspect upload installs, market installs, enable, disable and uninstall tasks. The task list is fixed to at most 7 rows per page, and the log panel beside it shows the selected task output.

## Security Boundary

- Only super administrators can install, enable, disable, or uninstall plugins.
- User plugins cannot access `/api/admin/*`.
- Plugin packages cannot contain absolute paths, `../`, symlinks, or hard links.
- Market plugins must come from GitHub Release artifacts and pass SHA256 verification.
- This version does not execute plugin shell scripts or load arbitrary backend code.
