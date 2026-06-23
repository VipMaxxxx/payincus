# 后台 OTA

管理后台提供“版本更新”页面，用于查看当前版本、Git tag、commit、构建时间、部署时间、更新内容、最新版本、可更新版本、任务日志和回滚入口。

后台页面：

```text
https://admin.payincus.com/admin/system-update
```

## 更新模式

默认推荐：

```dotenv
SYSTEM_UPDATE_APPLY_MODE=auto
SYSTEM_UPDATE_RELEASE_REPOSITORY=VipMaxxxx/payincus
```

`auto` 会优先使用 GitHub Release OTA artifact。如果目标 tag 没有可用 artifact，则回退到 Git tag 构建模式。

页面会在打开时自动读取最新 release tag。当前已经是最新版本时，最新版本仍然显示，主按钮显示“已更新至最新版本”且不可重复启动更新。更新任务列表固定为每页最多 7 条，超过后使用分页查看历史任务，右侧日志面板显示当前选中任务的详细输出。

| 模式 | 行为 |
| --- | --- |
| `auto` | 优先 artifact，缺失时走 Git 构建 |
| `artifact` | 只允许校验过的 OTA artifact |
| `git` | 强制 checkout tag 并在服务器构建 |

## Artifact 更新流程

1. 读取 GitHub Release `ota-manifest.json`。
2. 匹配当前 Linux 架构的 tar.gz。
3. 下载 artifact 到安装目录外部。
4. 校验文件大小和 SHA256。
5. 解压到 staging。
6. 旧布局备份当前目录；原子布局创建新 release。
7. 执行 Prisma migration。
8. 重启后端并等待 `/api/health`。
9. 执行 split host、生产预检、响应头和日志暴露检查。

## 原子布局

推荐迁移到原子 OTA 布局：

```bash
bash scripts/migrate-ota-atomic-layout.sh
```

布局：

```text
/opt/incudal/current -> /opt/incudal/releases/<version-timestamp>
/opt/incudal/releases/v0.0.10-...
/opt/incudal/releases/v0.0.11-...
```

更新成功时，任务会把上一版 release 路径写入 `backupPath`。回滚时只切换 `current` 指针，重启后端，并重新执行 split host 验证。

## 注意事项

- 后台管理员可以查看当前版本、最新 release tag 和 OTA 包状态。
- 只允许超级管理员启动更新和回滚。
- 更新 API 固定在 `/api/admin/system-update/*`。
- 用户端不包含更新入口和更新 API。
- 更新和回滚会保留 `.env`、`server/certs`、`agent-release`、`plugins`、`plugin-data`、`plugin-logs`、`plugin-staging`、`.npm` 和 `.cache`。
- SSH 维护建议使用少量长连接，避免短时间大量连接触发服务器连接率限制。
