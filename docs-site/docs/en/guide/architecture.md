# Architecture

PayIncus uses a split frontend architecture with one shared backend API.

```text
User browser
  -> https://pay.payincus.com
  -> Nginx serves /opt/incudal/current/client/dist/user
  -> /api and /api/ws proxy to backend

Admin browser
  -> https://admin.payincus.com
  -> Nginx serves /opt/incudal/current/client/dist/admin
  -> /api and /api/ws proxy to backend

Backend API
  -> PostgreSQL / Redis / Incus hosts / Agent
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

Production should set:

```dotenv
SERVE_STATIC_CLIENT=false
FRONTEND_URL=https://pay.payincus.com
ADMIN_FRONTEND_URL=https://admin.payincus.com
VITE_API_BASE_URL=/api
```

## Data and Integration

- PostgreSQL stores accounts, instances, billing, configuration and audit data.
- Redis is used for runtime state where configured.
- Incus hosts provide LXC / KVM resources.
- Agent reports host resource usage and instance state.
- SMTP, Telegram and Lsky handle delivery and communication workflows.
