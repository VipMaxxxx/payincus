# Common Issues

## `vitepress: command not found`

Install the documentation site dependencies:

```bash
pnpm docs:install
```

The docs site is an independent package and is not part of the main runtime workspace.

## Cannot Access npm Registry

Use a reachable registry:

```bash
pnpm --dir docs-site install --ignore-workspace --registry=https://registry.npmmirror.com
```

## User Domain Returns Admin Page

Check Nginx root paths:

- User domain must serve `client/dist/user`.
- Admin domain must serve `client/dist/admin`.

Then run:

```bash
pnpm verify:split:host
```

## `/api/health` Returns 502

Check backend service status:

```bash
systemctl status incudal-backend
journalctl -u incudal-backend -n 200
```

Also verify that Nginx proxies `/api/` to the correct backend address.

## WebSocket Terminal Fails

Confirm `/api/ws` has WebSocket upgrade headers in Nginx and that the backend is reachable.
