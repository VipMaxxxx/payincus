# Nginx Split Deployment

Nginx should serve two different static frontend directories and proxy API traffic to the same backend.

```text
pay.payincus.com
  root /opt/incudal/current/client/dist/user
  /api/ -> http://127.0.0.1:3001
  /api/ws/ -> WebSocket proxy

admin.payincus.com
  root /opt/incudal/current/client/dist/admin
  /api/ -> http://127.0.0.1:3001
  /api/ws/ -> WebSocket proxy
```

## Requirements

- Do not serve the admin build from the user domain.
- Do not serve the user build from the admin domain.
- Keep backend traffic same-origin through `/api`.
- Ensure WebSocket upgrade headers are set for `/api/ws`.
- Keep CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, and HSTS on public responses. If Cloudflare/CDN is in front, confirm `Strict-Transport-Security` is still preserved.

Use the repository template:

```text
deploy/nginx-split-intranet.conf.example
```
