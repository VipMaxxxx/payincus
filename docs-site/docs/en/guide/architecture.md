# Architecture

PayIncus uses a split frontend architecture with one shared backend API.

```text
User browser
  -> https://panel.example.com
  -> Nginx serves /opt/incudal/current/client/dist/user
  -> /api and /api/ws proxy to backend

Admin browser
  -> https://admin.example.com
  -> Nginx serves /opt/incudal/current/client/dist/admin
  -> /api and /api/ws proxy to backend

Backend API
  -> PostgreSQL / Incus hosts / Agent
  -> Redis service is kept by the installer for deployment compatibility and future distributed state
```

## Frontend Entries

- User entry: `client/src/router/user.ts`
- Admin entry: `client/src/router/admin.ts`
- User build output: `client/dist/user`
- Admin build output: `client/dist/admin`
- User API client: `client/src/api/index.ts`
- Admin API client: `client/src/api/admin.ts`

## Backend

The Fastify backend listens on `127.0.0.1:3001` or an internal IP in production. Nginx serves static assets and proxies only `/api/` and `/api/ws/`.

For OTA-safe frontend delivery, configure Nginx so `index.html` uses `expires epoch`. This prevents browsers or a CDN from keeping an old SPA entry after an OTA switch. Hashed `/assets/` files can use a separate static location with long-lived caching because their filenames change when the build changes.

Production should set:

```dotenv
SERVE_STATIC_CLIENT=false
FRONTEND_URL=https://panel.example.com
ADMIN_FRONTEND_URL=https://admin.example.com
VITE_API_BASE_URL=/api
```

## Data and Integration

- PostgreSQL stores accounts, instances, billing, configuration and audit data.
- Backend workers process instance tasks, restore tasks, backup uploads, notification email tasks and extension events. Recoverable queue state is stored in PostgreSQL.
- The one-click installer still installs and protects `redis-server`, writes `REDIS_URL`, and the systemd templates wait for the Redis service. The current core business state does not depend on a Redis client for persistence; Redis is reserved for deployment compatibility and future distributed cache, session or short-lived token expansion.
- Incus hosts provide LXC / KVM resources.
- Agent reports host resource usage and instance state.
- SMTP, Telegram and Lsky handle delivery and communication workflows.
