# Environment Variables

Start from `.env.example` and adjust production values.

## Core

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3001
TRUST_PROXY=true
SERVE_STATIC_CLIENT=false

FRONTEND_URL=https://panel.example.com
ADMIN_FRONTEND_URL=https://admin.example.com
SITE_URL=https://panel.example.com
PAYMENT_CALLBACK_BASE_URL=https://panel.example.com
VITE_API_BASE_URL=/api
VITE_CUSTOMER_BASE_URL=https://panel.example.com
VITE_ADMIN_BASE_URL=https://admin.example.com
```

## Cookies

```dotenv
COOKIE_SAME_SITE=
COOKIE_SECURE=
COOKIE_DOMAIN=
```

Keep `COOKIE_DOMAIN` empty unless you have a clear cross-domain cookie strategy.

## Secrets

```dotenv
JWT_SECRET=change_me_generate_with_openssl_rand_base64_48
COOKIE_SECRET=change_me_generate_with_openssl_rand_base64_48
ENCRYPTION_KEY=change_me_generate_with_openssl_rand_base64_48
ADMIN_EMAIL=admin@payincus.local
ADMIN_PASSWORD=change_me_admin_password
```

Never enable `RESET_DATABASE` in production.
