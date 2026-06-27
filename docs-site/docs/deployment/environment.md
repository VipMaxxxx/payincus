# 环境变量

生产环境变量保存在 `/opt/incudal/.env`。一键安装脚本会自动生成大部分值；手动部署时可以从 `.env.example` 开始配置。

## 后端运行

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3001
TRUST_PROXY=true
SERVE_STATIC_CLIENT=false
```

生产必须设置 `SERVE_STATIC_CLIENT=false`，前端静态文件由 Nginx 托管。

## 公网地址

```dotenv
FRONTEND_URL=https://panel.example.com
ADMIN_FRONTEND_URL=https://admin.example.com
SITE_URL=https://panel.example.com
PAYMENT_CALLBACK_BASE_URL=https://panel.example.com
```

规则：

- `FRONTEND_URL` 是用户端域名。
- `ADMIN_FRONTEND_URL` 是管理后台域名，必须和用户端分离。
- `SITE_URL` 通常等于用户端域名。
- `PAYMENT_CALLBACK_BASE_URL` 通常等于用户端域名，支付商回调不要指向后台域名或内网地址。

## 前端构建变量

```dotenv
VITE_API_BASE_URL=/api
VITE_CUSTOMER_BASE_URL=https://panel.example.com
VITE_ADMIN_BASE_URL=https://admin.example.com
```

两个前端都通过同源 `/api` 和 `/api/ws` 访问后端。

## 数据库和缓存

```dotenv
DATABASE_URL=postgresql://incudal:change_me@127.0.0.1:5432/incudal
REDIS_URL=redis://:change_me@127.0.0.1:6379
```

PostgreSQL 是核心持久化来源。Redis 由安装脚本保留，用于部署兼容和后续分布式状态扩展。

## Cookie

```dotenv
COOKIE_SAME_SITE=
COOKIE_SECURE=
COOKIE_DOMAIN=
```

`COOKIE_DOMAIN` 必须保持空值，用户端和管理后台子域不能共享 refresh cookie。

## 安全密钥

```dotenv
JWT_SECRET=change_me_generate_with_openssl_rand_base64_48
COOKIE_SECRET=change_me_generate_with_openssl_rand_base64_48
ENCRYPTION_KEY=change_me_generate_with_openssl_rand_base64_48
ADMIN_EMAIL=admin@payincus.local
ADMIN_PASSWORD=change_me_admin_password
```

生产不要设置 `RESET_DATABASE`。密钥不要写入截图、工单、日志或公开文档。

## 支付回调

```dotenv
PAYMENT_CALLBACK_IP_WHITELIST=
PAYMENT_CALLBACK_SKIP_IP_WHITELIST=false
```

生产建议配置支付商回调 IP 白名单。只有在支付商无法提供固定回调 IP 且你已经确认签名校验可靠时，才考虑特殊处理。

## 后台 OTA

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

`SYSTEM_UPDATE_APPLY_MODE` 可选：

- `auto`：优先使用 Release artifact，缺失时回退 Git 构建。
- `artifact`：只允许校验过的 OTA artifact。
- `git`：强制 checkout tag 并在服务器构建。

## 扩展中心

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

## 主题系统

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

## 验证

```bash
ENV_FILE=/opt/incudal/.env \
FRONTEND_URL=https://panel.example.com \
ADMIN_FRONTEND_URL=https://admin.example.com \
BACKEND_URL=http://127.0.0.1:3001 \
pnpm verify:production
```
