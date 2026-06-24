# 前后台分离

PayIncus 的用户端和管理端已经按构建入口、路由、API 和导航分离。

## 代码边界

| 范围 | 用户端 | 管理端 |
| --- | --- | --- |
| 路由 | `client/src/router/user.ts` | `client/src/router/admin.ts` |
| 入口 | `client/src/main.ts` | `client/src/admin/main.ts` |
| API | `client/src/api/index.ts` | `client/src/api/admin.ts` |
| URL helper | `app-paths-user` | `app-paths-admin` |
| 导航 | 用户菜单 | 管理菜单 |

## 部署边界

```text
https://panel.example.com
  -> client/dist/user
  -> /api, /api/ws -> backend

https://admin.example.com
  -> client/dist/admin
  -> /api, /api/ws -> backend
```

## 验证命令

```bash
FRONTEND_URL=https://panel.example.com \
ADMIN_FRONTEND_URL=https://admin.example.com \
BACKEND_URL=http://127.0.0.1:3001 \
pnpm verify:split:host
```

构建产物边界由 `test:frontend-dist-boundary-guards` 扫描，源码边界由 `test:frontend-route-guards` 扫描。
