# Environment Variables

Production environment variables live in `/opt/incudal/.env`. The one-click installer generates most values. Manual deployments can start from `.env.example`.

## Backend Runtime

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3001
TRUST_PROXY=true
SERVE_STATIC_CLIENT=false
```

Production should keep `SERVE_STATIC_CLIENT=false`; Nginx serves frontend assets.

## Public Origins

```dotenv
FRONTEND_URL=https://panel.example.com
ADMIN_FRONTEND_URL=https://admin.example.com
SITE_URL=https://panel.example.com
PAYMENT_CALLBACK_BASE_URL=https://panel.example.com
```

Rules:

- `FRONTEND_URL` is the user portal origin.
- `ADMIN_FRONTEND_URL` is the admin console origin and must be separate.
- `SITE_URL` usually equals the user portal origin.
- `PAYMENT_CALLBACK_BASE_URL` usually equals the user portal origin. Do not point payment callbacks at the admin origin or an internal backend URL.

## Frontend Build Variables

```dotenv
VITE_API_BASE_URL=/api
VITE_CUSTOMER_BASE_URL=https://panel.example.com
VITE_ADMIN_BASE_URL=https://admin.example.com
```

Both frontend builds call the backend through same-origin `/api` and `/api/ws`.

## Database and Cache

```dotenv
DATABASE_URL=postgresql://incudal:change_me@127.0.0.1:5432/incudal
REDIS_URL=redis://:change_me@127.0.0.1:6379
```

PostgreSQL is the primary persistence layer. Redis is kept by the installer for deployment compatibility and future distributed state expansion.

## Cookies

```dotenv
COOKIE_SAME_SITE=
COOKIE_SECURE=
COOKIE_DOMAIN=
```

`COOKIE_DOMAIN` must stay empty so the customer portal and admin console subdomains do not share refresh cookies.

## Secrets

```dotenv
JWT_SECRET=change_me_generate_with_openssl_rand_base64_48
COOKIE_SECRET=change_me_generate_with_openssl_rand_base64_48
ENCRYPTION_KEY=change_me_generate_with_openssl_rand_base64_48
ADMIN_EMAIL=admin@payincus.local
ADMIN_PASSWORD=change_me_admin_password
```

Never enable `RESET_DATABASE` in production. Do not paste secrets into screenshots, tickets, logs, or public documentation.

## Payment Callback

```dotenv
PAYMENT_CALLBACK_IP_WHITELIST=
PAYMENT_CALLBACK_IP_WHITELIST_REQUIRED=true
PAYMENT_CALLBACK_SKIP_IP_WHITELIST=false
```

Configure payment-provider callback IP allowlists in production where the provider supports it. If the provider does not publish stable callback source IPs and the operator explicitly accepts running without a source IP allowlist, set `PAYMENT_CALLBACK_IP_WHITELIST_REQUIRED=false` while keeping `PAYMENT_CALLBACK_SKIP_IP_WHITELIST=false`. This does not bypass any provider or built-in allowlist that exists; it only accepts an empty global allowlist when no stable source IPs are available. Callbacks must still pass signature verification, trade-status validation, amount matching and `payment_callbacks` idempotency before balance credit.

## Admin OTA

```dotenv
SYSTEM_UPDATE_ALLOWED_ADMIN_IDS=1
SYSTEM_UPDATE_LOG_DIR=/opt/incudal/update-logs
SYSTEM_UPDATE_STARTED_BY_USER_ID=1
SYSTEM_UPDATE_RELEASE_REPOSITORY=VipMaxxxx/payincus
SYSTEM_UPDATE_RELEASE_TOKEN=
SYSTEM_UPDATE_APPLY_MODE=auto
SYSTEM_UPDATE_MIN_FREE_MB=4096
SYSTEM_UPDATE_RELEASES_KEEP=8
SYSTEM_UPDATE_BACKUP_TASKS_KEEP=3
```

`SYSTEM_UPDATE_APPLY_MODE` options:

- `auto`: prefer Release artifacts, fall back to Git build.
- `artifact`: require verified OTA artifacts.
- `git`: checkout the release tag and build on the server.

## Verification

```bash
ENV_FILE=/opt/incudal/.env \
FRONTEND_URL=https://panel.example.com \
ADMIN_FRONTEND_URL=https://admin.example.com \
BACKEND_URL=http://127.0.0.1:3001 \
pnpm verify:production
```
