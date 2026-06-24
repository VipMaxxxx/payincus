# Manual Install

Manual deployment should follow the split frontend model.

## Install Dependencies

```bash
corepack enable
corepack prepare pnpm@9.14.2 --activate
pnpm install --frozen-lockfile
```

## Build

```bash
pnpm --filter server exec prisma generate
pnpm --filter server exec prisma migrate deploy
VITE_API_BASE_URL=/api \
VITE_CUSTOMER_BASE_URL=https://panel.example.com \
VITE_ADMIN_BASE_URL=https://admin.example.com \
pnpm build
```

Expected outputs:

```text
client/dist/user/index.html
client/dist/admin/index.html
server/dist/app.js
```

## Start Backend

```bash
NODE_ENV=production \
HOST=127.0.0.1 \
PORT=3001 \
SERVE_STATIC_CLIENT=false \
FRONTEND_URL=https://panel.example.com \
ADMIN_FRONTEND_URL=https://admin.example.com \
SITE_URL=https://panel.example.com \
PAYMENT_CALLBACK_BASE_URL=https://panel.example.com \
node server/dist/app.js
```
