# Nginx 分离部署

Nginx 负责托管两个前端，并把 API 代理到后端。

模板文件：

```text
deploy/nginx-split-intranet.conf.example
```

替换项：

- `demo.payincus.com`：用户端域名。
- `demoadmin.payincus.com`：后台域名。
- `/opt/incudal/client/dist/user`：用户端构建产物。
- `/opt/incudal/client/dist/admin`：后台构建产物。
- `10.0.0.12:3001`：后端内网 IP 和端口。

关键规则：

```text
用户端域名 -> client/dist/user
后台域名 -> client/dist/admin
/api/ -> 后端 /api/
/api/ws/ -> 后端 /api/ws/
```

部署后执行：

```bash
FRONTEND_URL=https://demo.payincus.com \
ADMIN_FRONTEND_URL=https://demoadmin.payincus.com \
BACKEND_URL=http://127.0.0.1:3001 \
pnpm verify:split:host
```
