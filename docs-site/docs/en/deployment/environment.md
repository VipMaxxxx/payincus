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
PAYMENT_CALLBACK_SKIP_IP_WHITELIST=false
```

Configure payment-provider callback IP allowlists in production where the provider supports it. Only bypass IP checks when provider signatures are reliable and fixed source IPs are unavailable.

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

## Extension Center

```dotenv
PLUGIN_MANAGER_ALLOWED_ADMIN_IDS=
PLUGIN_MARKET_INDEX_URL=https://payincus.com/plugin-market/index.json
PLUGIN_MARKET_TRUSTED_HOSTS=payincus.com,payincus.github.io,github.com,objects.githubusercontent.com,raw.githubusercontent.com
PLUGIN_MARKET_PUBLISH_DIR=/opt/incudal/plugin-market
PLUGIN_MARKET_PUBLIC_BASE_URL=https://payincus.com/plugin-market
PLUGIN_SUBMISSION_PUBLIC_BASE_URL=
PLUGIN_WEBHOOK_SIGNING_SECRET=change_me
PLUGIN_WEBHOOK_TIMEOUT_MS=10000
PLUGIN_INSTALL_DIR=/opt/incudal/plugins
PLUGIN_DATA_DIR=/opt/incudal/plugin-data
PLUGIN_LOG_DIR=/opt/incudal/plugin-logs
PLUGIN_STAGING_DIR=/opt/incudal/plugin-staging
PLUGIN_MAX_PACKAGE_SIZE_MB=20
```

## Theme System

```dotenv
THEME_MANAGER_ALLOWED_ADMIN_IDS=
THEME_MARKET_INDEX_URL=https://payincus.com/theme-market/index.json
THEME_MARKET_TRUSTED_HOSTS=payincus.com,payincus.github.io,github.com,objects.githubusercontent.com,raw.githubusercontent.com
THEME_MARKET_PUBLISH_DIR=/opt/incudal/theme-market
THEME_MARKET_PUBLIC_BASE_URL=https://payincus.com/theme-market
THEME_INSTALL_DIR=/opt/incudal/themes
THEME_DATA_DIR=/opt/incudal/theme-data
THEME_STAGING_DIR=/opt/incudal/theme-staging
THEME_MAX_PACKAGE_SIZE_MB=10
```

## Verification

```bash
ENV_FILE=/opt/incudal/.env \
FRONTEND_URL=https://panel.example.com \
ADMIN_FRONTEND_URL=https://admin.example.com \
BACKEND_URL=http://127.0.0.1:3001 \
pnpm verify:production
```
