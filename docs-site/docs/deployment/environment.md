# 环境变量

生产 `.env` 建议从 `.env.example` 复制后修改。

## 核心项

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

## Cookie

```dotenv
COOKIE_SAME_SITE=
COOKIE_SECURE=
COOKIE_DOMAIN=
```

`COOKIE_DOMAIN` 建议保持空值，避免用户端和后台跨子域共享 refresh cookie。

## 安全密钥

```dotenv
JWT_SECRET=change_me_generate_with_openssl_rand_base64_48
COOKIE_SECRET=change_me_generate_with_openssl_rand_base64_48
ENCRYPTION_KEY=change_me_generate_with_openssl_rand_base64_48
ADMIN_EMAIL=admin@payincus.local
ADMIN_PASSWORD=change_me_admin_password
```

生产不要设置 `RESET_DATABASE`。
