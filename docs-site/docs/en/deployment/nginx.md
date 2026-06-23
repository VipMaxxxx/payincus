# Nginx Split Deployment

Nginx should serve two different static frontend directories and proxy API traffic to the same backend.

```text
pay.payincus.com
  root /opt/incudal/client/dist/user
  /api/ -> http://127.0.0.1:3001
  /api/ws/ -> WebSocket proxy

admin.payincus.com
  root /opt/incudal/client/dist/admin
  /api/ -> http://127.0.0.1:3001
  /api/ws/ -> WebSocket proxy
```

## Requirements

- Do not serve the admin build from the user domain.
- Do not serve the user build from the admin domain.
- Keep backend traffic same-origin through `/api`.
- Ensure WebSocket upgrade headers are set for `/api/ws`.

Use the repository template:

```text
deploy/nginx-split-intranet.conf.example
```
