# 手动部署

以下示例假设安装目录是 `/opt/incudal`，用户端域名是 `panel.example.com`，后台域名是 `admin.example.com`。

## 安装依赖

```bash
corepack enable
corepack prepare pnpm@9.14.2 --activate
pnpm install --frozen-lockfile
```

## 迁移和构建

```bash
pnpm --filter server exec prisma generate
pnpm --filter server exec prisma migrate deploy
VITE_API_BASE_URL=/api \
VITE_CUSTOMER_BASE_URL=https://panel.example.com \
VITE_ADMIN_BASE_URL=https://admin.example.com \
pnpm build
```

构建后应存在：

```text
client/dist/user/index.html
client/dist/admin/index.html
server/dist/app.js
```

## 后端启动

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

生产建议使用 systemd 管理后端服务。
