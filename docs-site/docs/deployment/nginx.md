# Nginx 分离部署

Nginx 负责托管两个前端，并把 API 代理到后端。

模板文件：

```text
deploy/nginx-split-intranet.conf.example
```

替换项：

- `panel.example.com`：用户端域名。
- `admin.example.com`：后台域名。
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

缓存规则：

- `index.html` 使用 `expires epoch`，确保 OTA 切换 release 后浏览器重新读取新的入口文件。
- `/assets/` 使用独立 `location`，只服务真实静态文件并使用长期缓存；Vite 构建文件名带 hash，内容变化会生成新路径。

模板会设置 CSP、`X-Frame-Options`、`X-Content-Type-Options`、`Referrer-Policy` 和 HSTS。若前面还有 Cloudflare/CDN，应确认公网响应也保留 `Strict-Transport-Security`。

部署后执行：

```bash
FRONTEND_URL=https://panel.example.com \
ADMIN_FRONTEND_URL=https://admin.example.com \
BACKEND_URL=http://127.0.0.1:3001 \
pnpm verify:split:host
```
