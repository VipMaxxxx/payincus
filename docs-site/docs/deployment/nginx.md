# Nginx 分离部署

Nginx 负责托管两个前端，并把 API 代理到后端。

模板文件：

```text
deploy/nginx-split-intranet.conf.example
```

替换项：

- `pay.payincus.com`：用户端域名。
- `admin.payincus.com`：后台域名。
- `/opt/incudal/current/client/dist/user`：用户端当前 release 静态目录。
- `/opt/incudal/current/client/dist/admin`：后台当前 release 静态目录。
- `10.0.0.12:3001`：后端内网 IP 和端口。

关键规则：

```text
用户端域名 -> /opt/incudal/current/client/dist/user
后台域名 -> /opt/incudal/current/client/dist/admin
/api/ -> 后端 /api/
/api/ws/ -> 后端 /api/ws/
```

模板会设置 CSP、`X-Frame-Options`、`X-Content-Type-Options`、`Referrer-Policy` 和 HSTS。若前面还有 Cloudflare/CDN，应确认公网响应也保留 `Strict-Transport-Security`。

部署后执行：

```bash
FRONTEND_URL=https://pay.payincus.com \
ADMIN_FRONTEND_URL=https://admin.payincus.com \
BACKEND_URL=http://127.0.0.1:3001 \
pnpm verify:split:host
```
